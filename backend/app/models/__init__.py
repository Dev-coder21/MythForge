"""Database tables (docs/SPEC.md §6), adapted to SQLite."""

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(UTC)


class StoryStatus(str, enum.Enum):
    generating = "generating"
    complete = "complete"
    failed = "failed"


class JobStage(str, enum.Enum):
    queued = "queued"
    retrieving = "retrieving"
    structuring = "structuring"
    assembling = "assembling"
    done = "done"
    error = "error"


class SourceType(str, enum.Enum):
    wikipedia = "wikipedia"
    commons = "commons"


class Story(Base):
    __tablename__ = "stories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    topic: Mapped[str] = mapped_column(String(200))
    title: Mapped[str | None] = mapped_column(String(200))
    subtitle: Mapped[str | None] = mapped_column(Text)
    status: Mapped[StoryStatus] = mapped_column(Enum(StoryStatus), default=StoryStatus.generating)
    share_slug: Mapped[str | None] = mapped_column(String(120), index=True)
    # The validated StorySpec, exactly what the frontend renders.
    spec_json: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    chapters: Mapped[list["Chapter"]] = relationship(back_populates="story", cascade="all, delete-orphan", order_by="Chapter.chapter_index")
    jobs: Mapped[list["GenerationJob"]] = relationship(back_populates="story", cascade="all, delete-orphan")


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    story_id: Mapped[str] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    chapter_index: Mapped[int] = mapped_column(Integer)
    chapter_label: Mapped[str] = mapped_column(String(200))
    heading: Mapped[str] = mapped_column(Text)
    subheading: Mapped[str] = mapped_column(Text)
    body_copy: Mapped[str] = mapped_column(Text)
    scene_template_id: Mapped[str] = mapped_column(String(40))
    scene_params: Mapped[dict] = mapped_column(JSON)
    source: Mapped[str | None] = mapped_column(String(300))
    hero_image_url: Mapped[str | None] = mapped_column(Text)
    image_attribution: Mapped[str | None] = mapped_column(Text)

    story: Mapped[Story] = relationship(back_populates="chapters")


class GenerationJob(Base):
    __tablename__ = "generation_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    story_id: Mapped[str] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    stage: Mapped[JobStage] = mapped_column(Enum(JobStage), default=JobStage.queued)
    progress_pct: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    provider: Mapped[str | None] = mapped_column(String(40))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    story: Mapped[Story] = relationship(back_populates="jobs")


class CachedContent(Base):
    __tablename__ = "cached_content"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source_type: Mapped[SourceType] = mapped_column(Enum(SourceType))
    query: Mapped[str] = mapped_column(String(300), index=True)
    raw_content: Mapped[dict] = mapped_column(JSON)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
