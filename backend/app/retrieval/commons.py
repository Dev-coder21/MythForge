"""Wikimedia Commons: freely licensed images for a topic, with license and attribution."""

from __future__ import annotations

import html
import re

import httpx

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Licenses that allow reuse with attribution (or none needed).
ALLOWED = re.compile(r"^(cc[- ]by(-sa)?[- ]\d|cc0|public domain|pd\b|pd-)", re.IGNORECASE)


def _strip_html(text: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", text or "")).strip()


def search_images(client: httpx.Client, topic: str, limit: int = 6, width: int = 1600) -> list[dict]:
    """[{url, attribution, license, title}] for bitmap files whose license allows reuse."""
    r = client.get(
        COMMONS_API,
        params={
            "action": "query", "generator": "search", "gsrsearch": f"filetype:bitmap {topic}", "gsrnamespace": 6,
            "gsrlimit": limit * 3, "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": width,
            "format": "json", "formatversion": 2,
        },
    )
    r.raise_for_status()
    pages = sorted(r.json().get("query", {}).get("pages", []), key=lambda p: p.get("index", 0))
    images = []
    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        license_name = _strip_html(meta.get("LicenseShortName", {}).get("value", ""))
        if not license_name or not ALLOWED.search(license_name):
            continue
        artist = _strip_html(meta.get("Artist", {}).get("value", "")) or "Unknown author"
        url = info.get("thumburl") or info.get("url")
        if not url:
            continue
        images.append({
            "url": url,
            "attribution": f"{artist} · {license_name} · Wikimedia Commons",
            "license": license_name,
            "title": page.get("title", ""),
        })
        if len(images) >= limit:
            break
    return images
