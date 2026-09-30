import contextlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.api import generation
from app.core.db import get_db
from app.main import app
from app.retrieval import ThinContentError
from tests.test_pipeline import CONTENT, Scripted, chain, chapter, draft


@pytest.fixture
def client(db, monkeypatch):
    Session = sessionmaker(bind=db.get_bind(), expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(generation, "session_factory", Session)
    monkeypatch.setattr(generation, "make_client", lambda: contextlib.nullcontext(None))
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_generate_poll_and_read(client, monkeypatch):
    monkeypatch.setattr(generation, "gather_content", lambda topic, db, c: CONTENT)
    three = draft([chapter(titleWord=w) for w in ("FUJI", "ASH", "SNOW")])
    monkeypatch.setattr(generation, "chain_factory", lambda: chain(Scripted("gemini", three)))

    r = client.post("/generate", json={"topic": "Mount Fuji"})
    assert r.status_code == 202
    ids = r.json()

    status = client.get(f"/generate/{ids['jobId']}/status").json()
    assert status["stage"] == "done" and status["progress"] == 100 and status["provider"] == "gemini"

    spec = client.get(f"/stories/{ids['storyId']}").json()
    assert spec["id"] == ids["storyId"] and len(spec["chapters"]) == 3
    assert client.get(f"/stories/{spec['slug']}").status_code == 200
    listed = client.get("/stories").json()
    assert listed[0]["status"] == "complete" and listed[0]["title"] == "Fuji"


def test_thin_topic_reports_error(client, monkeypatch):
    def thin(topic, db, c):
        raise ThinContentError("Not enough source material for 'Zzq'.")

    monkeypatch.setattr(generation, "gather_content", thin)
    ids = client.post("/generate", json={"topic": "Zzq"}).json()
    status = client.get(f"/generate/{ids['jobId']}/status").json()
    assert status["stage"] == "error" and "Not enough" in status["error"]
    assert client.get(f"/stories/{ids['storyId']}").status_code == 409


def test_not_found_and_bad_input(client):
    assert client.get("/generate/nope/status").status_code == 404
    assert client.get("/stories/nope").status_code == 404
    assert client.post("/generate", json={"topic": ""}).status_code == 422
    assert client.get("/templates").status_code == 200
