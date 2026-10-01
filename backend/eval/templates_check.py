"""
Template-routing check for the newer scene families: does each topic land in the scene it should?
Runs the full pipeline one topic at a time (free-tier safe, resumable), saves results to
eval/templates_check.json.

    python -m eval.templates_check
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from app.core.config import get_settings
from app.core.db import SessionLocal, init_db
from app.llm_pipeline.pipeline import GenerationFailed, generate_spec
from app.llm_pipeline.providers import AllProvidersFailed, LLMError, build_chain, build_checker_chain
from app.retrieval import ThinContentError, gather_content
from app.retrieval.http import make_client

OUT = Path(__file__).resolve().parent / "templates_check.json"
TOPICS = {
    "Amazon rainforest": "grove",
    "Maldives": "beach",
    "Antarctica": "polar",
    "History of jazz": "cosmos",
}


def main() -> None:
    init_db()
    data = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    settings = get_settings()
    with SessionLocal() as db, make_client() as client:
        for topic, expected in TOPICS.items():
            if data.get(topic, {}).get("status") in ("success", "rejected"):
                continue
            chain = build_chain(settings)
            t0 = time.monotonic()
            rec: dict = {"expected": expected}
            try:
                content = gather_content(topic, db, client)
                res = generate_spec(content, chain, checker_for=lambda w: build_checker_chain(settings, exclude=w))
                spec = res.spec
                rec.update(status="success", templates=[c.sceneTemplate for c in spec.chapters],
                           kits=[c.sceneParams.artKit for c in spec.chapters],
                           timesOfDay=[c.sceneParams.timeOfDay for c in spec.chapters],
                           headings=[c.heading for c in spec.chapters],
                           fits=all(c.sceneTemplate == expected for c in spec.chapters),
                           grounding=(res.grounding or {}).get("score"), writtenBy=chain.last_model,
                           sources=content.sources)
                (OUT.parent / "templates_check").mkdir(exist_ok=True)
                (OUT.parent / "templates_check" / f"{spec.slug}.json").write_text(
                    json.dumps(spec.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            except ThinContentError as e:
                rec.update(status="rejected", reason=str(e)[:300])
            except AllProvidersFailed as e:
                print(f"{topic}: stopped on quota ({str(e)[:120]}); rerun later to resume")
                break
            except (GenerationFailed, LLMError) as e:
                rec.update(status="failed", reason=str(e)[:300])
            rec["seconds"] = round(time.monotonic() - t0, 1)
            data[topic] = rec
            OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"{topic}: {rec['status']} {rec.get('templates')} fits={rec.get('fits')} grounding={rec.get('grounding')}", flush=True)
            time.sleep(45)


if __name__ == "__main__":
    main()
