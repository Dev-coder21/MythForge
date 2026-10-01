import httpx
import pytest

from app.retrieval import ThinContentError, gather_content
from app.retrieval.wikipedia import WikiPage, ascii_digits, word_count

THIN_EN = "A small temple in Pune. " * 10  # 50 words
RICH_HI = "मंदिर का इतिहास बहुत पुराना है और यह शहर के बीच स्थित है। " * 60  # ~700 words
HI_DIGITS = "इसका निर्माण १७३६ में हुआ।"


def make_client(hi_text: str | None):
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        host = req.url.host
        params = dict(req.url.params)
        if host == "www.wikidata.org":
            if params.get("action") == "wbsearchentities":
                return httpx.Response(200, json={"search": [{"id": "Q1"}]})
            sitelinks = {"enwiki": {"title": "Test Temple"}}
            if hi_text:
                sitelinks["hiwiki"] = {"title": "परीक्षा मंदिर"}
            return httpx.Response(200, json={"entities": {"Q1": {
                "sitelinks": sitelinks,
                "labels": {"en": {"value": "Test Temple"}},
                "aliases": {"en": [{"value": "Pariksha Mandir"}]},
                "claims": {"P17": [{"mainsnak": {"datavalue": {"value": {"id": "Q668"}}}}]},
            }}})
        lang = host.split(".")[0]
        if "rest_v1/page/summary" in url:
            if lang == "hi":
                return httpx.Response(200, json={"title": "परीक्षा मंदिर", "extract": HI_DIGITS, "type": "standard"})
            return httpx.Response(200, json={"title": "Test Temple", "extract": THIN_EN, "type": "standard"})
        if params.get("list") == "search":
            return httpx.Response(200, json={"query": {"search": [{"title": "Test Temple"}]}})
        if params.get("prop") == "pageprops":
            return httpx.Response(200, json={"query": {"pages": [{"pageprops": {"wikibase_item": "Q1"}}]}})
        if params.get("prop") == "extracts":
            text = (hi_text or "") if lang == "hi" else THIN_EN
            return httpx.Response(200, json={"query": {"pages": [{"extract": text}]}})
        if "commons" in host:
            return httpx.Response(200, json={"query": {"pages": []}})
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_thin_english_is_completed_by_the_local_language(db):
    content = gather_content("Test Temple", db, make_client(RICH_HI))
    langs = [p.lang for p in content.pages]
    assert langs == ["en", "hi"]
    assert "wikipedia:hi:परीक्षा मंदिर" in content.sources
    text = content.as_prompt_text()
    assert "(written in Hindi)" in text and "1736" in text  # Devanagari digits normalised
    assert "Pariksha Mandir" in content.names and content.has_foreign


def test_rejection_lists_every_language_tried(db):
    with pytest.raises(ThinContentError) as e:
        gather_content("Test Temple", db, make_client(None))
    msg = str(e.value)
    assert "English (100 words)" in msg and "Hindi (no article)" in msg and "Marathi (no article)" in msg


def test_word_count_and_digits():
    assert word_count("東京は日本の首都です。", "ja") == 5  # characters / 2 for scripts without spaces
    assert word_count("one two three", "en") == 3
    assert ascii_digits("१७३६ ٢٠٢٤ １２") == "1736 2024 12"
    assert WikiPage("X", "u", "s", lang="ja").source_id == "wikipedia:ja:X"
    assert WikiPage("Star Wars: A New Hope", "u", "s").source_id == "wikipedia:Star Wars: A New Hope"
