"""
StorySpec: the single contract between backend and frontend.

Mirrors frontend/src/spec/types.ts field for field; keep the two in sync.
On top of the types, the copy rules from CLAUDE.md are enforced as validation
errors, so the LLM pipeline's correction retries fix them.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]

SceneTemplateId = Literal["threshold", "peak", "tide", "grove", "skyline", "dune", "cosmos", "ruin"]
ParticleType = Literal["petals", "snow", "embers", "fireflies", "dust", "rain", "none"]
GroundType = Literal["grass", "sand", "water", "stone", "void"]
BackgroundObject = Literal["moon", "sun", "stars", "clouds", "none"]
TimeOfDay = Literal["dawn", "day", "dusk", "night"]
TitleLayout = Literal["horizontal", "vertical"]
TransitionType = Literal["noise-dissolve", "ink-wipe", "bloom-out"]

# --------------------------------------------------------------------- copy rules
EM_DASH = "—"
# "it's not X, it's Y" and its cousins ("less like X, more like Y", "not just X, but Y").
_NOT_X_BUT_Y = re.compile(
    r"\b(it'?s|it is|this is|that'?s|was|is|are)\s+not\s+(just\s+|only\s+|merely\s+)?[^.;:!?]{1,60}[,;]\s*(it'?s|it is|but|rather)\b"
    r"|\bless\s+(like|a|an)\b[^.;]{1,60}\bmore\s+(like|a|an)\b"
    r"|\bnot\s+(just|only|merely)\s+[^.;]{1,60},?\s+but\s+(also\s+)?",
    re.IGNORECASE,
)
# Stock travel-writing phrases the editorial voice avoids.
CLICHES = (
    "hidden gem", "nestled", "tapestry", "testament to", "rich history", "step back in time",
    "journey through", "breathtaking", "awe-inspiring", "must-see", "bustling", "vibrant",
    "delve", "a feast for the senses", "stands the test of time", "time stood still", "lorem ipsum",
    "untold story", "in the heart of",
)


def copy_problems(text: str) -> list[str]:
    """Copy-rule violations in one piece of text (empty = clean)."""
    problems = []
    if EM_DASH in text:
        problems.append("contains an em dash; use a comma, full stop or the middle dot instead")
    if _NOT_X_BUT_Y.search(text):
        problems.append('uses a "not X, it\'s Y" construction; state the point directly')
    low = text.lower()
    for c in CLICHES:
        if c in low:
            problems.append(f'uses the cliche "{c}"')
    return problems


def _check_copy(value: str) -> str:
    problems = copy_problems(value)
    if problems:
        raise ValueError("; ".join(problems))
    return value


CopyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SceneParams(_Model):
    primaryColor: HexColor
    accentColor: HexColor
    particleType: ParticleType
    groundType: GroundType
    backgroundObject: BackgroundObject
    propVariant: str
    artKit: str
    timeOfDay: TimeOfDay
    props: list[str] = Field(default_factory=list)
    particleDensity: float | None = Field(default=None, ge=0, le=1)


class ImageRef(_Model):
    url: str
    attribution: str
    license: str | None = None


class Chapter(_Model):
    index: int = Field(ge=1)
    label: str
    titleWord: str
    heading: CopyText
    subheading: CopyText
    body: CopyText
    sceneTemplate: SceneTemplateId
    sceneParams: SceneParams
    titleLayout: TitleLayout | None = None
    source: str | None = None
    transition: TransitionType
    heroImage: ImageRef | None = None

    @field_validator("label")
    @classmethod
    def _label(cls, v: str) -> str:
        if not re.fullmatch(r"CHAPTER \d{2} · [A-Z0-9][A-Z0-9 ,'\-]{1,48}", v):
            raise ValueError('label must look like "CHAPTER 01 · THE HIDDEN GATE" (uppercase, middle dot separator)')
        return _check_copy(v)

    @field_validator("titleWord")
    @classmethod
    def _title_word(cls, v: str) -> str:
        if not re.fullmatch(r"[A-Z]{2,10}", v):
            raise ValueError("titleWord must be one uppercase word of 2 to 10 letters (A-Z only)")
        return v

    @field_validator("heading", "subheading", "body")
    @classmethod
    def _copy(cls, v: str) -> str:
        return _check_copy(v)

    @field_validator("heading")
    @classmethod
    def _heading_len(cls, v: str) -> str:
        if len(v) > 80:
            raise ValueError("heading must be at most 80 characters")
        return v

    @field_validator("body")
    @classmethod
    def _body_len(cls, v: str) -> str:
        words = len(v.split())
        if not 20 <= words <= 90:
            raise ValueError(f"body must be 20 to 90 words (got {words})")
        return v


class StorySpec(_Model):
    version: Literal[1] = 1
    id: str
    topic: str
    title: CopyText
    subtitle: CopyText
    slug: Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]
    chapters: list[Chapter] = Field(min_length=1)
    createdAt: str

    @field_validator("title", "subtitle")
    @classmethod
    def _copy(cls, v: str) -> str:
        return _check_copy(v)

    @field_validator("chapters")
    @classmethod
    def _ordered(cls, v: list[Chapter]) -> list[Chapter]:
        if [c.index for c in v] != list(range(1, len(v) + 1)):
            raise ValueError("chapter indices must run 1, 2, 3 ... in order")
        return v
