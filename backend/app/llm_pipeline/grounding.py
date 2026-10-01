"""
Sentence-level grounding: a second (free) LLM call checks every sentence of
heading, subheading and body against the retrieved source text.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from app.llm_pipeline.providers import FallbackChain
from app.retrieval import RetrievedContent
from app.schemas.story import StorySpec

FIELDS = ("heading", "subheading", "body")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")

SYSTEM = """You are a strict fact checker. You compare short story sentences with a source text.
A sentence is SUPPORTED when every factual claim in it (names, numbers, dates, places, events, causes, superlatives)
is stated in or directly implied by the SOURCE TEXT. Figurative or atmospheric wording is fine when it asserts no
fact beyond the source ("Carved from the ground itself." about a statue carved from bedrock is supported).
A sentence is UNSUPPORTED when it adds, changes, exaggerates or wrongly combines facts.
Hedges matter: if the source hedges ("about five months", "up to 25,000", "roughly", "is thought to", "possibly")
and the sentence states it as exact or certain ("five months", "25,000", "was"), it is UNSUPPORTED.
Headings are checked too: a heading that states or implies a fact (size, age, distance, visibility, a first,
a record or other superlative, a cause) must be supported like any sentence. A heading that stretches a fact into
something the source does not say (for example "visible from space" or "glows from other stars" when the source
only gives an area) is UNSUPPORTED. Pure mood or imagery that claims nothing is fine.
The SOURCE TEXT may be in another language; compare meaning, not wording.
Be strict: when in doubt, mark it unsupported.
Return only JSON."""


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_END.split(text.strip()) if s.strip()]


@dataclass
class Claim:
    id: str
    chapter: int  # 0-based
    field: str
    text: str


@dataclass
class GroundingReport:
    claims: list[Claim]
    unsupported: dict[str, str] = field(default_factory=dict)  # claim id -> reason
    provider: str = ""
    checked_by: str = ""  # provider:model that ran the check

    @property
    def score(self) -> float:
        if not self.claims:
            return 1.0
        return round((len(self.claims) - len(self.unsupported)) / len(self.claims), 3)

    def unsupported_claims(self) -> list[Claim]:
        return [c for c in self.claims if c.id in self.unsupported]

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "checkedBy": self.checked_by,
            "sentences": len(self.claims),
            "unsupported": [
                {"id": c.id, "field": c.field, "text": c.text, "reason": self.unsupported[c.id]} for c in self.unsupported_claims()
            ],
        }


def claims_of(spec: StorySpec) -> list[Claim]:
    out = []
    for ci, ch in enumerate(spec.chapters):
        for f in FIELDS:
            for si, sentence in enumerate(split_sentences(getattr(ch, f))):
                out.append(Claim(f"c{ci + 1}.{f}.{si + 1}", ci, f, sentence))
        if ch.landmark:
            # The landmark description drives an image, so it is checked like any sentence.
            out.append(Claim(f"c{ci + 1}.landmark.1", ci, "landmark", f"{ch.landmark.name}: {ch.landmark.description}"))
    return out


def build_check_prompt(claims: list[Claim], content: RetrievedContent) -> str:
    listed = "\n".join(f"{c.id}: {c.text}" for c in claims)
    return f"""SOURCE TEXT
{content.as_prompt_text()}

SENTENCES
{listed}

Check every sentence id. Return JSON: {{"unsupported": [{{"id": "c1.body.2", "reason": "source says X, not Y"}}]}}
List only unsupported sentences (an empty list when everything is supported). Keep reasons under 20 words."""


def check_grounding(spec: StorySpec, content: RetrievedContent, chain: FallbackChain, max_tokens: int = 800) -> GroundingReport:
    claims = claims_of(spec)
    provider, raw = chain.complete_json(SYSTEM, [{"role": "user", "content": build_check_prompt(claims, content)}], max_tokens)
    known = {c.id for c in claims}
    unsupported: dict[str, str] = {}
    try:
        data = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
        for item in data.get("unsupported", []):
            if isinstance(item, dict) and item.get("id") in known:
                unsupported[item["id"]] = str(item.get("reason", "not in the source"))[:200]
    except (json.JSONDecodeError, AttributeError) as e:
        raise ValueError(f"grounding check returned unreadable JSON ({e})") from e
    return GroundingReport(claims=claims, unsupported=unsupported, provider=provider, checked_by=chain.last_model or provider)


def check_texts(texts: list[str], content: RetrievedContent, chain: FallbackChain, max_tokens: int = 300) -> list[bool]:
    """Fact-check loose candidate lines (e.g. alternative headings); True = supported."""
    claims = [Claim(f"alt.{i + 1}", 0, "heading", t) for i, t in enumerate(texts)]
    _, raw = chain.complete_json(SYSTEM, [{"role": "user", "content": build_check_prompt(claims, content)}], max_tokens)
    data = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
    bad = {item.get("id") for item in data.get("unsupported", []) if isinstance(item, dict)}
    return [c.id not in bad for c in claims]


def remove_unsupported(spec: StorySpec, report: GroundingReport, min_body_words: int = 20) -> tuple[StorySpec, list[str]]:
    """Drop sentences still unsupported. A field keeps its last sentence (and a body its minimum length),
    so the spec stays renderable; anything kept is returned so it can be reported."""
    data = spec.model_dump(mode="json")
    kept: list[str] = []
    for ci, ch in enumerate(data["chapters"]):
        if ch.get("landmark") and f"c{ci + 1}.landmark.1" in report.unsupported:
            ch["landmark"] = None  # never paint a structure the sources don't support
        for f in FIELDS:
            sentences = split_sentences(ch[f])
            bad = {i for i, _ in enumerate(sentences) if f"c{ci + 1}.{f}.{i + 1}" in report.unsupported}
            if not bad:
                continue
            remaining = [s for i, s in enumerate(sentences) if i not in bad]
            too_short = not remaining or (f == "body" and len(" ".join(remaining).split()) < min_body_words)
            if too_short:
                kept.extend(f"c{ci + 1}.{f}.{i + 1}" for i in sorted(bad))
                continue
            ch[f] = " ".join(remaining)
    return StorySpec.model_validate(data), kept
