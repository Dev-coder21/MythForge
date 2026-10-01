"""
One LLM call returns the whole story draft; it is validated in layers and
corrected up to twice:
  1. JSON parse             2. draft schema (enums, shapes)
  3. assembled StorySpec (copy rules: em dashes, cliches, "not X, it's Y"...)
  4. grounding: real kits, sources that were retrieved, numbers found in the source
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.config import get_settings
from app.llm_pipeline.catalog import kit_problem, landmark_problem
from app.llm_pipeline.grounding import check_grounding, remove_unsupported
from app.llm_pipeline.style import critique_style, pick_headings
from app.llm_pipeline.prompt import SYSTEM, build_prompt, correction_prompt, grounding_correction_prompt
from app.llm_pipeline.providers import FallbackChain, LLMError
from app.retrieval import RetrievedContent
from app.schemas.story import RULES, copy_problems
from app.schemas.story import (
    BackgroundObject,
    GroundType,
    ParticleType,
    SceneTemplateId,
    StorySpec,
    TimeOfDay,
    TitleLayout,
    TransitionType,
)

MAX_CORRECTIONS = 2
HEADING_CANDIDATES = 3
STYLE_PASSES = True  # best-of-N heading judge + style critic (tests switch it off for scripted providers)


class DraftLandmark(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(min_length=10, max_length=240)


class DraftChapter(BaseModel):
    """What the model writes per chapter; the server adds index, label prefix and ids."""

    model_config = ConfigDict(extra="ignore")
    labelName: str
    titleWord: str
    heading: str | None = None
    # Best-of-N: the writer proposes several headings; validation keeps the ones that pass the rules
    # and a small judge model picks the most vivid (see pick_headings).
    headings: list[str] = Field(default_factory=list)
    subheading: str
    body: str
    source: str
    sceneTemplate: SceneTemplateId
    artKit: str
    timeOfDay: TimeOfDay
    backgroundObject: BackgroundObject
    particleType: ParticleType
    groundType: GroundType
    primaryColor: str
    accentColor: str
    particleDensity: float = Field(default=0.4, ge=0, le=1)
    transition: TransitionType
    titleLayout: TitleLayout = "horizontal"
    landmark: DraftLandmark | None = None


class Draft(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    subtitle: str
    # Only when the topic truly spans settings (a river journey into a desert); otherwise one template.
    mixedSettingsReason: str | None = None
    chapters: list[DraftChapter] = Field(min_length=1)


class SpecInvalid(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


class GenerationFailed(Exception):
    """The model could not produce a valid spec within the correction budget."""


@dataclass
class GenerationResult:
    spec: StorySpec
    provider: str
    attempts: int
    notes: list[str] = field(default_factory=list)
    # {"score": supported/total, "sentences": n, "unsupported": [...], "removed": [...], "kept": [...]}
    grounding: dict | None = None


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "story"


# Typographic look-alikes models emit; replaced with plain characters (em dashes stay, so the rule can flag them).
_PLAIN = str.maketrans({
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "−": "-",
    "‘": "'", "’": "'", "“": '"', "”": '"',
    " ": " ", " ": " ", " ": " ", "…": "...",
})


def normalize_text(value):
    """Plain punctuation in every string of a parsed draft."""
    if isinstance(value, str):
        return value.translate(_PLAIN)
    if isinstance(value, list):
        return [normalize_text(v) for v in value]
    if isinstance(value, dict):
        return {k: normalize_text(v) for k, v in value.items()}
    return value


def _heading(text: str) -> str:
    """House style (see the hand-written samples): headings end with a full stop."""
    text = text.strip()
    return text if text[-1:] in ".?!" else text + "."


def _parse_json(raw: str) -> dict:
    text = raw.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise SpecInvalid(["the response was not a JSON object"])
    try:
        return normalize_text(json.loads(text[start : end + 1]))
    except json.JSONDecodeError as e:
        raise SpecInvalid([f"the response was not valid JSON ({e.msg} at line {e.lineno})"]) from e


def _pydantic_errors(e: ValidationError, prefix: str = "") -> list[str]:
    out = []
    for err in e.errors():
        loc = ".".join(str(x) for x in err["loc"])
        out.append(f"{prefix}{loc}: {err['msg'].removeprefix('Value error, ')}")
    return out


_NUMBER = re.compile(r"\d[\d,.]*\d|\d")


def _numbers(text: str) -> set[str]:
    """Multi-digit numbers normalised (commas dropped, trailing dots stripped)."""
    found = set()
    for tok in _NUMBER.findall(text):
        n = tok.replace(",", "").rstrip(".")
        if len(n.replace(".", "")) >= 2:
            found.add(n)
    return found


# Spelled-out figures count as numbers too ("Eight thousand metres of stone").
_NUMBER_WORDS = re.compile(
    r"\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?)\b",
    re.IGNORECASE,
)


def _title_candidates(source_text: str, used: set[str], n: int = 8) -> list[str]:
    """Frequent capitalised source words (names, places) of 3 to 10 letters that no chapter uses yet."""
    counts: dict[str, int] = {}
    for w in re.findall(r"\b[A-Z][a-z]{2,9}\b", source_text):
        counts[w.upper()] = counts.get(w.upper(), 0) + 1
    skip = {"THE", "THIS", "THAT", "THESE", "SOURCE", "SUMMARY", "WIKIPEDIA", "DURING", "AFTER", "BEFORE", "SINCE", "WHEN", "WHILE"}
    ranked = sorted((w for w in counts if w not in used and w not in skip), key=lambda w: -counts[w])
    return ranked[:n]


def _word_in(word: str, text: str) -> bool:
    """Whole-word match, case-insensitive; a plural or singular form also counts (WALLS for "wall")."""
    w = re.escape(word.strip().lower())
    stem = re.escape(re.sub(r"(es|s)$", "", word.strip().lower()))
    return bool(re.search(rf"\b({w}|{stem}|{stem}s|{stem}es)\b", text.lower()))


def assemble(draft: Draft, topic: str, content: RetrievedContent) -> StorySpec:
    """Turn a draft into a full StorySpec (ids, labels, dates, Commons images)."""
    chapters = []
    for i, c in enumerate(draft.chapters, start=1):
        image = content.images[(i - 1) % len(content.images)] if content.images else None
        chapters.append({
            "index": i,
            "label": f"CHAPTER {i:02d} · {c.labelName.strip().upper()}",
            "titleWord": c.titleWord.strip().upper(),
            "heading": _heading(c.heading),
            "subheading": c.subheading,
            "body": c.body,
            "sceneTemplate": c.sceneTemplate,
            "sceneParams": {
                "primaryColor": c.primaryColor,
                "accentColor": c.accentColor,
                "particleType": c.particleType,
                "groundType": c.groundType,
                "backgroundObject": c.backgroundObject,
                "propVariant": c.artKit,
                "artKit": c.artKit,
                "timeOfDay": c.timeOfDay,
                "props": [],
                "particleDensity": round(c.particleDensity, 2),
            },
            "titleLayout": c.titleLayout,
            "source": c.source,
            "transition": c.transition,
            "heroImage": {"url": image["url"], "attribution": image["attribution"], "license": image["license"]} if image else None,
            "landmark": {"name": c.landmark.name.strip(), "description": c.landmark.description.strip()} if c.landmark else None,
        })
    slug = slugify(draft.title if len(draft.title) > 2 else topic)
    return StorySpec.model_validate({
        "version": 1,
        "id": str(uuid.uuid4()),
        "topic": topic,
        "title": draft.title,
        "subtitle": draft.subtitle,
        "slug": slug,
        "chapters": chapters,
        "createdAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
    })


def heading_problems(heading: str, source_numbers: set[str]) -> list[str]:
    """Why one candidate heading cannot be used (empty = usable)."""
    h = heading.strip()
    out = []
    if not h:
        return ["empty"]
    if len(h) > RULES["generatedHeadingMax"]:
        out.append(f"{len(h)} characters; keep it under {RULES['generatedHeadingMax']}, evocative, not a summary")
    if RULES["generatedHeadingNoDigits"] and (re.search(r"\d", h) or _NUMBER_WORDS.search(h)):
        out.append("no numbers or dates in headings, in digits or words; move the figure into the body")
    out += copy_problems(h)
    if _numbers(h) - source_numbers:
        out.append("uses a number that is not in the SOURCE TEXT")
    return out


def validate_draft(raw: str, topic: str, content: RetrievedContent, chapters: int) -> StorySpec:
    return validate_draft_full(raw, topic, content, chapters)[0]


def validate_draft_full(raw: str, topic: str, content: RetrievedContent, chapters: int) -> tuple[StorySpec, list[list[str]]]:
    """Validated spec (first usable heading per chapter) plus every usable candidate heading per chapter."""
    data = _parse_json(raw)
    try:
        draft = Draft.model_validate(data)
    except ValidationError as e:
        raise SpecInvalid(_pydantic_errors(e)) from e

    errors: list[str] = []
    if len(draft.chapters) != chapters:
        errors.append(f"there must be exactly {chapters} chapters (got {len(draft.chapters)})")
    templates = sorted({c.sceneTemplate for c in draft.chapters})
    if len(templates) > 1 and not (draft.mixedSettingsReason or "").strip():
        errors.append(
            f"chapters use different sceneTemplates ({', '.join(templates)}); a story keeps one setting, so use the same "
            "sceneTemplate for every chapter (vary artKit, timeOfDay and colours within it). Only if the topic truly "
            "spans different settings, keep them and set mixedSettingsReason to one sentence saying why"
        )
    source_text = content.as_prompt_text()
    source_numbers = _numbers(source_text)
    used_words = {c.titleWord.upper() for c in draft.chapters}
    seen_words = set()
    candidates: list[list[str]] = []
    for i, c in enumerate(draft.chapters):
        where = f"chapters.{i}"
        proposed = [h for h in [*c.headings, *([c.heading] if c.heading else [])] if isinstance(h, str) and h.strip()]
        usable = [h.strip() for h in proposed if not heading_problems(h, source_numbers)]
        usable = list(dict.fromkeys(usable))
        candidates.append(usable)
        if usable:
            c.heading = usable[0]
        else:
            why = heading_problems(proposed[0], source_numbers) if proposed else ["no heading given"]
            errors.append(f"{where}.headings: none of the candidate headings can be used ({'; '.join(why)}); "
                          f"give {HEADING_CANDIDATES} new ones")
            c.heading = proposed[0] if proposed else ""
        if problem := kit_problem(c.sceneTemplate, c.artKit):
            errors.append(f"{where}: {problem}")
        if problem := landmark_problem(c.artKit, topic):
            errors.append(f"{where}: {problem}")
        if c.source not in content.sources:
            errors.append(f'{where}.source: "{c.source}" is not one of the SOURCE ids ({", ".join(content.sources)})')
        invented = sorted(_numbers(f"{c.heading} {c.subheading} {c.body}") - source_numbers)
        if invented:
            errors.append(f"{where}: these numbers are not in the SOURCE TEXT: {', '.join(invented)}; use only numbers from the source")
        if not _word_in(c.titleWord, f"{topic} {source_text}"):
            errors.append(
                f"{where}.titleWord: {c.titleWord} does not appear in the topic or SOURCE TEXT; "
                f"pick one of: {', '.join(_title_candidates(source_text, used_words))}"
            )
        if c.landmark and not any(
            _word_in(w, f"{topic} {source_text}") for w in re.findall(r"[^\W\d_][\w'-]{3,}", c.landmark.name)
        ):
            errors.append(f"{where}.landmark: \"{c.landmark.name}\" is not named in the SOURCE TEXT; use a structure the source names, or null")
        if c.titleWord.upper() in seen_words:
            errors.append(
                f"{where}.titleWord: {c.titleWord} is used twice; every chapter needs its own word, "
                f"for example one of: {', '.join(_title_candidates(source_text, used_words))}"
            )
        seen_words.add(c.titleWord.upper())
    if errors:
        raise SpecInvalid(errors)

    try:
        return assemble(draft, topic, content), candidates
    except ValidationError as e:
        # Map spec paths back to what the model wrote (label prefix is ours).
        raise SpecInvalid([m.replace(".label:", ".labelName:") for m in _pydantic_errors(e)]) from e


def _write_valid(content, chain, messages, chapters, max_tokens, budget):
    """Ask until a draft validates, feeding errors back. Returns (spec, provider, attempts, messages, raw)."""
    last_errors: list[str] = []
    for attempt in range(1, budget + 1):
        provider, raw = chain.complete_json(SYSTEM, messages, max_tokens)
        try:
            spec, cands = validate_draft_full(raw, content.topic, content, chapters)
            chain.last_candidates = cands
            return spec, provider, attempt, messages + [{"role": "assistant", "content": raw[:6000]}]
        except SpecInvalid as e:
            last_errors = e.errors
            chain.notes.append(f"attempt {attempt} invalid: {len(e.errors)} problem(s)")
            chain.validation_log.append(list(e.errors))
            messages = messages[:1] + [
                {"role": "assistant", "content": raw[:6000]},
                {"role": "user", "content": correction_prompt(e.errors)},
            ]
    raise SpecInvalid(last_errors)


def generate_spec(content: RetrievedContent, chain: FallbackChain, chapters: int = 3, ground: bool = True, style: bool | None = None,
                  checker_for: Callable[[str], FallbackChain] | None = None,
                  on_stage: Callable[[str], None] | None = None) -> GenerationResult:
    """One story call (+ up to MAX_CORRECTIONS corrections), then a grounding check call.
    Unsupported sentences go back once for correction; any still unsupported are removed."""
    max_tokens = get_settings().llm_max_output_tokens
    messages = [{"role": "user", "content": build_prompt(content, chapters)}]
    try:
        spec, provider, attempts, messages = _write_valid(content, chain, messages, chapters, max_tokens, MAX_CORRECTIONS + 1)
    except SpecInvalid as e:
        raise GenerationFailed(
            f"The model could not write a valid story after {MAX_CORRECTIONS} corrections. Last problems: " + "; ".join(e.errors[:6])
        ) from e

    # Writing-quality passes (fail soft): a small judge picks headings, the writer edits flat lines.
    writer = chain.last_model
    judge = checker_for(writer) if checker_for else chain
    if STYLE_PASSES if style is None else style:
        spec = pick_headings(spec, getattr(chain, "last_candidates", []), judge, chain.notes)
        spec = critique_style(spec, chain, chain.notes)

    grounding = None
    if ground:
        # A different model checks the facts; the writer grading itself is too lenient.
        checker = judge
        if checker is not chain:
            checker.on_event = chain.on_event
        if on_stage:
            on_stage("checking")
        try:
            report = check_grounding(spec, content, checker)
            if report.unsupported:
                chain.notes.append(f"grounding: {len(report.unsupported)} unsupported sentence(s), asking for a correction")
                if on_stage:
                    on_stage("correcting")
                fix = messages + [{"role": "user", "content": grounding_correction_prompt(report)}]
                # The rewrite and its re-check are best effort: if either fails (invalid draft, free-tier
                # quota), keep the checked first version and remove its unsupported sentences instead.
                try:
                    fixed, fixed_provider, _, _ = _write_valid(content, chain, fix, chapters, max_tokens, 2)
                    if on_stage:
                        on_stage("checking")
                    spec, report, provider = fixed, check_grounding(fixed, content, checker), fixed_provider
                except SpecInvalid:
                    chain.notes.append("grounding correction did not validate; keeping the first version")
                except (LLMError, ValueError) as e:
                    chain.notes.append(f"grounding correction unavailable ({e}); keeping the first version")
            spec, kept = remove_unsupported(spec, report)
            if report.unsupported:
                chain.notes.append(f"grounding: removed {len(report.unsupported) - len(kept)} sentence(s)")
            grounding = report.as_dict() | {"writtenBy": writer,"removed": [c.id for c in report.unsupported_claims() if c.id not in kept], "kept": kept}
        except (LLMError, ValueError) as e:
            chain.notes.append(f"grounding check skipped: {e}")
            grounding = {"score": None, "skipped": str(e)[:400], "writtenBy": writer}
        chain.notes.extend(n for n in checker.notes if checker is not chain)
    return GenerationResult(spec=spec, provider=provider, attempts=attempts, notes=list(chain.notes), grounding=grounding)
