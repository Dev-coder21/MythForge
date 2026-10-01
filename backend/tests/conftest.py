import pytest
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy import create_engine

from app.core.db import Base, init_db


@pytest.fixture
def db():
    """Fresh in-memory SQLite database per test."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def _no_style_passes(monkeypatch, request):
    """Scripted providers return fixed reply sequences; the style passes are tested on their own."""
    if "style" not in request.node.name:
        from app.llm_pipeline import pipeline
        monkeypatch.setattr(pipeline, "STYLE_PASSES", False)
