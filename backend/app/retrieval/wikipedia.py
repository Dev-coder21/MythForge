"""Wikipedia: find the article for a topic, then its summary and the most relevant sections."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import quote

import httpx

# Sections that never hold usable story facts.
SKIP_SECTIONS = {
    "see also", "references", "external links", "notes", "further reading", "bibliography",
    "gallery", "sources", "citations", "footnotes", "works cited", "explanatory notes",
}
# Sections that usually hold the vivid, story-worthy facts; preferred when trimming.
PREFERRED = (
    "history", "construction", "geography", "geology", "description", "architecture", "name",
    "etymology", "culture", "legacy", "significance", "climate", "discovery", "design", "religion",
    "ecology", "formation", "mythology", "tourism", "structure",
)


@dataclass
class WikiPage:
    title: str
    url: str
    summary: str
    sections: list[tuple[str, str]] = field(default_factory=list)

    @property
    def source_id(self) -> str:
        """Chapter source reference, e.g. 'wikipedia:Mount Fuji'."""
        return f"wikipedia:{self.title}"

    def words(self) -> int:
        return len(self.summary.split()) + sum(len(t.split()) for _, t in self.sections)


def _api(lang: str) -> str:
    return f"https://{lang}.wikipedia.org/w/api.php"


def search_titles(client: httpx.Client, topic: str, lang: str = "en", limit: int = 3) -> list[str]:
    r = client.get(
        _api(lang),
        params={"action": "query", "list": "search", "srsearch": topic, "srlimit": limit, "format": "json", "formatversion": 2},
    )
    r.raise_for_status()
    return [hit["title"] for hit in r.json().get("query", {}).get("search", [])]


def fetch_summary(client: httpx.Client, title: str, lang: str = "en") -> dict | None:
    """REST summary; None for disambiguation pages or misses."""
    r = client.get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'), safe='')}")
    if r.status_code == 404:
        return None
    r.raise_for_status()
    data = r.json()
    if data.get("type") == "disambiguation":
        return None
    return data


def fetch_sections(client: httpx.Client, title: str, lang: str = "en") -> list[tuple[str, str]]:
    """Plain-text article split into (heading, text) sections, boilerplate sections dropped."""
    r = client.get(
        _api(lang),
        params={
            "action": "query", "prop": "extracts", "explaintext": 1, "exsectionformat": "wiki",
            "titles": title, "redirects": 1, "format": "json", "formatversion": 2,
        },
    )
    r.raise_for_status()
    pages = r.json().get("query", {}).get("pages", [])
    text = pages[0].get("extract", "") if pages else ""
    return split_sections(text)


def split_sections(text: str) -> list[tuple[str, str]]:
    parts = re.split(r"^(={2,6})\s*(.+?)\s*\1\s*$", text, flags=re.MULTILINE)
    sections: list[tuple[str, str]] = []
    lead = parts[0].strip()
    if lead:
        sections.append(("Introduction", lead))
    for i in range(1, len(parts) - 2, 3):
        heading, body = parts[i + 1].strip(), parts[i + 2].strip()
        if body and heading.lower() not in SKIP_SECTIONS:
            sections.append((heading, re.sub(r"\n{2,}", "\n", body)))
    return sections


def select_sections(sections: list[tuple[str, str]], max_words: int) -> list[tuple[str, str]]:
    """Keep the introduction, then preferred sections, then the rest, within a word budget."""

    def rank(item: tuple[int, tuple[str, str]]) -> tuple[int, int]:
        i, (heading, _) = item
        h = heading.lower()
        if h == "introduction":
            return (0, i)
        return (1 if any(p in h for p in PREFERRED) else 2, i)

    chosen: list[tuple[int, tuple[str, str]]] = []
    used = 0
    for i, (heading, body) in sorted(enumerate(sections), key=rank):
        words = body.split()
        if used >= max_words:
            break
        room = max_words - used
        if len(words) > room:
            if room < 60:
                continue
            body = " ".join(words[:room]) + " ..."
        chosen.append((i, (heading, body)))
        used += min(len(words), room)
    return [s for _, s in sorted(chosen)]  # back in article order


def fetch_page(client: httpx.Client, topic: str, lang: str = "en", max_words: int = 1800) -> WikiPage | None:
    """Best article for the topic (skipping disambiguation pages), trimmed to the word budget."""
    for title in search_titles(client, topic, lang):
        summary = fetch_summary(client, title, lang)
        if not summary:
            continue
        real_title = summary.get("title", title)
        sections = select_sections(fetch_sections(client, real_title, lang), max_words)
        url = summary.get("content_urls", {}).get("desktop", {}).get("page") or f"https://{lang}.wikipedia.org/wiki/{quote(real_title.replace(' ', '_'))}"
        return WikiPage(title=real_title, url=url, summary=summary.get("extract", ""), sections=sections)
    return None
