"""Generate real sample specs into backend/samples/. Run: python -m scripts.generate_samples [topic ...]"""

import json
import sys
from pathlib import Path

from app.core.config import get_settings
from app.core.db import SessionLocal, init_db
from app.llm_pipeline.pipeline import generate_spec
from app.llm_pipeline.providers import build_chain, build_checker_chain
from app.retrieval import gather_content
from app.retrieval.http import make_client

TOPICS = ["Mount Fuji", "Great Wall of China", "Sahara Desert"]
OUT = Path(__file__).resolve().parents[1] / "samples"


def main(topics: list[str]) -> None:
    init_db()
    OUT.mkdir(exist_ok=True)
    chain = build_chain(get_settings())
    with SessionLocal() as db, make_client() as client:
        for topic in topics:
            try:
                content = gather_content(topic, db, client)
                result = generate_spec(content, chain, checker_for=lambda w: build_checker_chain(get_settings(), exclude=w))
            except Exception as e:
                print(f"{topic}: FAILED. {e}")
                chain.notes.clear()
                continue
            path = OUT / f"{result.spec.slug}.json"
            path.write_text(json.dumps(result.spec.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            report_path = OUT / "grounding.json"
            reports = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
            reports[path.name] = result.grounding
            report_path.write_text(json.dumps(reports, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            score = f'{result.grounding["score"]} (checked by {result.grounding["checkedBy"]})' if result.grounding else "n/a"
            print(f"{topic}: {path.name} via {result.provider}, {result.attempts} attempt(s), grounding {score}. {'; '.join(chain.notes)}")
            chain.notes.clear()


if __name__ == "__main__":
    main(sys.argv[1:] or TOPICS)
