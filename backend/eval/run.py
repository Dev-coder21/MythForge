"""
Quality evaluation: runs the full pipeline (retrieval, writing + corrections, fact
check) on the golden topics, one at a time, and writes eval/results.json and
eval/report.md. Free-tier friendly: pauses between topics, saves after each one,
and stops cleanly when every model's daily quota is used up.

    python -m eval.run              # fresh run (keeps nothing)
    python -m eval.run --resume     # continue: skip topics that already finished
    python -m eval.run --report     # rebuild report.md from results.json only
    python -m eval.run --pause 90   # seconds between topics (default 75)

It calls the pipeline directly, so nothing is added to the gallery.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import get_settings
from app.core.db import SessionLocal, init_db
from app.llm_pipeline.pipeline import GenerationFailed, generate_spec
from app.llm_pipeline.providers import AllProvidersFailed, FallbackChain, LLMError, build_chain, build_checker_chain
from app.retrieval import ThinContentError, gather_content
from app.retrieval.http import make_client
from eval.golden import GOLDEN, MULTILINGUAL, Golden

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results.json"
REPORT = HERE / "report.md"

# Finished outcomes; anything else (a quota stop) is retried on --resume.
DONE = {"success", "rejected", "failed"}

# What kind of rule each rejected-draft error broke.
CATEGORIES = [
    ("em dash", r"em dash"),
    ("cliche", r"cliche"),
    ("not-X-but-Y", r"not X, it's Y"),
    ("heading length", r"characters; keep it under|at most \d+ characters"),
    ("number in heading", r"no numbers or dates in headings"),
    ("number not in source", r"numbers are not in the SOURCE"),
    ("title word", r"titleWord"),
    ("label", r"label must look like"),
    ("body length", r"body must be"),
    ("mixed settings", r"different sceneTemplates"),
    ("wrong kit or landmark", r"artKit|sceneTemplate \""),
    ("source id", r"not one of the SOURCE ids"),
    ("purple", r"is purple"),
    ("invalid JSON", r"not valid JSON|not a JSON object"),
]


def categorise(error: str) -> str:
    for name, pattern in CATEGORIES:
        if re.search(pattern, error):
            return name
    return "other"


def load_results() -> dict:
    if RESULTS.exists():
        return json.loads(RESULTS.read_text(encoding="utf-8"))
    return {"startedAt": datetime.now(UTC).isoformat(timespec="seconds"), "results": {}}


def save_results(data: dict) -> None:
    data["updatedAt"] = datetime.now(UTC).isoformat(timespec="seconds")
    RESULTS.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def all_daily(exc: Exception) -> bool:
    """Every provider in the failure said 'daily': waiting minutes will not help, stop the run."""
    parts = [p for p in str(exc).split(" | ") if p.strip()]
    return bool(parts) and all("daily" in p for p in parts)


def run_topic(g: Golden, db, client) -> dict:
    settings = get_settings()
    chain = build_chain(settings)
    checkers: list[FallbackChain] = []

    def checker_for(writer: str) -> FallbackChain:
        c = build_checker_chain(settings, exclude=writer)
        checkers.append(c)
        return c

    rec: dict = {"topic": g.topic, "family": g.family, "fits": list(g.fits), "expect": g.expect}
    t0 = time.monotonic()
    try:
        content = gather_content(g.topic, db, client)
        rec["sourceWords"] = content.words()
        result = generate_spec(content, chain, checker_for=checker_for)
        spec = result.spec
        templates = [c.sceneTemplate for c in spec.chapters]
        rec["sourceLanguages"] = [p.lang for p in content.pages]
        rec.update(
            status="success",
            reason="",
            title=spec.title,
            headings=[c.heading for c in spec.chapters],
            templates=templates,
            kits=[c.sceneParams.artKit for c in spec.chapters],
            timesOfDay=[c.sceneParams.timeOfDay for c in spec.chapters],
            templateFit=bool(g.fits) and all(t in g.fits for t in templates),
            attempts=result.attempts,
            grounding=result.grounding,
            writtenBy=(result.grounding or {}).get("writtenBy") or chain.last_model,
            checkedBy=(result.grounding or {}).get("checkedBy"),
        )
    except ThinContentError as e:
        rec.update(status="rejected", reason=str(e))
    except GenerationFailed as e:
        rec.update(status="failed", reason=str(e))
    except AllProvidersFailed as e:
        rec.update(status="quota" if all_daily(e) else "failed", reason=str(e))
    except LLMError as e:
        rec.update(status="failed", reason=str(e))
    rec["seconds"] = round(time.monotonic() - t0, 1)
    rec["rejectedDrafts"] = len(chain.validation_log)
    rec["violations"] = [categorise(err) for errs in chain.validation_log for err in errs]
    rec["violationDetails"] = [err[:200] for errs in chain.validation_log for err in errs]
    tokens: dict[str, int] = dict(chain.tokens)
    for c in checkers:
        for k, v in c.tokens.items():
            tokens[k] = tokens.get(k, 0) + v
    rec["tokens"] = tokens
    rec["tokensTotal"] = sum(tokens.values())
    rec["notes"] = chain.notes[-12:]
    return rec


def main() -> None:
    ap = argparse.ArgumentParser(description="MythForge quality evaluation")
    ap.add_argument("--resume", action="store_true", help="skip topics that already finished")
    ap.add_argument("--report", action="store_true", help="only rebuild report.md from results.json")
    ap.add_argument("--pause", type=float, default=75, help="seconds between topics (free-tier limits)")
    ap.add_argument("--set", choices=["golden", "multilingual"], default="golden", help="which topic set to run")
    args = ap.parse_args()

    if args.report:
        write_report(load_results())
        return
    topics = MULTILINGUAL if args.set == "multilingual" else GOLDEN
    data = load_results()
    if not args.resume:  # a fresh run resets only the chosen set; other sets' results are kept
        for g in topics:
            data["results"].pop(g.topic, None)
    init_db()
    todo = [g for g in topics if data["results"].get(g.topic, {}).get("status") not in DONE]
    print(f"{len(todo)} topic(s) to run, {len(topics) - len(todo)} already done")
    with SessionLocal() as db, make_client() as client:
        for i, g in enumerate(todo):
            print(f"[{i + 1}/{len(todo)}] {g.topic} ...", flush=True)
            rec = run_topic(g, db, client)
            data["results"][g.topic] = rec
            save_results(data)
            write_report(data)
            extra = f"grounding {(rec.get('grounding') or {}).get('score')}" if rec["status"] == "success" else rec["reason"][:140]
            print(f"    {rec['status']} in {rec['seconds']}s, {rec['tokensTotal']} tokens. {extra}", flush=True)
            if rec["status"] == "quota":
                print("Every model's daily quota is used up. Continue later with: python -m eval.run --resume")
                return
            if i < len(todo) - 1:
                time.sleep(args.pause)
    print(f"done: {REPORT}")


# --------------------------------------------------------------------------- report

def _avg(xs: list[float]) -> float | None:
    return round(sum(xs) / len(xs), 3) if xs else None


def headline(data: dict) -> dict:
    res = data["results"]
    golden = [res[g.topic] for g in GOLDEN if g.family != "hard" and g.topic in res and res[g.topic]["status"] in DONE]
    ok = [r for r in golden if r["status"] == "success"]
    scores = [r["grounding"]["score"] for r in ok if r.get("grounding") and r["grounding"].get("score") is not None]
    return {
        "goldenFinished": len(golden),
        "goldenTotal": sum(1 for g in GOLDEN if g.family != "hard"),
        "successRate": round(len(ok) / len(golden), 3) if golden else None,
        "avgGrounding": _avg(scores),
        "groundingChecked": len(scores),
        "avgSeconds": _avg([r["seconds"] for r in ok]),
        "templateFitRate": round(sum(1 for r in ok if r.get("templateFit")) / len(ok), 3) if ok else None,
        "avgTokens": _avg([r["tokensTotal"] for r in ok]),
        "firstTryRate": round(sum(1 for r in ok if r.get("attempts") == 1) / len(ok), 3) if ok else None,
    }


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{round(x * 100)}%"


def write_report(data: dict) -> None:
    h = headline(data)
    res = data["results"]
    lines = [
        "# MythForge quality evaluation",
        "",
        f"Generated by `python -m eval.run` on free tiers only. Last update: {data.get('updatedAt', 'n/a')}.",
        f"Golden topics finished: {h['goldenFinished']} of {h['goldenTotal']} (plus 2 hard cases).",
        "",
        "## Headline numbers (golden topics)",
        "",
        f"- **Success rate:** {pct(h['successRate'])}",
        f"- **Average grounding score:** {pct(h['avgGrounding'])} (over {h['groundingChecked']} fact-checked stories)",
        f"- **Template fit rate:** {pct(h['templateFitRate'])}",
        f"- **Valid on the first draft:** {pct(h['firstTryRate'])}",
        f"- **Average time per story:** {round(h['avgSeconds']) if h['avgSeconds'] is not None else 'n/a'} s (includes free-tier rate-limit waits)",
        f"- **Average tokens per story:** {round(h['avgTokens']) if h['avgTokens'] else 'n/a'} (writer + fact checker, from API usage reports)",
        "",
        "## Results",
        "",
        "| Topic | Outcome | Drafts rejected | Grounding | Written by | Checked by | Templates | Fits | Rules caught | Time | Tokens |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for g in GOLDEN:
        r = res.get(g.topic)
        if not r:
            lines.append(f"| {g.topic} | not run yet | | | | | | | | | |")
            continue
        gr = (r.get("grounding") or {})
        score = pct(gr.get("score")) if gr.get("score") is not None else ("skipped" if gr.get("skipped") else "")
        caught = ", ".join(f"{k} ×{v}" if v > 1 else k for k, v in _count(r.get("violations", [])).items())
        outcome = r["status"] if r["status"] == "success" else f"{r['status']}: {_short(r.get('reason', ''))}"
        templates = " / ".join(r.get("templates", [])) or ""
        fits = ("yes" if r.get("templateFit") else "no") if r["status"] == "success" else ""
        lines.append(
            f"| {g.topic} | {outcome} | {r.get('rejectedDrafts', 0)} | {score} | {_model(r.get('writtenBy'))} | "
            f"{_model(r.get('checkedBy'))} | {templates} | {fits} | {caught} | {r.get('seconds', '')} s | {r.get('tokensTotal', 0)} |"
        )
    lines += ["", "## Findings", "", *findings(data), ""]
    from eval.rubric import rubric_section
    rubric = rubric_section()
    if rubric:
        lines += [*rubric, "", *RUBRIC_NOTES, ""]
    REPORT.write_text("\n".join(lines), encoding="utf-8")


def _count(xs: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def _short(reason: str) -> str:
    reason = reason.replace("|", "/").replace("\n", " ")
    return reason[:90] + ("..." if len(reason) > 90 else "")


def _model(mid: str | None) -> str:
    return mid.split(":", 1)[1].split("/")[-1] if mid and ":" in mid else (mid or "")


def findings(data: dict) -> list[str]:
    """Placeholder until a run is reviewed; the reviewed findings live in FINDINGS below."""
    return [f"{i}. {f}" for i, f in enumerate(FINDINGS, 1)] if FINDINGS else ["Run not reviewed yet."]


# Written by hand after reviewing results.json (kept here so --report reproduces them).
# Reviewed notes on the rubric run (kept here so --report reproduces them).
RUBRIC_NOTES: list[str] = [
    "**Rubric notes (partial run, free-tier quota).** Three of six \"after\" stories are scored so far; the other three "
    "resume with `python -m eval.rubric --only after` once the Groq daily caps refill.",
    "",
    "- **On the same three topics, the mean rose from 3.42 to 4.25** (Taj Mahal 3.25 to 4.25, Sahara Desert 3.25 to 4.25, "
    "Great Wall of China 3.75 to 4.25). Vivid went from 2-3 to 4 on all three, mostly from the headings: \"A sea of sand "
    "stretches beyond the horizon.\" became \"So large it glows from other stars.\" Grounding stayed at 5.",
    "- **Not every story improved.** A first Mount Everest run with the new passes scored 3.25 against 4.0 before: the judge "
    "picked \"Where clouds kiss the stone.\" and \"A name whispered by the sky.\" because neither phrase was banned. "
    "\"kiss\", \"whisper\", \"beacon\" and \"jewel\" are now on the cliche list and that run was set aside for a rerun.",
    "- **Two first-run failures were pipeline bugs, now fixed.** Fushimi Inari-taisha: the landmark name \"rōmon\" was "
    "rejected because the name check only matched ASCII letters. Namib Desert: the model chose the same dark indigo base "
    "three times and the purple rule never told it what to use instead; the error now suggests navy, slate and brown bases.",
    "- **Cost: 24,000 to 42,000 tokens per story**, against about 15,000 in the first evaluation. The heading judge and the "
    "critic add roughly 2,000 to 3,000; most of the rest is correction rounds (every scored story needed one or two) and the "
    "longer gold examples in every writer call. On free tiers that means about five to seven stories per model per day.",
    "- **The critic is cautious.** It accepted 2 to 3 rewrites in two stories and none in two others, because any rewrite "
    "that changes a number or drifts in length is dropped. That keeps facts safe but limits its effect.",
]

FINDINGS: list[str] = [
    "**The fact check almost never disagrees, which says more about the checker than the stories.** Nine of the ten "
    "checked stories scored 100%. The only flags were on Fushimi Inari-taisha: an invented image in a heading "
    "(\"A white bird lands on the rice field.\") and an unsupported claim in its subheading. Headings and subheadings "
    "are never removed, so both stayed. Every check was done by one small model (gpt-oss-20b), and the same kind of "
    "evocative, loosely sourced heading appears in other stories that passed. A 98.8% average should be read as a ceiling.",
    "**Rivers other than the Nile have no fitting scene.** The only river kit is the Nile landmark, so the Amazon story "
    "landed in a Japanese temple garden and the Mekong in the mountains. Both template misses (fit 82%, 9 of 11) are "
    "rivers. A generic river kit for the Tide template would close most of the gap.",
    "**First drafts almost never pass, and two rules cause nearly all retries.** Only 1 of 11 successful stories was "
    "valid on the first draft. Of 38 rule violations caught across 15 rejected drafts, 24 were the source-bound title "
    "word and 10 were numbers in headings. Mount Kilimanjaro failed outright on those two after both corrections. "
    "Em dashes, cliches and the purple rule were never triggered: the prompt already prevents them. Giving the model "
    "a short list of allowed title words up front would likely halve the calls.",
    "**The whole run used the fallback models.** Earlier testing that day had used up the Gemini and gpt-oss-120b daily "
    "quotas, so all 11 stories were written by qwen3.8-27b (the Groq fallback) and checked by gpt-oss-20b. The numbers "
    "describe the fallback path, not the intended default. Free-tier capacity is roughly a dozen stories per day at "
    "about 15,000 tokens each, and the off-theme case (History of jazz) stopped on the daily quota; it runs on --resume.",
    "**A checker that returns an empty reply skips the fact check instead of trying the next model.** The Mekong story "
    "was saved without a score because gpt-oss-20b returned no JSON; that counts as a parse error rather than a provider "
    "failure, so the chain never moved on. The thin-topic guard worked as intended: the invented topic was rejected in "
    "under a second with a helpful message and no model calls.",
]


if __name__ == "__main__":
    main()
