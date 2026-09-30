from eval import run
from eval.golden import GOLDEN


def test_golden_set_shape():
    assert len([g for g in GOLDEN if g.family != "hard"]) == 12
    assert {g.expect for g in GOLDEN if g.family == "hard"} == {"reject", "story"}


def test_categorise_and_quota_stop():
    assert run.categorise("chapters.0.heading: contains an em dash") == "em dash"
    assert run.categorise("chapters.2.heading: no numbers or dates in headings, in digits or words") == "number in heading"
    assert run.all_daily(Exception("All LLM providers failed: Gemini: daily quota | Groq: daily quota. Free tiers"))
    assert not run.all_daily(Exception("All LLM providers failed: Gemini: daily quota | Groq: rate limited"))


def test_headline_and_report(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "REPORT", tmp_path / "report.md")
    ok = {"status": "success", "grounding": {"score": 0.9}, "seconds": 100, "templateFit": True, "attempts": 1,
          "tokensTotal": 20000, "templates": ["peak"] * 3, "violations": ["cliche"], "rejectedDrafts": 1}
    bad = {"status": "failed", "reason": "could not write", "seconds": 50, "tokensTotal": 9000, "violations": []}
    data = {"results": {"Mount Kilimanjaro": ok, "Sahara Desert": bad, "Zorvath Pass of Queldmoor": {"status": "rejected", "reason": "thin"}}}
    h = run.headline(data)
    assert h["successRate"] == 0.5 and h["avgGrounding"] == 0.9 and h["templateFitRate"] == 1.0
    run.write_report(data)
    text = (tmp_path / "report.md").read_text(encoding="utf-8")
    assert "Mount Kilimanjaro | success" in text and "not run yet" in text
