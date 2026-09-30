import json

import httpx
import pytest

from app.core.config import Settings
from app.llm_pipeline.pipeline import GenerationFailed, generate_spec, validate_draft, SpecInvalid
from app.llm_pipeline.prompt import build_prompt
from app.llm_pipeline.providers import (
    AllProvidersFailed,
    FallbackChain,
    GeminiProvider,
    GroqProvider,
    LLMError,
    RateLimitError,
    build_chain,
)
from app.retrieval import RetrievedContent
from app.retrieval.wikipedia import WikiPage

CONTENT = RetrievedContent(
    topic="Mount Fuji",
    pages=[WikiPage(
        title="Mount Fuji",
        url="https://en.wikipedia.org/wiki/Mount_Fuji",
        summary="Mount Fuji is an active stratovolcano on Honshu. It is 3,776.24 m tall and last erupted in 1707.",
        sections=[("Climbing", "Around 300,000 people climb the mountain each year, most in July and August.")],
    )],
    images=[{"url": "https://upload.wikimedia.org/fuji.jpg", "attribution": "Someone · CC BY-SA 4.0 · Wikimedia Commons", "license": "CC BY-SA 4.0", "title": "Fuji"}],
)

BODY = (
    "The volcano rises 3,776.24 m above Honshu and last erupted in 1707. Snow holds its summit most of the year, "
    "and the slope drops away in long grey lines toward the lakes, where the water keeps a second, quieter mountain "
    "for anyone who waits at dawn."
)


def chapter(**over):
    c = {
        "labelName": "THE WHITE CONE", "titleWord": "FUJI", "heading": "A mountain that keeps its own weather",
        "subheading": "Honshu, before sunrise", "body": BODY, "source": "wikipedia:Mount Fuji",
        "sceneTemplate": "threshold", "artKit": "lantern-dawn", "timeOfDay": "dawn", "backgroundObject": "stars",
        "particleType": "snow", "groundType": "stone", "primaryColor": "#1c2230", "accentColor": "#f2d7a6",
        "particleDensity": 0.4, "transition": "noise-dissolve", "titleLayout": "vertical",
    }
    c.update(over)
    return c


def draft(chapters=None):
    return json.dumps({"title": "Fuji", "subtitle": "A volcano held still by snow and patience",
                       "chapters": chapters or [chapter(), chapter(titleWord="ASH", artKit="temple-dusk", timeOfDay="dusk")]})


class Scripted:
    """Fake provider returning queued responses (strings) or raising queued exceptions."""

    def __init__(self, name, *responses):
        self.name, self.responses, self.calls = name, list(responses), []

    def complete_json(self, system, messages, max_tokens):
        self.calls.append(messages)
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def chain(*providers):
    return FallbackChain(list(providers), sleep=lambda s: None)


# validation

def test_valid_draft_assembles_full_spec():
    spec = validate_draft(draft(), "Mount Fuji", CONTENT, 2)
    c = spec.chapters[0]
    assert c.label == "CHAPTER 01 · THE WHITE CONE"
    assert c.heroImage and c.heroImage.license == "CC BY-SA 4.0"
    assert spec.slug == "fuji" and spec.chapters[1].index == 2


@pytest.mark.parametrize("over,needle", [
    ({"artKit": "nile"}, "does not exist"),
    ({"source": "wikipedia:Mars"}, "not one of the SOURCE ids"),
    ({"body": BODY.replace("1707", "1708")}, "1708"),
    ({"heading": "A mountain — of weather"}, "em dash"),
    ({"artKit": "torii-night"}, "not this topic"),
    ({"accentColor": "#9a8bd3"}, "purple"),
    ({"subheading": "Scale beyond imagination"}, "beyond imagination"),
])
def test_invalid_drafts_are_explained(over, needle):
    with pytest.raises(SpecInvalid) as e:
        validate_draft(draft([chapter(**over), chapter(titleWord="ASH")]), "Mount Fuji", CONTENT, 2)
    assert needle in " ".join(e.value.errors).lower() or needle in " ".join(e.value.errors)


def test_normalizes_typography_and_heading_stop():
    body = BODY.replace("and last", "and last").replace("second,", "second‑hand,")
    spec = validate_draft(draft([chapter(body=body, heading="A mountain’s own weather"), chapter(titleWord="ASH")]),
                          "Mount Fuji", CONTENT, 2)
    c = spec.chapters[0]
    assert c.heading == "A mountain's own weather." and " " not in c.body and "second-hand" in c.body


def test_landmark_kit_allowed_for_its_own_topic():
    giza = RetrievedContent(topic="Giza pyramid complex", pages=CONTENT.pages, images=[])
    validate_draft(draft([chapter(sceneTemplate="dune", artKit="giza"), chapter(titleWord="ASH", artKit="erg", sceneTemplate="dune")]),
                   "Giza pyramid complex", giza, 2)


def test_prompt_contains_rules_sources_and_catalog():
    p = build_prompt(CONTENT)
    assert "wikipedia:Mount Fuji" in p and "lantern-dawn" in p and "3,776.24" in p
    assert "LANDMARK-SPECIFIC (the Giza pyramids)" in p and '"erg"' in p


# retries

def test_corrects_invalid_output_then_succeeds():
    bad = draft([chapter(artKit="nile"), chapter(titleWord="ASH")])
    p = Scripted("gemini", "not json at all", bad, draft())
    result = generate_spec(CONTENT, chain(p), chapters=2, ground=False)
    assert result.attempts == 3 and len(p.calls) == 3
    assert "does not exist" in p.calls[2][-1]["content"]  # errors fed back to the model


def test_gives_up_after_two_corrections():
    p = Scripted("gemini", "{}", "{}", "{}", draft())
    with pytest.raises(GenerationFailed):
        generate_spec(CONTENT, chain(p), chapters=2, ground=False)
    assert len(p.calls) == 3


# fallback and rate limits

def test_rate_limit_backs_off_then_succeeds():
    slept = []
    p = Scripted("gemini", RateLimitError("limited", retry_after=7), "ok")
    c = FallbackChain([p], sleep=slept.append)
    assert c.complete_json("s", [], 10) == ("gemini", "ok")
    assert slept == [7]


def test_overloaded_provider_waits_then_retries():
    calls = iter([httpx.Response(503, json={"error": "high demand"}), httpx.Response(
        200, json={"candidates": [{"content": {"parts": [{"text": "{}"}]}}]})])
    client = httpx.Client(transport=httpx.MockTransport(lambda req: next(calls)))
    slept = []
    c = FallbackChain([GeminiProvider("k", "m", client)], sleep=slept.append)
    assert c.complete_json("s", [], 10) == ("gemini", "{}") and slept == [8.0]


def test_falls_back_to_next_provider():
    g = Scripted("gemini", LLMError("Gemini: HTTP 500"))
    q = Scripted("groq", "ok")
    assert chain(g, q).complete_json("s", [], 10) == ("groq", "ok")


def test_falls_back_after_rate_limit_waits_exhausted():
    g = Scripted("gemini", *[RateLimitError("limited", retry_after=999)] * 3)
    q = Scripted("groq", "ok")
    slept = []
    c = FallbackChain([g, q], max_backoff_s=30, sleep=slept.append)
    assert c.complete_json("s", [], 10) == ("groq", "ok")
    assert slept == [30, 30]


def test_all_failed_message_is_clear():
    with pytest.raises(AllProvidersFailed, match="Free tiers reset"):
        chain(Scripted("gemini", LLMError("boom"))).complete_json("s", [], 10)
    with pytest.raises(AllProvidersFailed, match="GEMINI_API_KEY"):
        chain().complete_json("s", [], 10)


def test_build_chain_orders_primary_first():
    s = Settings(_env_file=None, llm_provider="groq", gemini_api_key="g", groq_api_key="q", ollama_model="")
    assert [p.name for p in build_chain(s, client=httpx.Client()).providers] == ["groq", "gemini"]


# HTTP adapters

def test_gemini_parses_response_and_rate_limit():
    def handler(req):
        if req.headers.get("x-goog-api-key") == "limited":
            return httpx.Response(429, json={"error": {"details": [{"retryDelay": "12s"}]}})
        body = json.loads(req.content)
        assert body["generationConfig"]["responseMimeType"] == "application/json"
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": '{"a":1}'}]}}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert GeminiProvider("k", "m", client).complete_json("s", [{"role": "user", "content": "x"}], 10) == '{"a":1}'
    with pytest.raises(RateLimitError) as e:
        GeminiProvider("limited", "m", client).complete_json("s", [], 10)
    assert e.value.retry_after == 12


def test_groq_parses_response():
    def handler(req):
        assert json.loads(req.content)["response_format"] == {"type": "json_object"}
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert GroqProvider("k", "m", client).complete_json("s", [], 10) == "{}"


# grounding

INVENTED = "The first climbers reached the summit by rope."


def test_grounding_all_supported_scores_one():
    p = Scripted("gemini", draft(), '{"unsupported": []}')
    r = generate_spec(CONTENT, chain(p), chapters=2)
    assert r.grounding["score"] == 1.0 and r.grounding["sentences"] > 6 and len(p.calls) == 2


def test_grounding_correction_fixes_unsupported_sentence():
    fixed = draft()
    p = Scripted("gemini", draft(), '{"unsupported": [{"id": "c1.body.1", "reason": "height misquoted"}]}',
                 fixed, '{"unsupported": []}')
    r = generate_spec(CONTENT, chain(p), chapters=2)
    assert "c1.body.1" in p.calls[2][-1]["content"] and "height misquoted" in p.calls[2][-1]["content"]
    assert r.grounding["score"] == 1.0


def test_still_unsupported_sentences_are_removed_and_scored():
    from app.llm_pipeline.grounding import claims_of
    padded = draft([chapter(body=f"{BODY} {INVENTED}"), chapter(titleWord="ASH")])
    n = len(claims_of(validate_draft(padded, "Mount Fuji", CONTENT, 2)))
    bad = '{"unsupported": [{"id": "c1.body.3", "reason": "not in source"}]}'
    r = generate_spec(CONTENT, chain(Scripted("gemini", padded, bad, padded, bad)), chapters=2)
    assert INVENTED not in r.spec.chapters[0].body and r.spec.chapters[0].body.startswith("The volcano")
    assert r.grounding["removed"] == ["c1.body.3"] and r.grounding["score"] == round((n - 1) / n, 3)


def test_unsupported_heading_is_kept_but_reported():
    bad = '{"unsupported": [{"id": "c1.heading.1", "reason": "invented"}]}'
    r = generate_spec(CONTENT, chain(Scripted("gemini", draft(), bad, draft(), bad)), chapters=2)
    assert r.grounding["kept"] == ["c1.heading.1"] and r.spec.chapters[0].heading


def test_grounding_failure_does_not_fail_generation():
    r = generate_spec(CONTENT, chain(Scripted("gemini", draft(), LLMError("down"))), chapters=2)
    assert r.grounding is None and any("skipped" in n for n in r.notes)


def test_draft_heading_rules():
    for heading, needle in (("At 3,776 m it rises.", "no numbers"), ("A" * 61, "under 60")):
        with pytest.raises(SpecInvalid) as e:
            validate_draft(draft([chapter(heading=heading), chapter(titleWord="ASH")]), "Mount Fuji", CONTENT, 2)
        assert needle in " ".join(e.value.errors)


def test_daily_quota_skips_waiting_and_benches_provider():
    g = Scripted("gemini", RateLimitError("daily", retry_after=30, daily=True))
    q = Scripted("groq", "a", "b")
    slept = []
    c = FallbackChain([g, q], sleep=slept.append)
    assert c.complete_json("s", [], 10) == ("groq", "a") and slept == []
    assert c.complete_json("s", [], 10) == ("groq", "b") and len(g.calls) == 1  # benched, not retried
