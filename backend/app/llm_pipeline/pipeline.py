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
from app.llm_pipeline.prompt import SYSTEM, build_prompt, correction_prompt, grounding_correction_prompt
from app.llm_pipeline.providers import FallbackChain, LLMError
from app.retrieval import RetrievedContent
from app.schemas.story import RULES
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


class DraftChapter(BaseModel):
    """What the model writes per chapter; the server adds index, label prefix and ids."""

    model_config = ConfigDict(extra="ignore")
    labelName: str
    titleWord: str
    heading: str
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


class Draft(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    subtitle: str
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


def validate_draft(raw: str, topic: str, content: RetrievedContent, chapters: int) -> StorySpec:
    data = _parse_json(raw)
    try:
        draft = Draft.model_validate(data)
    except ValidationError as e:
        raise SpecInvalid(_pydantic_errors(e)) from e

    errors: list[str] = []
    if len(draft.chapters) != chapters:
        errors.append(f"there must be exactly {chapters} chapters (got {len(draft.chapters)})")
    source_text = content.as_prompt_text()
    source_numbers = _numbers(source_text)
    seen_words = set()
    for i, c in enumerate(draft.chapters):
        where = f"chapters.{i}"
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
            errors.append(f"{where}.titleWord: {c.titleWord} does not appear in the topic or SOURCE TEXT; use a word or name from them")
        heading = c.heading.strip()
        if len(heading) > RULES["generatedHeadingMax"]:
            errors.append(f"{where}.heading: {len(heading)} characters; keep it under {RULES['generatedHeadingMax']}, evocative, not a summary")
        if RULES["generatedHeadingNoDigits"] and re.search(r"\d", heading):
            errors.append(f"{where}.heading: no numbers or dates in headings; move the figure into the body")
        if c.titleWord.upper() in seen_words:
            errors.append(f"{where}.titleWord: {c.titleWord} is used twice; every chapter needs its own word")
        seen_words.add(c.titleWord.upper())
    if errors:
        raise SpecInvalid(errors)

    try:
        return assemble(draft, topic, content)
    except ValidationError as e:
        # Map spec paths back to what the model wrote (label prefix is ours).
        raise SpecInvalid([m.replace(".label:", ".labelName:") for m in _pydantic_errors(e)]) from e


def _write_valid(content, chain, messages, chapters, max_tokens, budget):
    """Ask until a draft validates, feeding errors back. Returns (spec, provider, attempts, messages, raw)."""
    last_errors: list[str] = []
    for attempt in range(1, budget + 1):
        provider, raw = chain.complete_json(SYSTEM, messages, max_tokens)
        try:
            spec = validate_draft(raw, content.topic, content, chapters)
            return spec, provider, attempt, messages + [{"role": "assistant", "content": raw[:6000]}]
        except SpecInvalid as e:
            last_errors = e.errors
            chain.notes.append(f"attempt {attempt} invalid: {len(e.errors)} problem(s)")
            messages = messages[:1] + [
                {"role": "assistant", "content": raw[:6000]},
                {"role": "user", "content": correction_prompt(e.errors)},
            ]
    raise SpecInvalid(last_errors)


def generate_spec(content: RetrievedContent, chain: FallbackChain, chapters: int = 3, ground: bool = True,
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

    grounding = None
    if ground:
        writer = chain.last_model
        # A different model checks the facts; the writer grading itself is too lenient.
        checker = checker_for(writer) if checker_for else chain
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
                try:
                    fixed, provider, _, _ = _write_valid(content, chain, fix, chapters, max_tokens, 2)
                    if on_stage:
                        on_stage("checking")
                    spec, report = fixed, check_grounding(fixed, content, checker)
                except SpecInvalid:
                    chain.notes.append("grounding correction did not validate; keeping the first version")
            spec, kept = remove_unsupported(spec, report)
            if report.unsupported:
                chain.notes.append(f"grounding: removed {len(report.unsupported) - len(kept)} sentence(s)")
            grounding = report.as_dict() | {"writtenBy": writer,"removed": [c.id for c in report.unsupported_claims() if c.id not in kept], "kept": kept}
        except (LLMError, ValueError) as e:
            chain.notes.append(f"grounding check skipped: {e}")
        chain.notes.extend(n for n in checker.notes if checker is not chain)
    return GenerationResult(spec=spec, provider=provider, attempts=attempts, notes=list(chain.notes), grounding=grounding)
