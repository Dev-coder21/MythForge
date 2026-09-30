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

    def fresh_session():
        with Session() as s:
            yield s

    app.dependency_overrides[get_db] = fresh_session
    monkeypatch.setattr(generation, "session_factory", Session)
    monkeypatch.setattr(generation, "checker_factory", None)
    monkeypatch.setattr(generation, "make_client", lambda: contextlib.nullcontext(None))
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_generate_poll_and_read(client, monkeypatch):
    monkeypatch.setattr(generation, "gather_content", lambda topic, db, c: CONTENT)
    three = draft([chapter(titleWord=w) for w in ("FUJI", "HONSHU", "CLIMBING")])
    monkeypatch.setattr(generation, "chain_factory", lambda: chain(Scripted("gemini", three, '{"unsupported": []}')))

    r = client.post("/generate", json={"topic": "Mount Fuji"})
    assert r.status_code == 202
    ids = r.json()

    status = client.get(f"/generate/{ids['jobId']}/status").json()
    assert status["stage"] == "done" and status["progress"] == 100 and status["provider"] == "gemini:fake"

    spec = client.get(f"/stories/{ids['storyId']}").json()
    assert spec["id"] == ids["storyId"] and len(spec["chapters"]) == 3
    assert client.get(f"/stories/{spec['slug']}").status_code == 200
    listed = client.get("/stories").json()
    assert listed[0]["status"] == "complete" and listed[0]["title"] == "Fuji" and listed[0]["groundingScore"] == 1.0
    assert client.get(f"/stories/{ids['storyId']}/grounding").json()["score"] == 1.0


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


def test_poster_upload_and_summary(client, monkeypatch, tmp_path):
    import base64

    from app.api import routes
    monkeypatch.setattr(routes, "POSTER_DIR", tmp_path)
    monkeypatch.setattr(generation, "gather_content", lambda topic, db, c: CONTENT)
    three = draft([chapter(titleWord=w) for w in ("FUJI", "HONSHU", "CLIMBING")])
    monkeypatch.setattr(generation, "chain_factory", lambda: chain(Scripted("gemini", three, '{"unsupported": []}')))
    ids = client.post("/generate", json={"topic": "Mount Fuji"}).json()
    sid = ids["storyId"]
    assert client.get(f"/stories/{sid}/poster").status_code == 404
    assert client.post(f"/stories/{sid}/poster", json={"dataUrl": "data:image/png;base64,AAAA"}).status_code == 422
    jpeg = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0fake").decode()
    assert client.post(f"/stories/{sid}/poster", json={"dataUrl": jpeg}).status_code == 204
    assert client.get(f"/stories/{sid}/poster").content.startswith(b"\xff\xd8")
    card = client.get("/stories").json()[0]
    assert card["posterUrl"] == f"/stories/{sid}/poster" and card["primaryColor"] == "#1c2230"
    status = client.get(f"/generate/{ids['jobId']}/status").json()
    assert status["storySlug"] == "fuji"


def test_duplicate_topics_get_unique_slugs(client, monkeypatch):
    monkeypatch.setattr(generation, "gather_content", lambda topic, db, c: CONTENT)
    three = draft([chapter(titleWord=w) for w in ("FUJI", "HONSHU", "CLIMBING")])
    slugs = []
    for _ in range(2):
        monkeypatch.setattr(generation, "chain_factory", lambda: chain(Scripted("gemini", three, '{"unsupported": []}')))
        ids = client.post("/generate", json={"topic": "Mount Fuji"}).json()
        slugs.append(client.get(f"/generate/{ids['jobId']}/status").json()["storySlug"])
    assert slugs == ["fuji", "fuji-2"]


def test_landmark_layer_route(client, monkeypatch, tmp_path):
    from app.imagegen import landmarks
    monkeypatch.setattr(landmarks, "CACHE_DIR", tmp_path)
    (tmp_path / "0123456789abcdef").mkdir()
    (tmp_path / "0123456789abcdef" / "layer.webp").write_bytes(b"RIFFxxxxWEBP")
    assert client.get("/landmarks/0123456789abcdef.webp").status_code == 200
    assert client.get("/landmarks/..%2F..%2Fsecret.webp").status_code == 404
    assert client.get("/landmarks/ffffffffffffffff.webp").status_code == 404


def _landmark_setup(monkeypatch, tmp_path, passed):
    from app.imagegen import landmarks, story as lmstory
    from app.imagegen.landmarks import Verdict
    monkeypatch.setattr(landmarks, "CACHE_DIR", tmp_path)

    def fake_process(raw, out, template):
        out.write_bytes(b"RIFFxxxxWEBP")
        return {"coverage": 0.3, "edgeTouch": 0.0, "screenLeft": 0.0}

    monkeypatch.setattr(landmarks, "process_image", fake_process)
    monkeypatch.setattr(lmstory, "lead_photo", lambda source, client: {"url": "https://upload/x.jpg", "full": "https://upload/x.jpg", "attribution": "Wikipedia lead image · Mount Fuji", "page": "p"})

    class Images:
        last_model = "cloudflare:flux"
        on_event = None

        def generate(self, prompt, seed):
            return b"\x89PNG...."

    monkeypatch.setattr(generation, "image_chain_factory", lambda: Images())
    monkeypatch.setattr(generation, "landmark_checker", lambda *a: Verdict(passed, [] if passed else ["a church, not a crater"], "gemini:vision"))
    monkeypatch.setattr(generation, "gather_content", lambda topic, db, c: CONTENT)
    lm = {"name": "Mount Fuji crater", "description": "The summit crater at the top of the cone."}
    three = draft([chapter(titleWord=w, landmark=lm if w == "FUJI" else None) for w in ("FUJI", "HONSHU", "CLIMBING")])
    monkeypatch.setattr(generation, "chain_factory", lambda: chain(Scripted("gemini", three, '{"unsupported": []}')))


def test_landmark_painted_into_story(client, monkeypatch, tmp_path):
    _landmark_setup(monkeypatch, tmp_path, passed=True)
    ids = client.post("/generate", json={"topic": "Mount Fuji"}).json()
    spec = client.get(f"/stories/{ids['storyId']}").json()
    lm = spec["chapters"][0]["landmark"]
    assert lm["layer"]["url"].startswith("/api/landmarks/") and lm["check"]["passed"] and lm["reference"]["url"]
    key = lm["layer"]["url"].rsplit("/", 1)[1]
    assert client.get(f"/landmarks/{key}").status_code == 200


def test_rejected_landmark_leaves_plain_template(client, monkeypatch, tmp_path):
    _landmark_setup(monkeypatch, tmp_path, passed=False)
    ids = client.post("/generate", json={"topic": "Mount Fuji"}).json()
    lm = client.get(f"/stories/{ids['storyId']}").json()["chapters"][0]["landmark"]
    assert "layer" not in lm or lm["layer"] is None
    assert lm["check"]["passed"] is False and lm["check"]["attempts"] == 2 and "church" in lm["check"]["reasons"][0]
