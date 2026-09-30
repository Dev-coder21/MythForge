"""
Paint, cut out, grade, check and cache one landmark layer per chapter.

Cache: backend/landmarks/<key>/ with raw.png, layer.webp and meta.json, where key
is a hash of (template, prompt). A cached layer that passed its check is reused
for free; a cached failure is not retried until the prompt or template changes.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.core.config import BACKEND_DIR, get_settings
from app.imagegen.prompt import landmark_prompt
from app.imagegen.providers import ImageChain
from app.llm_pipeline.providers import LLMError

CACHE_DIR = BACKEND_DIR / "landmarks"
PROCESS_SCRIPT = BACKEND_DIR.parent / "frontend" / "scripts" / "artkit" / "process_raw.py"
MAX_ATTEMPTS = 2  # first try + one retry with a new seed


@dataclass
class Verdict:
    passed: bool
    reasons: list[str]
    checked_by: str


# (layer path, name, description, reference photo url or None) -> Verdict
Checker = Callable[[Path, str, str, str | None], Verdict]


def cache_key(template: str, prompt: str) -> str:
    return hashlib.sha1(f"{template}\n{prompt}".encode()).hexdigest()[:16]


def layer_url(key: str) -> str:
    return f"/api/landmarks/{key}.webp"


def process_image(raw: Path, out: Path, template: str) -> dict:
    """Cut out + grade via the art pipeline (needs rembg in ART_PYTHON)."""
    settings = get_settings()
    cmd = [settings.art_python, str(PROCESS_SCRIPT), "--landmark", str(raw), str(out), "--template", template]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise LLMError(f"landmark cutout failed to run ({e}); set ART_PYTHON to a Python with rembg") from e
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    if res.returncode != 0 or not lines:
        raise LLMError(f"landmark cutout failed: {(res.stderr or res.stdout)[-300:]}")
    return json.loads(lines[-1])


def cutout_problems(stats: dict) -> list[str]:
    """Cheap checks before spending a vision call."""
    out = []
    if stats.get("edgeTouch", 0) > 0.02:
        out.append("the cutout touches the image edge (structure cropped or background left in)")
    cov = stats.get("coverage", 0)
    if cov < 0.02:
        out.append("almost nothing was left after the cutout")
    if cov > 0.85:
        out.append("the background was not removed")
    if stats.get("screenLeft", 0) > 0.02:
        out.append("screen colour remains inside the cutout")
    return out


@dataclass
class LandmarkResult:
    key: str
    passed: bool
    reasons: list[str]
    checked_by: str
    attempts: int
    provider: str
    cached: bool


def paint_landmark(
    name: str, description: str, template: str, chain: ImageChain, checker: Checker, reference: str | None,
    on_attempt: Callable[[int], None] | None = None,
) -> LandmarkResult:
    prompt = landmark_prompt(name, description)
    key = cache_key(template, prompt)
    folder = CACHE_DIR / key
    meta_path = folder / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if meta.get("passed") and (folder / "layer.webp").exists() or not meta.get("passed"):
            return LandmarkResult(key, bool(meta.get("passed")), meta.get("reasons", []), meta.get("checkedBy", ""),
                                  meta.get("attempts", 1), meta.get("provider", ""), cached=True)
    folder.mkdir(parents=True, exist_ok=True)
    reasons: list[str] = []
    checked_by, provider = "", ""
    passed = False
    attempt = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        if on_attempt:
            on_attempt(attempt)
        seed = int(key[:6], 16) + attempt * 7919
        raw = folder / f"raw-{attempt}.png"
        raw.write_bytes(chain.generate(prompt, seed))
        provider = chain.last_model
        layer = folder / f"layer-{attempt}.webp"
        stats = process_image(raw, layer, template)
        reasons = cutout_problems(stats)
        if reasons:
            checked_by = "cutout checks"
            continue
        verdict = checker(layer, name, description, reference)
        reasons, checked_by = verdict.reasons, verdict.checked_by
        if verdict.passed:
            layer.replace(folder / "layer.webp")
            passed = True
            break
    meta = {"name": name, "description": description, "template": template, "prompt": prompt, "passed": passed,
            "reasons": reasons, "checkedBy": checked_by, "attempts": attempt, "provider": provider, "reference": reference}
    # Cache real verdicts only: a check that could not run (quota, network) is retried next time.
    if passed or not any("could not run" in r or "no vision model" in r for r in reasons):
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return LandmarkResult(key, passed, reasons, checked_by, attempt, provider, cached=False)


def layer_path(key: str) -> Path | None:
    p = CACHE_DIR / key / "layer.webp"
    return p if len(key) == 16 and all(c in "0123456789abcdef" for c in key) and p.exists() else None
