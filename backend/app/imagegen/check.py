"""
Vision quality check for a painted landmark: a free vision model compares the cutout
with the Wikipedia lead photo and the sourced description. Conservative by design:
anything short of a clear pass (or no vision model at all) means no hero layer.
"""

from __future__ import annotations

import base64
import time
import io
import json
from pathlib import Path

import httpx
from PIL import Image

from app.core.config import get_settings
from app.imagegen.landmarks import Verdict
from app.llm_pipeline.providers import RateLimitError, _check

PROMPT = """You check an AI painting of a landmark before it goes into an illustrated story.
Image 1 is the painting, cut out and placed on a plain grey background. {ref_line}
The landmark: {name}. Sourced description: {description}

Judge strictly and return only JSON:
{{"structure_matches": true/false,  // same kind of structure with the defining features (shape, domes, arches, towers, material colour)
  "text_or_watermark": true/false,  // any letters, logos, signatures or watermarks in the painting
  "cutout_ok": true/false,          // one complete structure, clean edges, no leftover background blocks, not cropped
  "reasons": ["short reason", ...]}}
A painting of a different type of building, a generic lookalike missing defining features, or a
distorted structure does not match."""


def _jpeg_b64(img: Image.Image, max_side: int = 768) -> str:
    img = img.copy()
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def on_grey(layer: Path) -> Image.Image:
    rgba = Image.open(layer).convert("RGBA")
    bg = Image.new("RGBA", rgba.size, (128, 128, 128, 255))
    bg.alpha_composite(rgba)
    return bg


def fetch_reference(url: str | None, client: httpx.Client) -> Image.Image | None:
    if not url:
        return None
    try:
        r = client.get(url, follow_redirects=True)
        r.raise_for_status()
        return Image.open(io.BytesIO(r.content))
    except (httpx.HTTPError, OSError):
        return None


def parse_verdict(raw: str, checked_by: str) -> Verdict:
    try:
        data = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
    except (json.JSONDecodeError, ValueError):
        return Verdict(False, ["the vision check returned unreadable output"], checked_by)
    reasons = [str(r)[:160] for r in data.get("reasons", []) if str(r).strip()][:5]
    ok = data.get("structure_matches") is True and data.get("text_or_watermark") is False and data.get("cutout_ok") is True
    if not ok and not reasons:
        reasons = ["the painting did not clearly pass the structure, text and cutout checks"]
    return Verdict(ok, reasons, checked_by)


def gemini_vision_check(layer: Path, name: str, description: str, reference: str | None) -> Verdict:
    settings = get_settings()
    model = settings.vision_model
    checked_by = f"gemini:{model}"
    if not settings.gemini_api_key:
        return Verdict(False, ["no vision model is configured (GEMINI_API_KEY), so the painting could not be checked"], "none")
    with httpx.Client(timeout=90, headers={"User-Agent": settings.http_user_agent}) as client:
        ref = fetch_reference(reference, client)
        parts = [{"text": PROMPT.format(
            ref_line="Image 2 is the Wikipedia lead photo of the real landmark." if ref else "No reference photo is available; judge against the description.",
            name=name, description=description)},
            {"inline_data": {"mime_type": "image/jpeg", "data": _jpeg_b64(on_grey(layer))}}]
        if ref:
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": _jpeg_b64(ref)}})
        body = {"contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0, "maxOutputTokens": 800,
                                     "thinkingConfig": {"thinkingBudget": 0}}}
        # Overloaded (5xx) or rate limited: one short wait, then the next vision model (own free quota).
        last_error = ""
        for m in [model] + [x for x in settings.vision_fallback_models.split(",") if x.strip() and x.strip() != model]:
            m = m.strip()
            checked_by = f"gemini:{m}"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"
            for attempt in range(2):
                try:
                    r = client.post(url, json=body, headers={"x-goog-api-key": settings.gemini_api_key})
                    _check(r, "Gemini vision")
                    text = "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
                    return parse_verdict(text, checked_by)
                except RateLimitError as e:
                    last_error = str(e)
                    if e.daily or attempt:
                        break
                    time.sleep(min(e.retry_after or 8.0, 20.0))
                except Exception as e:  # malformed reply, network: try the next model
                    last_error = str(e)
                    break
        return Verdict(False, [f"the vision check could not run ({last_error[:120]})"], checked_by)
