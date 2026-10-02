"""
Export the finished stories to static files for the GitHub Pages site (like Airgrove's data export):
frontend/public/data/stories/index.json, one <slug>.json per story (with its grounding report),
posters and AI landmark layers. Run locally after generating stories, then commit and push:

    python -m scripts.export_static
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from app.core.db import SessionLocal, init_db
from app.imagegen.landmarks import layer_path
from app.models import Story, StoryStatus

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "public" / "data"
POSTERS = ROOT / "backend" / "posters"
EVAL = ROOT / "backend" / "eval"
# Site base path on GitHub Pages; static URLs inside story specs must include it.
BASE = "/MythForge/"
# Superseded drafts not shown on the site (the first Taj Mahal story, before its landmark was painted).
SKIP = {"ivory-crown"}


def main() -> None:
    init_db()
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "stories").mkdir(parents=True)
    (OUT / "posters").mkdir()
    (OUT / "landmarks").mkdir()
    index = []
    seen: set[str] = set()

    def add(spec: dict, created: str, grounding: dict | None, poster: Path | None) -> None:
        slug = spec["slug"]
        if slug in seen or slug in SKIP:
            return
        seen.add(slug)
        for ch in spec["chapters"]:
            layer = (ch.get("landmark") or {}).get("layer")
            if layer and (m := re.search(r"/landmarks/([0-9a-f]{16})\.webp", layer.get("url", ""))):
                src = layer_path(m.group(1))
                if src:
                    shutil.copyfile(src, OUT / "landmarks" / f"{m.group(1)}.webp")
                    layer["url"] = f"{BASE}data/landmarks/{m.group(1)}.webp"
                else:
                    ch["landmark"]["layer"] = None
        (OUT / "stories" / f"{slug}.json").write_text(
            json.dumps({"spec": spec, "grounding": grounding}, ensure_ascii=False), encoding="utf-8")
        poster_url = None
        if poster and poster.exists():
            shutil.copyfile(poster, OUT / "posters" / f"{slug}.jpg")
            poster_url = f"{BASE}data/posters/{slug}.jpg"
        first = spec["chapters"][0]["sceneParams"]
        index.append({
            "id": spec["id"], "topic": spec["topic"], "title": spec["title"], "subtitle": spec["subtitle"], "slug": slug,
            "status": "complete", "groundingScore": (grounding or {}).get("score"), "posterUrl": poster_url,
            "primaryColor": first["primaryColor"], "accentColor": first["accentColor"], "createdAt": created,
        })

    with SessionLocal() as db:
        for s in db.query(Story).filter(Story.status == StoryStatus.complete).order_by(Story.created_at.desc()):
            if s.spec_json:
                add(json.loads(json.dumps(s.spec_json)), s.created_at.isoformat(), s.grounding_report, POSTERS / f"{s.id}.jpg")
    # Stories from the evaluation runs that are not in the database (routing check).
    for f in sorted((EVAL / "templates_check").glob("*.json")):
        spec = json.loads(f.read_text(encoding="utf-8"))
        add(spec, spec.get("createdAt", ""), None, EVAL / "templates_check" / "posters" / f"{spec['slug']}.jpg")

    (OUT / "stories" / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"exported {len(index)} stories to {OUT}")


if __name__ == "__main__":
    main()
