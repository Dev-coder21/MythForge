"""
Gather everything the LLM may use for a topic: one Wikipedia article (summary +
relevant sections) and a few Commons images. Results are cached in the DB, and
thin topics are rejected before any LLM tokens are spent.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import CachedContent, SourceType
from app.retrieval.commons import search_images
from app.retrieval.wikipedia import WikiPage, fetch_page


class ThinContentError(Exception):
    """Not enough verified material to write a story without inventing facts."""


@dataclass
class RetrievedContent:
    topic: str
    pages: list[WikiPage]
    images: list[dict] = field(default_factory=list)

    @property
    def sources(self) -> list[str]:
        return [p.source_id for p in self.pages]

    def words(self) -> int:
        return sum(p.words() for p in self.pages)

    def as_prompt_text(self) -> str:
        """Compact source text for the prompt: only what the model may state as fact."""
        out = []
        for p in self.pages:
            out.append(f"[SOURCE {p.source_id}]")
            out.append(f"Summary: {p.summary}")
            for heading, body in p.sections:
                if heading == "Introduction" and body.startswith(p.summary[:80]):
                    continue  # the summary already says it
                out.append(f"## {heading}\n{body}")
        return "\n".join(out)


def _cache_get(db: Session, kind: SourceType, key: str) -> dict | None:
    ttl = timedelta(days=get_settings().cache_ttl_days)
    row = db.scalars(
        select(CachedContent).where(CachedContent.source_type == kind, CachedContent.query == key).order_by(CachedContent.fetched_at.desc())
    ).first()
    if not row:
        return None
    fetched = row.fetched_at if row.fetched_at.tzinfo else row.fetched_at.replace(tzinfo=UTC)
    return row.raw_content if datetime.now(UTC) - fetched < ttl else None


def _cache_put(db: Session, kind: SourceType, key: str, data: dict) -> None:
    db.add(CachedContent(source_type=kind, query=key, raw_content=data))
    db.commit()


def gather_content(topic: str, db: Session, client: httpx.Client) -> RetrievedContent:
    s = get_settings()
    key = f"{s.wiki_lang}:{topic.strip().lower()}"

    raw = _cache_get(db, SourceType.wikipedia, key)
    if raw is None:
        page = fetch_page(client, topic, s.wiki_lang, s.max_source_words)
        raw = {"page": asdict(page) if page else None}
        _cache_put(db, SourceType.wikipedia, key, raw)
    page_data = raw["page"]
    page = WikiPage(**{**page_data, "sections": [tuple(x) for x in page_data["sections"]]}) if page_data else None

    if page is None:
        raise ThinContentError(f'Wikipedia has no article that matches "{topic}". Try the common English name of a place, event or idea.')
    content = RetrievedContent(topic=topic, pages=[page])
    words = content.words()
    if words < s.min_content_words:
        raise ThinContentError(
            f'There is not enough verified material about "{topic}" to write a story without inventing facts '
            f"(found {words} words on Wikipedia, need at least {s.min_content_words}). Try a better-known or broader topic."
        )

    images = _cache_get(db, SourceType.commons, key)
    if images is None:
        try:
            found = search_images(client, page.title)
        except httpx.HTTPError:
            found = []  # images are optional; never fail a story over them
        images = {"images": found}
        _cache_put(db, SourceType.commons, key, images)
    content.images = images["images"]
    return content
