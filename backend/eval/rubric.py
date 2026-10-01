"""
Writing-quality rubric: a model separate from the writers scores each story 1-5 on vivid, specific,
grounded and no cliches, with the source text in hand. "Before" = six stories written by the earlier
pipeline (already in the database or backend/samples); "after" = the same topics through the current
pipeline (best-of-3 headings, style critic). Resumable; results in eval/rubric.json and report.md.

    python -m eval.rubric                # score "before", generate + score "after" (skips finished)
    python -m eval.rubric --only before  # or --only after
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.core.db import SessionLocal, init_db
from app.llm_pipeline.pipeline import GenerationFailed, generate_spec
from app.llm_pipeline.providers import (
    AllProvidersFailed, FallbackChain, GeminiProvider, GroqProvider, LLMError, build_chain, build_checker_chain,
)
from app.models import Story
from app.retrieval import gather_content
from app.retrieval.http import make_client

HERE = Path(__file__).resolve().parent
OUT = HERE / "rubric.json"
AFTER_DIR = HERE / "rubric_after"
SAMPLES = HERE.parent / "samples"

# topic -> where its "before" story lives (db slug or a samples file)
BEFORE = {
    "Mount Everest": ("db", "summit"),
    "Namib Desert": ("db", "namib"),
    "Fushimi Inari-taisha": ("db", "inari-paths"),
    "Taj Mahal": ("db", "ivory-crown-2"),
    "Sahara Desert": ("file", "sahara.json"),
    "Great Wall of China": ("file", "stone-dragon.json"),
}
CRITERIA = ("vivid", "specific", "grounded", "no_cliches")

SYSTEM = "You are a demanding magazine editor scoring short illustrated stories. Return only JSON."
PROMPT = """Score this three-chapter story on four criteria, each 1 (poor) to 5 (excellent):
- vivid: concrete images and fresh phrasing, especially in the headings
- specific: details that belong to this subject, nothing that could describe any similar place
- grounded: every claim is supported by the SOURCE TEXT below (5 = fully supported)
- no_cliches: free of stock phrases and tired images (5 = none at all)
Be strict and use the whole scale. Give one short reason per criterion.

STORY
{story}

SOURCE TEXT
{source}

Return JSON: {{"vivid": n, "specific": n, "grounded": n, "no_cliches": n,
"reasons": {{"vivid": "...", "specific": "...", "grounded": "...", "no_cliches": "..."}}}}"""


def scorer_chain() -> FallbackChain:
    """Separate from the writers (Groq gpt-oss-120b / qwen): Gemini first, a small Groq model last."""
    s = get_settings()
    client = httpx.Client(timeout=120)
    providers = []
    if s.gemini_api_key:
        providers += [GeminiProvider(s.gemini_api_key, "gemini-3.5-flash", client),
                      GeminiProvider(s.gemini_api_key, "gemini-flash-lite-latest", client)]
    if s.groq_api_key:
        providers.append(GroqProvider(s.groq_api_key, "openai/gpt-oss-20b", client))
    return FallbackChain(providers, max_rate_limit_waits=2, max_backoff_s=60)


def story_text(spec: dict) -> str:
    out = [f"Title: {spec['title']} | {spec['subtitle']}"]
    for c in spec["chapters"]:
        out.append(f"Heading: {c['heading']}\nSubheading: {c['subheading']}\nBody: {c['body']}")
    return "\n\n".join(out)


def score(spec: dict, source: str, chain: FallbackChain) -> dict:
    _, raw = chain.complete_json(SYSTEM, [{"role": "user", "content": PROMPT.format(story=story_text(spec), source=source)}], 600)
    data = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
    scores = {k: int(data[k]) for k in CRITERIA}
    return {"scores": scores, "mean": round(sum(scores.values()) / len(scores), 2), "reasons": data.get("reasons", {}),
            "scoredBy": chain.last_model, "headings": [c["heading"] for c in spec["chapters"]]}


def load_before(kind: str, ref: str) -> dict | None:
    if kind == "file":
        p = SAMPLES / ref
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    with SessionLocal() as db:
        s = db.query(Story).filter(Story.share_slug == ref).first()
        return s.spec_json if s and s.spec_json else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["before", "after"])
    ap.add_argument("--pause", type=float, default=45)
    args = ap.parse_args()
    init_db()
    data = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"before": {}, "after": {}}
    AFTER_DIR.mkdir(exist_ok=True)
    scorer = scorer_chain()
    settings = get_settings()
    with SessionLocal() as db, make_client() as client:
        for topic, (kind, ref) in BEFORE.items():
            content = gather_content(topic, db, client)
            source = content.as_prompt_text()
            if args.only != "after" and topic not in data["before"]:
                spec = load_before(kind, ref)
                if spec:
                    data["before"][topic] = score(spec, source, scorer) | {"from": f"{kind}:{ref}"}
                    print(f"before {topic}: {data['before'][topic]['mean']}", flush=True)
                    save(data)
            if args.only != "before" and topic not in data["after"]:
                chain = build_chain(settings)
                checkers: list[FallbackChain] = []

                def checker_for(w, _c=checkers):
                    c = build_checker_chain(settings, exclude=w)
                    _c.append(c)
                    return c

                t0 = time.monotonic()
                try:
                    res = generate_spec(content, chain, checker_for=checker_for, style=True)
                except AllProvidersFailed as e:
                    print(f"after {topic}: stopped, quota ({str(e)[:120]}). Resume later with python -m eval.rubric")
                    break
                except (GenerationFailed, LLMError) as e:
                    data["after"][topic] = {"failed": str(e)[:300]}
                    save(data)
                    print(f"after {topic}: failed ({str(e)[:120]})")
                    continue
                spec = res.spec.model_dump(mode="json")
                (AFTER_DIR / f"{spec['slug']}.json").write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                tokens = sum(chain.tokens.values()) + sum(sum(c.tokens.values()) for c in checkers)
                data["after"][topic] = score(spec, source, scorer) | {
                    "seconds": round(time.monotonic() - t0, 1), "tokens": tokens, "attempts": res.attempts,
                    "writtenBy": chain.last_model, "notes": [n for n in res.notes if "judge" in n or "critic" in n],
                    "grounding": (res.grounding or {}).get("score"),
                }
                save(data)
                print(f"after {topic}: {data['after'][topic]['mean']} ({tokens} tokens)", flush=True)
                time.sleep(args.pause)
    from eval.run import load_results, write_report
    write_report(load_results())
    print("report updated")


def save(data: dict) -> None:
    OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def rubric_section() -> list[str]:
    """Markdown for report.md (called by eval.run.write_report when rubric.json exists)."""
    if not OUT.exists():
        return []
    data = json.loads(OUT.read_text(encoding="utf-8"))
    b, a = data.get("before", {}), data.get("after", {})

    def avg(group: dict, key: str | None = None) -> str:
        vals = [r["scores"][key] if key else r["mean"] for r in group.values() if "scores" in r]
        return f"{sum(vals) / len(vals):.2f}" if vals else "n/a"

    lines = ["## Writing quality rubric", "",
             "Scored 1 to 5 by a model separate from the writers (Gemini first), with the source text in hand. "
             "Before: stories from the earlier pipeline. After: the same topics with gold examples, best-of-3 headings "
             "picked by a small judge, and the style critic.", "",
             "| | Vivid | Specific | Grounded | No cliches | Mean |", "|---|---|---|---|---|---|"]
    for label, g in (("Before", b), ("After", a)):
        lines.append(f"| {label} ({sum(1 for r in g.values() if 'scores' in r)} stories) | "
                     + " | ".join(avg(g, k) for k in CRITERIA) + f" | {avg(g)} |")
    lines += ["", "| Topic | Before | After | Headings after |", "|---|---|---|---|"]
    for t in BEFORE:
        rb, ra = b.get(t, {}), a.get(t, {})
        lines.append(f"| {t} | {rb.get('mean', 'n/a')} | {ra.get('mean', 'failed' if 'failed' in ra else 'n/a')} | "
                     + " / ".join(ra.get("headings", [])) + " |")
    tok = [r["tokens"] for r in a.values() if "tokens" in r]
    if tok:
        lines += ["", f"Average tokens per story with the style passes: {round(sum(tok) / len(tok))}."]
    return lines


if __name__ == "__main__":
    main()
