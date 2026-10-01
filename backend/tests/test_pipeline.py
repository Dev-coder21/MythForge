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
                       "chapters": chapters or [chapter(), chapter(titleWord="HONSHU", artKit="temple-dusk", timeOfDay="dusk")]})


class Scripted:
    """Fake provider returning queued responses (strings) or raising queued exceptions."""

    def __init__(self, name, *responses):
        self.name, self.model, self.responses, self.calls = name, "fake", list(responses), []

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
        validate_draft(draft([chapter(**over), chapter(titleWord="HONSHU")]), "Mount Fuji", CONTENT, 2)
    assert needle in " ".join(e.value.errors).lower() or needle in " ".join(e.value.errors)


def test_normalizes_typography_and_heading_stop():
    body = BODY.replace("and last", "and last").replace("second,", "second‑hand,")
    spec = validate_draft(draft([chapter(body=body, heading="A mountain’s own weather"), chapter(titleWord="HONSHU")]),
                          "Mount Fuji", CONTENT, 2)
    c = spec.chapters[0]
    assert c.heading == "A mountain's own weather." and " " not in c.body and "second-hand" in c.body


def test_landmark_kit_allowed_for_its_own_topic():
    giza = RetrievedContent(topic="Giza pyramid complex", pages=CONTENT.pages, images=[])
    validate_draft(draft([chapter(sceneTemplate="dune", artKit="giza"), chapter(titleWord="HONSHU", artKit="erg", sceneTemplate="dune")]),
                   "Giza pyramid complex", giza, 2)


def test_prompt_contains_rules_sources_and_catalog():
    p = build_prompt(CONTENT)
    assert "wikipedia:Mount Fuji" in p and "lantern-dawn" in p and "3,776.24" in p
    assert "LANDMARK-SPECIFIC (the Giza pyramids)" in p and '"erg"' in p


# retries

def test_corrects_invalid_output_then_succeeds():
    bad = draft([chapter(artKit="nile"), chapter(titleWord="HONSHU")])
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
    s = Settings(_env_file=None, llm_provider="groq", gemini_api_key="g", groq_api_key="q", ollama_model="",
                 groq_fallback_models="qwen/qwen3.8-27b")
    ids = [f"{p.name}:{p.model}" for p in build_chain(s, client=httpx.Client()).providers]
    assert ids == ["groq:openai/gpt-oss-120b", "gemini:gemini-flash-latest", "groq:qwen/qwen3.8-27b"]


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
    padded = draft([chapter(body=f"{BODY} {INVENTED}"), chapter(titleWord="HONSHU")])
    n = len(claims_of(validate_draft(padded, "Mount Fuji", CONTENT, 2)))
    bad = '{"unsupported": [{"id": "c1.body.3", "reason": "not in source"}]}'
    r = generate_spec(CONTENT, chain(Scripted("gemini", padded, bad, padded, bad)), chapters=2)
    assert INVENTED not in r.spec.chapters[0].body and r.spec.chapters[0].body.startswith("The volcano")
    assert r.grounding["removed"] == ["c1.body.3"] and r.grounding["score"] == round((n - 1) / n, 3)


def test_unsupported_heading_is_replaced():
    bad = '{"unsupported": [{"id": "c1.heading.1", "reason": "invented"}]}'
    r = generate_spec(CONTENT, chain(Scripted("gemini", draft(), bad, draft(), bad)), chapters=2)
    # no other candidates in this draft: neutral heading from the chapter label, nothing kept
    assert r.grounding["kept"] == [] and r.spec.chapters[0].heading == "The white cone."


def test_unsupported_heading_swapped_for_supported_candidate():
    d = json.loads(draft())
    d["chapters"][0].pop("heading")
    d["chapters"][0]["headings"] = ["So large it glows from other stars.", "Snow on a cone."]
    d = json.dumps(d)
    bad = '{"unsupported": [{"id": "c1.heading.1", "reason": "glow not in source"}]}'
    alt_ok = '{"unsupported": []}'
    r = generate_spec(CONTENT, chain(Scripted("gemini", d, bad, d, bad, alt_ok)), chapters=2)
    assert r.spec.chapters[0].heading == "Snow on a cone."


def test_grounding_failure_does_not_fail_generation():
    r = generate_spec(CONTENT, chain(Scripted("gemini", draft(), LLMError("down"))), chapters=2)
    assert r.grounding["score"] is None and "down" in r.grounding["skipped"] and any("skipped" in n for n in r.notes)


def test_draft_heading_rules():
    for heading, needle in (("At 3,776 m it rises.", "no numbers"), ("Eight thousand metres of stone.", "no numbers"), ("A" * 61, "under 60")):
        with pytest.raises(SpecInvalid) as e:
            validate_draft(draft([chapter(heading=heading), chapter(titleWord="HONSHU")]), "Mount Fuji", CONTENT, 2)
        assert needle in " ".join(e.value.errors)


def test_daily_quota_skips_waiting_and_benches_provider():
    g = Scripted("gemini", RateLimitError("daily", retry_after=30, daily=True))
    q = Scripted("groq", "a", "b")
    slept = []
    c = FallbackChain([g, q], sleep=slept.append)
    assert c.complete_json("s", [], 10) == ("groq", "a") and slept == []
    assert c.complete_json("s", [], 10) == ("groq", "b") and len(g.calls) == 1  # benched, not retried


def test_title_word_must_come_from_source_or_topic():
    with pytest.raises(SpecInvalid) as e:
        validate_draft(draft([chapter(titleWord="GEODES"), chapter(titleWord="HONSHU")]), "Mount Fuji", CONTENT, 2)
    assert "GEODES does not appear" in " ".join(e.value.errors)
    # plural of a source word and a topic word are fine
    validate_draft(draft([chapter(titleWord="MOUNT"), chapter(titleWord="MOUNTAINS")]), "Mount Fuji", CONTENT, 2)


def test_checker_is_a_different_model_and_is_reported():
    writer = Scripted("groq", draft())
    writer.model = "openai/gpt-oss-120b"
    checker = Scripted("groq", '{"unsupported": []}')
    checker.model = "qwen/qwen3.8-27b"
    seen = []

    def checker_for(w):
        seen.append(w)
        return chain(checker)

    r = generate_spec(CONTENT, chain(writer), chapters=2, checker_for=checker_for)
    assert seen == ["groq:openai/gpt-oss-120b"]
    assert r.grounding["checkedBy"] == "groq:qwen/qwen3.8-27b" and r.grounding["writtenBy"] == "groq:openai/gpt-oss-120b"
    assert len(writer.calls) == 1


def test_build_checker_chain_skips_writer_model():
    from app.llm_pipeline.providers import build_checker_chain
    s = Settings(_env_file=None, gemini_api_key="g", groq_api_key="q",
                 grounding_models="groq:openai/gpt-oss-120b,groq:qwen/qwen3.8-27b,gemini:gemini-flash-latest")
    ids = [f"{p.name}:{p.model}" for p in build_checker_chain(s, exclude="groq:openai/gpt-oss-120b", client=httpx.Client()).providers]
    assert ids == ["groq:qwen/qwen3.8-27b", "gemini:gemini-flash-latest"]


def test_hedge_rule_is_in_checker_prompt():
    from app.llm_pipeline.grounding import SYSTEM as CHECK
    assert "about five months" in CHECK and "UNSUPPORTED" in CHECK


def test_duplicate_title_word_error_suggests_source_words():
    with pytest.raises(SpecInvalid) as e:
        validate_draft(draft([chapter(titleWord="FUJI"), chapter(titleWord="FUJI")]), "Mount Fuji", CONTENT, 2)
    msg = " ".join(e.value.errors)
    assert "used twice" in msg and "HONSHU" in msg


def test_peak_kit_is_generic_and_valid_for_any_mountain():
    from app.llm_pipeline.catalog import catalog_text, kit_problem, landmark_problem
    assert kit_problem("peak", "alpine") is None and landmark_problem("alpine", "K2") is None
    text = catalog_text()
    assert 'template "peak", artKit "alpine"' in text and "volcano" in text


def test_correction_quota_failure_keeps_first_report_and_removes():
    padded = draft([chapter(body=f"{BODY} {INVENTED}"), chapter(titleWord="HONSHU")])
    writer = Scripted("groq", padded, RateLimitError("daily", daily=True))
    checker = Scripted("groq", '{"unsupported": [{"id": "c1.body.3", "reason": "not in source"}]}')
    checker.model = "qwen"
    r = generate_spec(CONTENT, chain(writer), chapters=2, checker_for=lambda w: chain(checker))
    assert r.grounding["removed"] == ["c1.body.3"] and r.grounding["score"] < 1
    assert INVENTED not in r.spec.chapters[0].body


def test_rate_limit_window_detection():
    from app.llm_pipeline.providers import _check
    tpm = httpx.Response(429, text="Rate limit reached on tokens per minute (TPM): Limit 8000. Upgrade to Dev Tier today")
    tpd = httpx.Response(429, text="Rate limit reached on tokens per day (TPD): Limit 200000")
    gem = httpx.Response(429, text='{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}')
    for resp, daily in ((tpm, False), (tpd, True), (gem, True)):
        with pytest.raises(RateLimitError) as e:
            _check(resp, "X")
        assert e.value.daily is daily


def test_story_keeps_one_setting_unless_reasoned():
    mixed = [chapter(), chapter(titleWord="HONSHU", sceneTemplate="dune", artKit="erg")]
    with pytest.raises(SpecInvalid) as e:
        validate_draft(draft(mixed), "Mount Fuji", CONTENT, 2)
    assert "same sceneTemplate" in " ".join(e.value.errors)
    ok = json.loads(draft(mixed))
    ok["mixedSettingsReason"] = "The story follows the river out of the mountains into the desert."
    validate_draft(json.dumps(ok), "Mount Fuji", CONTENT, 2)


def test_landmark_is_carried_checked_and_dropped_when_unsupported():
    lm = {"name": "Mount Fuji summit crater", "description": "A crater 780 m across at the top of the cone."}
    d = draft([chapter(landmark=lm), chapter(titleWord="HONSHU")])
    spec = validate_draft(d, "Mount Fuji", CONTENT, 2)
    assert spec.chapters[0].landmark.name == "Mount Fuji summit crater"
    from app.llm_pipeline.grounding import claims_of
    assert any(c.id == "c1.landmark.1" for c in claims_of(spec))
    bad = '{"unsupported": [{"id": "c1.landmark.1", "reason": "crater size not in source"}]}'
    r = generate_spec(CONTENT, chain(Scripted("gemini", d, bad, d, bad)), chapters=2)
    assert r.spec.chapters[0].landmark is None


def test_landmark_must_be_named_in_source():
    lm = {"name": "Eiffel Tower", "description": "A wrought-iron lattice tower on four legs."}
    with pytest.raises(SpecInvalid) as e:
        validate_draft(draft([chapter(landmark=lm), chapter(titleWord="HONSHU")]), "Mount Fuji", CONTENT, 2)
    assert "not named in the SOURCE" in " ".join(e.value.errors)


def test_style_best_of_n_headings_and_critic():
    d = json.loads(draft())
    d["chapters"][0].pop("heading")
    d["chapters"][0]["headings"] = ["At 3,776 m it rises.", "A mountain that keeps its own weather", "Snow on a cone."]
    spec, cands = __import__("app.llm_pipeline.pipeline", fromlist=["x"]).validate_draft_full(json.dumps(d), "Mount Fuji", CONTENT, 2)
    assert cands[0] == ["A mountain that keeps its own weather", "Snow on a cone."]  # the number heading is dropped
    judge = Scripted("groq", '{"picks": [{"chapter": 1, "pick": 2}]}')
    critic = Scripted("groq", json.dumps({"rewrites": [
        {"id": "c1.body.1", "text": "The volcano lifts 3,776.24 m above Honshu; its last eruption came in 1707."},
        {"id": "c1.body.2", "text": "It was 9,999 m tall."},  # adds a number: rejected
        {"id": "c1.subheading.1", "text": "Honshu, before the light comes"}]}))
    from app.llm_pipeline.style import critique_style, pick_headings
    notes = []
    spec = pick_headings(spec, cands, chain(judge), notes)
    assert spec.chapters[0].heading == "Snow on a cone."
    spec = critique_style(spec, chain(critic), notes)
    assert spec.chapters[0].body.startswith("The volcano lifts") and "9,999" not in spec.chapters[0].body
    assert spec.chapters[0].subheading == "Honshu, before the light comes"


def test_style_passes_fail_soft():
    from app.llm_pipeline.style import critique_style, pick_headings
    spec = validate_draft(draft(), "Mount Fuji", CONTENT, 2)
    notes = []
    same = pick_headings(spec, [["A", "B"], ["C"]], chain(Scripted("groq", LLMError("down"))), notes)
    same = critique_style(same, chain(Scripted("groq", "not json")), notes)
    assert same == spec and any("skipped" in n for n in notes)


def test_landmark_name_with_diacritics_matches_source():
    from app.retrieval.wikipedia import WikiPage
    src = RetrievedContent(topic="Fushimi Inari-taisha", pages=[WikiPage(title="Fushimi Inari-taisha", url="u",
        summary="The shrine's main gate, the rōmon, was donated in 1589. Thousands of torii line the paths up the mountain behind it.")])
    lm = {"name": "Rōmon gate", "description": "The two-storey vermilion main gate of the shrine."}
    d = draft([chapter(landmark=lm, titleWord="SHRINE", source="wikipedia:Fushimi Inari-taisha", body=BODY.replace("3,776.24 m", "high").replace("1707", "long ago")),
               chapter(titleWord="TORII", source="wikipedia:Fushimi Inari-taisha", body=BODY.replace("3,776.24 m", "high").replace("1707", "long ago"))])
    spec = validate_draft(d, "Fushimi Inari-taisha", src, 2)
    assert spec.chapters[0].landmark.name == "Rōmon gate"
