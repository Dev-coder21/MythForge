"""
Writing-quality passes, kept small for free-tier limits:
- pick_headings: a small judge model picks the most vivid usable heading per chapter (best of N)
- critique_style: the writer model rewrites only flat or cliché sentences, adding no facts
Both fail soft: on any error the spec is returned unchanged. The fact check runs after them.
"""

from __future__ import annotations

import json
import re

from app.llm_pipeline.grounding import split_sentences
from app.llm_pipeline.providers import FallbackChain, LLMError
from app.schemas.story import StorySpec, copy_problems

JUDGE_SYSTEM = """You choose chapter headings for an illustrated, editorial story. Return only JSON."""

JUDGE_PROMPT = """For each chapter, pick the best candidate heading.
Best means: the most vivid and specific image or turn of phrase, something a reader would want to scroll for.
It must not claim anything the chapter body does not support. Reject generic lines that could fit any topic,
and lines that merely summarise the body.

{chapters}

Return JSON: {{"picks": [{{"chapter": 1, "pick": 2}}, ...]}} (pick is the candidate number)."""

CRITIC_SYSTEM = """You are a line editor for a moody, editorial illustrated story. Return only JSON."""

CRITIC_PROMPT = """Below are the sentences of a short story, each with an id.
Rewrite ONLY sentences that are flat, generic, cliched or clumsy, so they read as precise, concrete and calm.
Rules:
- Keep every fact, name and number exactly; add no new facts, names, numbers or claims.
- Keep roughly the same length. Plain punctuation, no em dashes, no "it's not X, it's Y" phrasing.
- Leave good sentences alone; rewrite at most {max_rewrites}.

{sentences}

Return JSON: {{"rewrites": [{{"id": "c1.body.2", "text": "new sentence"}}]}} (an empty list if nothing needs work)."""

_NUM = re.compile(r"\d[\d,.]*")


def _json(raw: str) -> dict:
    return json.loads(raw[raw.find("{") : raw.rfind("}") + 1])


def pick_headings(spec: StorySpec, candidates: list[list[str]], judge: FallbackChain, notes: list[str]) -> StorySpec:
    """One small call for all chapters; chapters with a single candidate are left as they are."""
    if not any(len(c) > 1 for c in candidates):
        return spec
    blocks = []
    for i, (ch, cands) in enumerate(zip(spec.chapters, candidates), start=1):
        if len(cands) < 2:
            continue
        listed = "\n".join(f"  {n}. {h}" for n, h in enumerate(cands, start=1))
        blocks.append(f"Chapter {i}. Body: {ch.body}\n Candidates:\n{listed}")
    try:
        _, raw = judge.complete_json(JUDGE_SYSTEM, [{"role": "user", "content": JUDGE_PROMPT.format(chapters="\n\n".join(blocks))}], 300)
        picks = _json(raw).get("picks", [])
    except (LLMError, ValueError, AttributeError) as e:
        notes.append(f"heading judge skipped ({str(e)[:80]})")
        return spec
    data = spec.model_dump(mode="json")
    changed = 0
    for p in picks:
        try:
            ci, k = int(p["chapter"]) - 1, int(p["pick"]) - 1
        except (KeyError, TypeError, ValueError):
            continue
        if 0 <= ci < len(candidates) and 0 <= k < len(candidates[ci]):
            h = candidates[ci][k].strip()
            data["chapters"][ci]["heading"] = h if h[-1:] in ".?!" else h + "."
            changed += 1
    notes.append(f"heading judge picked {changed} heading(s) by {judge.last_model or 'judge'}")
    try:
        return StorySpec.model_validate(data)
    except ValueError:
        return spec


def critique_style(spec: StorySpec, writer: FallbackChain, notes: list[str], max_rewrites: int = 4) -> StorySpec:
    """Rewrite flat sentences (subheadings and body). Each rewrite must pass the copy rules, keep the
    original's numbers exactly, add none, and stay close in length; otherwise it is dropped."""
    items: dict[str, str] = {}
    for ci, ch in enumerate(spec.chapters, start=1):
        items[f"c{ci}.subheading.1"] = ch.subheading
        for si, sent in enumerate(split_sentences(ch.body), start=1):
            items[f"c{ci}.body.{si}"] = sent
    listed = "\n".join(f"{k}: {v}" for k, v in items.items())
    try:
        _, raw = writer.complete_json(CRITIC_SYSTEM, [{"role": "user", "content": CRITIC_PROMPT.format(sentences=listed, max_rewrites=max_rewrites)}], 700)
        rewrites = _json(raw).get("rewrites", [])
    except (LLMError, ValueError, AttributeError) as e:
        notes.append(f"style critic skipped ({str(e)[:80]})")
        return spec
    accepted: dict[str, str] = {}
    for r in rewrites[:max_rewrites]:
        rid, text = str(r.get("id", "")), str(r.get("text", "")).strip()
        old = items.get(rid)
        if not old or not text or text == old:
            continue
        if copy_problems(text) or sorted(_NUM.findall(text)) != sorted(_NUM.findall(old)):
            continue
        if not 0.6 <= len(text) / max(len(old), 1) <= 1.6:
            continue
        accepted[rid] = text
    if not accepted:
        notes.append("style critic: no rewrites accepted")
        return spec
    data = spec.model_dump(mode="json")
    for ci, ch in enumerate(data["chapters"], start=1):
        if f"c{ci}.subheading.1" in accepted:
            ch["subheading"] = accepted[f"c{ci}.subheading.1"]
        sents = split_sentences(ch["body"])
        ch["body"] = " ".join(accepted.get(f"c{ci}.body.{si}", s) for si, s in enumerate(sents, start=1))
    try:
        out = StorySpec.model_validate(data)
    except ValueError:
        notes.append("style critic: rewrites broke validation, kept the original")
        return spec
    notes.append(f"style critic rewrote {len(accepted)} sentence(s)")
    return out
