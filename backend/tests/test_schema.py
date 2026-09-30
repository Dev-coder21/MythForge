"""StorySpec mirrors frontend/src/spec/types.ts and enforces the copy rules."""

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.story import StorySpec, copy_problems

SPECS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "spec"


@pytest.fixture(params=["sample-kyoto.json", "sample-giza.json"])
def sample(request) -> dict:
    return json.loads((SPECS / request.param).read_text(encoding="utf-8"))


def test_frontend_samples_validate(sample):
    spec = StorySpec.model_validate(sample)
    # Round-trips to the same JSON the frontend reads (optional fields omitted when unset).
    assert spec.model_dump(exclude_none=True) == sample


def test_mirrors_typescript_fields():
    ts = (SPECS / "types.ts").read_text(encoding="utf-8")
    for field in ["titleLayout", "source", "heroImage", "particleDensity", "artKit", "propVariant", "createdAt"]:
        assert field in ts
    assert {"titleLayout", "source", "heroImage"} <= set(StorySpec.model_fields["chapters"].annotation.__args__[0].model_fields)


def test_rejects_unknown_enum(sample):
    bad = copy.deepcopy(sample)
    bad["chapters"][0]["sceneParams"]["timeOfDay"] = "sunset"
    with pytest.raises(ValidationError, match="timeOfDay"):
        StorySpec.model_validate(bad)


def test_rejects_extra_fields(sample):
    bad = copy.deepcopy(sample)
    bad["chapters"][0]["mood"] = "calm"
    with pytest.raises(ValidationError):
        StorySpec.model_validate(bad)


@pytest.mark.parametrize(
    "text,problem",
    [
        ("A gate — and a path.", "em dash"),
        ("It's not a temple, it's a threshold.", "not X"),
        ("It feels less like a garden and more like a sea.", "not X"),
        ("Nestled in the hills, the shrine waits.", "cliche"),
    ],
)
def test_copy_rules(text, problem):
    assert any(problem in p for p in copy_problems(text))


def test_copy_rules_accept_clean_text():
    assert copy_problems("For 3,800 years, nothing stood taller.") == []


def test_label_format(sample):
    bad = copy.deepcopy(sample)
    bad["chapters"][0]["label"] = "Chapter 1 - The Gate"
    with pytest.raises(ValidationError, match="label"):
        StorySpec.model_validate(bad)


def test_purple_rule_flags_violet_not_dark_neutrals():
    from app.schemas.story import purple_problem
    assert purple_problem("#9a8bd3") and purple_problem("#6a2c91")
    assert purple_problem("#1e1c2a") is None and purple_problem("#f0a24a") is None and purple_problem("#0b1026") is None
