"""Retrieval with mocked HTTP: article selection, section trimming, licenses, thin topics, cache."""

import httpx
import pytest

from app.retrieval import ThinContentError, gather_content
from app.retrieval.http import make_client
from app.retrieval.wikipedia import select_sections, split_sections

LONG = " ".join(["The mountain rises above the plain and its snowfields feed the rivers below."] * 40)

EXTRACT = f"""Mount Test is a volcano.
== Etymology ==
The name comes from an old word.
== History ==
{LONG}
== Geology ==
{LONG}
== See also ==
Other mountains
== References ==
Book one
"""


def wiki_handler(calls: list[str], *, extract: str = EXTRACT, disambiguation_first: bool = False):
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        calls.append(url)
        if "commons.wikimedia.org" in url:
            return httpx.Response(200, json={"query": {"pages": [
                {"index": 1, "title": "File:Ok.jpg", "imageinfo": [{"thumburl": "https://upload/ok.jpg", "extmetadata": {
                    "LicenseShortName": {"value": "CC BY-SA 4.0"}, "Artist": {"value": "<a href='x'>Jane Doe</a>"}}}]},
                {"index": 2, "title": "File:Nope.jpg", "imageinfo": [{"thumburl": "https://upload/nope.jpg", "extmetadata": {
                    "LicenseShortName": {"value": "All rights reserved"}, "Artist": {"value": "Someone"}}}]},
            ]}})
        if "list=search" in url:
            titles = ["Mount Test (disambiguation)", "Mount Test"] if disambiguation_first else ["Mount Test"]
            return httpx.Response(200, json={"query": {"search": [{"title": t} for t in titles]}})
        if "/page/summary/" in url:
            if "disambiguation" in url:
                return httpx.Response(200, json={"type": "disambiguation", "title": "Mount Test (disambiguation)"})
            return httpx.Response(200, json={"type": "standard", "title": "Mount Test", "extract": "Mount Test is a volcano.",
                                             "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Mount_Test"}}})
        if "prop=extracts" in url:
            return httpx.Response(200, json={"query": {"pages": [{"title": "Mount Test", "extract": extract}]}})
        return httpx.Response(404)

    return handler


def test_split_sections_drops_boilerplate():
    headings = [h for h, _ in split_sections(EXTRACT)]
    assert headings == ["Introduction", "Etymology", "History", "Geology"]


def test_select_sections_respects_budget_and_order():
    chosen = select_sections(split_sections(EXTRACT), max_words=300)
    assert sum(len(b.split()) for _, b in chosen) <= 310
    assert chosen[0][0] == "Introduction"
    assert "History" in [h for h, _ in chosen]  # preferred section kept


def test_gather_builds_sources_images_and_caches(db):
    calls: list[str] = []
    with make_client(httpx.MockTransport(wiki_handler(calls, disambiguation_first=True))) as client:
        content = gather_content("Mount Test", db, client)
        assert content.sources == ["wikipedia:Mount Test"]
        assert "## History" in content.as_prompt_text()
        # Only the freely licensed image, with a clean attribution.
        assert content.images == [{"url": "https://upload/ok.jpg", "attribution": "Jane Doe · CC BY-SA 4.0 · Wikimedia Commons",
                                   "license": "CC BY-SA 4.0", "title": "File:Ok.jpg"}]
        n = len(calls)
        again = gather_content("mount test", db, client)  # cache hit: no new HTTP calls
        assert len(calls) == n and again.sources == content.sources


def test_thin_topic_rejected_with_clear_message(db):
    with make_client(httpx.MockTransport(wiki_handler([], extract="Mount Test is a volcano."))) as client:
        with pytest.raises(ThinContentError, match="not enough verified material"):
            gather_content("Mount Test", db, client)


def test_no_article(db):
    def handler(request):
        return httpx.Response(200, json={"query": {"search": []}})

    with make_client(httpx.MockTransport(handler)) as client:
        with pytest.raises(ThinContentError, match="no article"):
            gather_content("Qwxzv", db, client)
