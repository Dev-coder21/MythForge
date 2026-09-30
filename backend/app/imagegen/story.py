"""Paint the landmarks of a finished story spec (one at a time: free tiers are a queue)."""

from __future__ import annotations

import logging
from collections.abc import Callable
from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.imagegen.landmarks import Checker, layer_url, paint_landmark
from app.imagegen.providers import AllImageProvidersFailed, ImageChain
from app.llm_pipeline.providers import LLMError

log = logging.getLogger("mythforge.landmarks")

# Landmark-specific kits already show their landmark; they have no hero slot.
TEMPLATES_WITH_SLOTS = {"threshold", "dune", "peak", "skyline", "ruin", "harbor"}
KITS_WITHOUT_SLOTS = {"giza", "giza-sphinx", "nile", "torii-night"}


def lead_photo(source: str | None, client: httpx.Client) -> dict | None:
    """The Wikipedia lead image of the chapter's source page, for the check and the Sources panel."""
    if not source or not source.startswith("wikipedia:"):
        return None
    title = source.split(":", 1)[1]
    lang = get_settings().wiki_lang
    try:
        r = client.get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}")
        r.raise_for_status()
        data = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    img = (data.get("originalimage") or data.get("thumbnail") or {}).get("source")
    if not img:
        return None
    thumb = (data.get("thumbnail") or {}).get("source") or img
    page = data.get("content_urls", {}).get("desktop", {}).get("page", f"https://{lang}.wikipedia.org/wiki/{quote(title)}")
    return {"url": thumb, "full": img, "attribution": f"Wikipedia lead image · {title}", "page": page}


def paint_story_landmarks(
    spec: dict, chain: ImageChain, checker: Checker, client: httpx.Client,
    on_stage: Callable[[str], None] | None = None, notes: list[str] | None = None,
) -> dict:
    """Mutates and returns the spec: chapters whose landmark passed get landmark.layer; every
    attempted landmark gets landmark.check and landmark.reference. Failures never block the story."""
    notes = notes if notes is not None else []
    if not get_settings().landmark_images:
        return spec
    seen: dict[tuple[str, str], dict] = {}
    for ch in spec["chapters"]:
        lm = ch.get("landmark")
        kit = ch["sceneParams"].get("artKit")
        if not lm or ch["sceneTemplate"] not in TEMPLATES_WITH_SLOTS or kit in KITS_WITHOUT_SLOTS:
            continue
        cache_id = (lm["name"], ch["sceneTemplate"])
        if cache_id not in seen:
            ref = lead_photo(ch.get("source"), client)
            if on_stage:
                on_stage("painting")
            try:
                res = paint_landmark(lm["name"], lm["description"], ch["sceneTemplate"], chain, checker,
                                     ref["full"] if ref else None)
                seen[cache_id] = {"res": res, "ref": ref}
                notes.append(f"landmark {lm['name']}: {'passed' if res.passed else 'rejected'} after {res.attempts} attempt(s)"
                             + (" (cached)" if res.cached else ""))
            except (AllImageProvidersFailed, LLMError) as e:
                notes.append(f"landmark {lm['name']}: not painted ({str(e)[:160]})")
                log.warning("landmark %s not painted: %s", lm["name"], e)
                seen[cache_id] = {"res": None, "ref": ref, "error": str(e)}
        entry = seen[cache_id]
        res, ref = entry["res"], entry["ref"]
        if ref:
            lm["reference"] = {"url": ref["url"], "attribution": ref["attribution"]}
        if res is None:
            lm["check"] = {"passed": False, "checkedBy": "none", "reasons": [f"not painted: {entry.get('error', '')[:160]}"], "attempts": 0}
            continue
        lm["check"] = {"passed": res.passed, "checkedBy": res.checked_by, "reasons": res.reasons, "attempts": res.attempts}
        if res.passed:
            lm["layer"] = {"url": layer_url(res.key), "attribution": f"AI-generated painting ({res.provider}), checked against the Wikipedia photo",
                           "license": "AI-generated"}
    return spec
