"""HTTP endpoints: start a generation, poll it, list and read stories."""

from __future__ import annotations

from datetime import datetime

import base64
import re
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import generation
from app.core.config import BACKEND_DIR
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
    detail: str | None
    storySlug: str | None
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
    posterUrl: str | None
    # First scene's palette, for the card placeholder before a poster exists.
    primaryColor: str | None
    accentColor: str | None
    createdAt: datetime


class PosterUpload(BaseModel):
    dataUrl: str = Field(max_length=4_000_000)


POSTER_DIR = BACKEND_DIR / "posters"


def _poster_path(story_id: str) -> Path:
    return POSTER_DIR / f"{story_id}.jpg"


def _summary(s: Story) -> StorySummary:
    first = ((s.spec_json or {}).get("chapters") or [{}])[0].get("sceneParams", {})
    return StorySummary(
        id=s.id, topic=s.topic, title=s.title, subtitle=s.subtitle, slug=s.share_slug, status=s.status.value,
        groundingScore=s.grounding_score,
        posterUrl=f"/stories/{s.id}/poster" if _poster_path(s.id).exists() else None,
        primaryColor=first.get("primaryColor"), accentColor=first.get("accentColor"), createdAt=s.created_at,
    )


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
        detail=job.detail, storySlug=job.story.share_slug if job.stage.value == "done" else None,
        error=job.error_message, startedAt=job.started_at, completedAt=job.completed_at,
    )


@router.get("/stories", response_model=list[StorySummary])
def list_stories(limit: int = 50, db: Session = Depends(get_db)) -> list[StorySummary]:
    rows = db.scalars(select(Story).order_by(Story.created_at.desc()).limit(min(max(limit, 1), 200))).all()
    return [_summary(s) for s in rows]


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


@router.post("/stories/{story_id}/poster", status_code=204)
def upload_poster(story_id: str, body: PosterUpload, db: Session = Depends(get_db)) -> Response:
    """A JPEG frame of the story's first scene, captured by the frontend renderer, for gallery cards."""
    if db.get(Story, story_id) is None:
        raise HTTPException(404, "Story not found.")
    m = re.fullmatch(r"data:image/jpeg;base64,([A-Za-z0-9+/=]+)", body.dataUrl)
    if not m:
        raise HTTPException(422, "Expected a data:image/jpeg;base64 URL.")
    data = base64.b64decode(m.group(1))
    if not data.startswith(b"\xff\xd8"):
        raise HTTPException(422, "Not a JPEG.")
    POSTER_DIR.mkdir(exist_ok=True)
    _poster_path(story_id).write_bytes(data)
    return Response(status_code=204)


@router.get("/stories/{story_id}/poster")
def get_poster(story_id: str) -> FileResponse:
    path = _poster_path(story_id)
    if not re.fullmatch(r"[0-9a-f-]{36}", story_id) or not path.exists():
        raise HTTPException(404, "No poster yet.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


@router.get("/templates")
def templates() -> list[dict]:
    return [{"template": k.template, "artKit": k.name, "depicts": k.depicts} for k in KITS]
