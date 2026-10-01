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
from app.retrieval.wikidata import LANG_NAMES, fetch_entity, matches_type, qid_for_title, search_qid, type_labels
from app.retrieval.wikipedia import WikiPage, ascii_digits, fetch_page, fetch_page_by_title, select_sections


class ThinContentError(Exception):
    """Not enough verified material to write a story without inventing facts."""


@dataclass
class RetrievedContent:
    topic: str
    pages: list[WikiPage]
    images: list[dict] = field(default_factory=list)
    # English label and aliases from Wikidata (lets English title words match non-Latin sources).
    names: list[str] = field(default_factory=list)
    # Languages tried and their word counts, for messages and the Sources panel.
    tried: dict[str, int] = field(default_factory=dict)

    @property
    def has_foreign(self) -> bool:
        return any(p.lang != "en" for p in self.pages)

    @property
    def sources(self) -> list[str]:
        return [p.source_id for p in self.pages]

    def words(self) -> int:
        return sum(p.words() for p in self.pages)

    def as_prompt_text(self) -> str:
        """Compact source text for the prompt: only what the model may state as fact."""
        out = []
        for p in self.pages:
            lang = "" if p.lang == "en" else f" (written in {LANG_NAMES.get(p.lang, p.lang)})"
            out.append(f"[SOURCE {p.source_id}]{lang}")
            out.append(f"Summary: {p.summary}")
            for heading, body in p.sections:
                if heading == "Introduction" and body.startswith(p.summary[:80]):
                    continue  # the summary already says it
                out.append(f"## {heading}\n{body}")
        return ascii_digits("\n".join(out))


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


def _page_from(d: dict) -> WikiPage:
    return WikiPage(**{**d, "sections": [tuple(x) for x in d["sections"]]})


def _english(topic: str, db: Session, client: httpx.Client) -> WikiPage | None:
    s = get_settings()
    key = f"{s.wiki_lang}:{topic.strip().lower()}"
    raw = _cache_get(db, SourceType.wikipedia, key)
    if raw is None:
        page = fetch_page(client, topic, s.wiki_lang, s.max_source_words)
        raw = {"page": asdict(page) if page else None}
        _cache_put(db, SourceType.wikipedia, key, raw)
    return _page_from(raw["page"]) if raw["page"] else None


def _other_languages(topic: str, en: WikiPage | None, db: Session, client: httpx.Client) -> dict:
    """Wikidata sitelinks in the topic's local languages (then fr, de, es), measured. Cached."""
    s = get_settings()
    key = f"multi:{topic.strip().lower()}"
    raw = _cache_get(db, SourceType.wikipedia, key)
    if raw is not None:
        return raw
    raw = {"names": [], "pages": [], "tried": {}, "skipped": {}}
    try:
        qid = qid_for_title(client, en.title) if en else None
        qid = qid or search_qid(client, topic)
        if qid:
            entity = fetch_entity(client, qid)
            raw["names"] = entity.names
            # Local languages without an article are reported too ("Hindi (no article)").
            for lang in entity.local_langs()[:4]:
                if lang not in entity.sitelinks:
                    raw["tried"][lang] = 0
            for lang in entity.candidate_langs():
                page = fetch_page_by_title(client, entity.sitelinks[lang], lang, s.max_source_words)
                raw["tried"][lang] = page.words() if page else 0
                if not page:
                    continue
                # Wikidata sometimes links an article about a related subject (a festival committee for a
                # temple); keep it only if it reads as the same kind of thing as the topic.
                if not matches_type(page.title, page.summary, type_labels(client, entity.types, lang)):
                    raw["skipped"][lang] = page.title
                    continue
                raw["pages"].append(asdict(page))
    except httpx.HTTPError:
        pass  # other languages are a bonus; English-only still works
    _cache_put(db, SourceType.wikipedia, key, raw)
    return raw


def gather_content(topic: str, db: Session, client: httpx.Client) -> RetrievedContent:
    s = get_settings()
    en = _english(topic, db, client)
    en_words = en.words() if en else 0
    pages = [en] if en else []
    tried = {"en": en_words}
    names: list[str] = []
    if en_words < 0.6 * s.max_source_words:
        # Thin in English: add the richest other-language articles within the remaining budget.
        multi = _other_languages(topic, en, db, client)
        names = multi["names"]
        tried |= multi["tried"]
        budget = max(700, s.max_source_words - en_words)
        for d in sorted(multi["pages"], key=lambda d: -multi["tried"].get(d["lang"], 0)):
            if budget < 200:
                break
            page = _page_from(d)
            page.sections = select_sections(page.sections, budget, page.lang)
            if page.words() < 120:
                continue
            pages.append(page)
            budget -= page.words()
    content = RetrievedContent(topic=topic, pages=pages, names=names, tried=tried)
    skipped = multi.get("skipped", {}) if en_words < 0.6 * s.max_source_words else {}
    words = content.words()
    if words < s.min_content_words:
        tried_text = ", ".join(
            f"{LANG_NAMES.get(lang, lang)} (about a different subject)" if lang in skipped
            else f"{LANG_NAMES.get(lang, lang)} ({n} words)" if n else f"{LANG_NAMES.get(lang, lang)} (no article)"
            for lang, n in tried.items()
        )
        if not pages:
            raise ThinContentError(
                f'No Wikipedia article matches "{topic}" in any language tried: {tried_text}. '
                "Try the common English or local name of a place, event or idea."
            )
        raise ThinContentError(
            f'There is not enough verified material about "{topic}" to write a story without inventing facts '
            f"(found {words} words in total, need at least {s.min_content_words}; tried {tried_text}). "
            "Try a better-known or broader topic."
        )

    key = f"{s.wiki_lang}:{topic.strip().lower()}"
    images = _cache_get(db, SourceType.commons, key)
    if images is None:
        try:
            found = search_images(client, en.title if en else (names[0] if names else topic))
        except httpx.HTTPError:
            found = []  # images are optional; never fail a story over them
        images = {"images": found}
        _cache_put(db, SourceType.commons, key, images)
    content.images = images["images"]
    return content
