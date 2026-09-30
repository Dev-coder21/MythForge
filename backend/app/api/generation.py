"""Background generation job: retrieve -> one LLM call (+ corrections) -> store the spec."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.llm_pipeline.pipeline import GenerationFailed, generate_spec
from app.llm_pipeline.providers import FallbackChain, LLMError, build_chain, build_checker_chain
from app.models import Chapter, GenerationJob, JobStage, Story, StoryStatus
from app.retrieval import ThinContentError, gather_content
from app.retrieval.http import RetrievalConfigError, make_client

log = logging.getLogger("mythforge.generate")

# Swappable in tests.
session_factory: Callable[[], Session] = SessionLocal


def default_chain() -> FallbackChain:
    return build_chain(get_settings())


chain_factory: Callable[[], FallbackChain] = default_chain


def default_checker(writer: str) -> FallbackChain:
    return build_checker_chain(get_settings(), exclude=writer)


checker_factory: Callable[[str], FallbackChain] | None = default_checker


def _stage(db: Session, job: GenerationJob, stage: JobStage, pct: int) -> None:
    job.stage, job.progress_pct = stage, pct
    db.commit()


def run_generation(story_id: str, job_id: str) -> None:
    db = session_factory()
    try:
        story = db.get(Story, story_id)
        job = db.get(GenerationJob, job_id)
        if story is None or job is None:
            return
        try:
            _stage(db, job, JobStage.retrieving, 10)
            with make_client() as client:
                content = gather_content(story.topic, db, client)

            _stage(db, job, JobStage.structuring, 35)
            chain = chain_factory()

            def on_event(model: str, message: str) -> None:
                job.provider, job.detail = model, message
                db.commit()

            def on_stage(stage: str) -> None:
                if stage == "checking":
                    _stage(db, job, JobStage.checking, 70)
                elif stage == "correcting":
                    job.detail = "rewriting sentences the fact check could not find in the sources"
                    db.commit()

            chain.on_event = on_event
            result = generate_spec(content, chain, checker_for=checker_factory, on_stage=on_stage)
            job.provider = chain.last_model or result.provider
            job.detail = None

            _stage(db, job, JobStage.assembling, 90)
            spec = result.spec.model_dump(mode="json")
            spec["id"] = story.id  # the spec id is the story id, so /stories/{id} matches
            spec["slug"] = _unique_slug(db, spec["slug"], story.id)  # /story/:slug must name one story
            story.spec_json = spec
            story.title, story.subtitle, story.share_slug = spec["title"], spec["subtitle"], spec["slug"]
            story.chapters = [
                Chapter(
                    chapter_index=c["index"], chapter_label=c["label"], heading=c["heading"], subheading=c["subheading"],
                    body_copy=c["body"], scene_template_id=c["sceneTemplate"], scene_params=c["sceneParams"],
                    source=c.get("source"),
                    hero_image_url=(c.get("heroImage") or {}).get("url"),
                    image_attribution=(c.get("heroImage") or {}).get("attribution"),
                )
                for c in spec["chapters"]
            ]
            if result.grounding:
                story.grounding_score, story.grounding_report = result.grounding["score"], result.grounding
            story.status = StoryStatus.complete
            job.stage, job.progress_pct = JobStage.done, 100
        except (ThinContentError, RetrievalConfigError, GenerationFailed, LLMError) as e:
            _fail(story, job, str(e))
        except Exception as e:  # unexpected: keep the job honest, log the trace
            log.exception("generation crashed")
            _fail(story, job, f"Unexpected error: {e}")
        job.completed_at = datetime.now(UTC)
        db.commit()
    finally:
        db.close()


def _unique_slug(db: Session, slug: str, story_id: str) -> str:
    taken = set(db.scalars(select(Story.share_slug).where(Story.id != story_id, Story.share_slug.is_not(None))))
    taken |= {"kyoto", "giza"}  # built-in stories in the frontend
    candidate, n = slug, 2
    while candidate in taken:
        candidate, n = f"{slug}-{n}", n + 1
    return candidate


def _fail(story: Story, job: GenerationJob, message: str) -> None:
    story.status = StoryStatus.failed
    job.stage, job.error_message = JobStage.error, message
