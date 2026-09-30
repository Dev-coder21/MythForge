"""HTTP endpoints: start a generation, poll it, list and read stories."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import generation
from app.core.db import get_db
from app.llm_pipeline.catalog import KITS
from app.models import GenerationJob, Story, StoryStatus

router = APIRouter()


class GenerateRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=120)


class GenerateResponse(BaseModel):
    jobId: str
    storyId: str


class JobStatus(BaseModel):
    jobId: str
    storyId: str
    stage: str
    progress: int
    provider: str | None
    error: str | None
    startedAt: datetime
    completedAt: datetime | None


class StorySummary(BaseModel):
    id: str
    topic: str
    title: str | None
    subtitle: str | None
    slug: str | None
    status: str
    groundingScore: float | None
    createdAt: datetime


@router.post("/generate", response_model=GenerateResponse, status_code=202)
def start_generation(req: GenerateRequest, tasks: BackgroundTasks, db: Session = Depends(get_db)) -> GenerateResponse:
    story = Story(topic=req.topic.strip())
    job = GenerationJob(story=story)
    db.add_all([story, job])
    db.commit()
    tasks.add_task(generation.run_generation, story.id, job.id)
    return GenerateResponse(jobId=job.id, storyId=story.id)


@router.get("/generate/{job_id}/status", response_model=JobStatus)
def job_status(job_id: str, db: Session = Depends(get_db)) -> JobStatus:
    job = db.get(GenerationJob, job_id)
    if job is None:
        raise HTTPException(404, "No generation job with that id.")
    return JobStatus(
        jobId=job.id, storyId=job.story_id, stage=job.stage.value, progress=job.progress_pct, provider=job.provider,
        error=job.error_message, startedAt=job.started_at, completedAt=job.completed_at,
    )


@router.get("/stories", response_model=list[StorySummary])
def list_stories(limit: int = 50, db: Session = Depends(get_db)) -> list[StorySummary]:
    rows = db.scalars(select(Story).order_by(Story.created_at.desc()).limit(min(max(limit, 1), 200))).all()
    return [
        StorySummary(id=s.id, topic=s.topic, title=s.title, subtitle=s.subtitle, slug=s.share_slug,
                     status=s.status.value, groundingScore=s.grounding_score, createdAt=s.created_at)
        for s in rows
    ]


@router.get("/stories/{story_id}")
def get_story(story_id: str, db: Session = Depends(get_db)) -> dict:
    """The StorySpec itself, ready for the frontend renderer. Accepts the id or the slug."""
    story = db.get(Story, story_id) or db.scalars(
        select(Story).where(Story.share_slug == story_id, Story.status == StoryStatus.complete).order_by(Story.created_at.desc())
    ).first()
    if story is None:
        raise HTTPException(404, "Story not found.")
    if story.status != StoryStatus.complete or not story.spec_json:
        raise HTTPException(409, f"Story is {story.status.value}; poll /generate/{{jobId}}/status.")
    return story.spec_json


@router.get("/stories/{story_id}/grounding")
def story_grounding(story_id: str, db: Session = Depends(get_db)) -> dict:
    """Fact-check report: score plus every sentence flagged, removed or kept."""
    story = db.get(Story, story_id)
    if story is None:
        raise HTTPException(404, "Story not found.")
    return story.grounding_report or {"score": None}


@router.get("/templates")
def templates() -> list[dict]:
    return [{"template": k.template, "artKit": k.name, "depicts": k.depicts} for k in KITS]
