"""Prompt for the single story call: voice, copy rules, grounding, catalog, output format."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.llm_pipeline.catalog import catalog_text
from app.retrieval import RetrievedContent

SAMPLES_DIR = Path(__file__).resolve().parents[3] / "frontend" / "src" / "spec"

SYSTEM = """You write MythForge stories: short, cinematic, scroll-driven essays about real places, events and ideas.

VOICE
Moody and editorial, like a fine magazine caption at night. Concrete images, calm authority, short sentences. Never breathless, never promotional.
Headings are evocative, never a summary: an image or a turn of phrase that makes the reader scroll on, at most 60 characters,
ending with a full stop, with no numbers or dates in digits or words (figures belong in the body). Style: "Carved from the ground itself." and
"For centuries, nothing stood taller." Wrong: "A cone that dominates the horizon." (generic), "Subtropical high pressure creates
a sun-baked world." (summary), "At 3,776.24 m it pierces the sky." (number). Subheadings are short, plain and specific.

COPY RULES (hard rules; breaking one fails validation)
- No em dashes anywhere. Use commas or full stops.
- No "it's not X, it's Y" constructions, and no "less like X, more like Y" or "not just X, but Y".
- No cliches or stock phrases (for example: nestled, tapestry, testament to, rich history, breathtaking, hidden gem, journey through, vibrant, bustling, delve, in the heart of, timeless, iconic, echoes of, whispers of, pulse of, beyond imagination, stretches to the horizon).
- Plain ASCII punctuation: straight quotes and plain hyphens.
- No placeholder text.

FACTS
- The SOURCE TEXT may include articles in other languages (Hindi, Japanese, French...). Read them, but always write
  the story in English, and cite the article a chapter's facts come from by its SOURCE id.
- Only state facts found in the SOURCE TEXT. Do not add numbers, names, dates or claims that are not in it.
- Copy numbers exactly as written in the source (keep its digits and units).
- Every chapter has a "source" that is one of the SOURCE ids given.

OUTPUT
Return only one JSON object, no prose, no code fences."""

FORMAT = """{
  "title": "short story title, 1 to 3 words",
  "mixedSettingsReason": null,
  "subtitle": "one line, under 90 characters",
  "chapters": [
    {
      "labelName": "UPPERCASE CHAPTER NAME, 2 TO 5 WORDS",
      "titleWord": "ONE UPPERCASE WORD, 3 TO 8 LETTERS, NO SPACES",
      "headings": ["three different candidate headings: evocative, max 60 characters, no digits, each ends with a full stop"],
      "subheading": "one short line",
      "body": "40 to 70 words of facts from the source, in the voice",
      "source": "one of the SOURCE ids",
      "sceneTemplate": "template id from the catalog",
      "artKit": "kit name from the catalog, for that template",
      "timeOfDay": "dawn | day | dusk | night",
      "backgroundObject": "moon | sun | stars | clouds | none",
      "particleType": "petals | snow | embers | fireflies | dust | rain | none",
      "groundType": "grass | sand | water | stone | void",
      "primaryColor": "#rrggbb dark base colour of the scene",
      "accentColor": "#rrggbb light or glow colour",
      "particleDensity": 0.3,
      "transition": "noise-dissolve | ink-wipe | bloom-out",
      "titleLayout": "horizontal | vertical",
      "landmark": {"name": "the structure's name as the source gives it", "description": "its physical form only, from the source: type, shape, material, colour, parts (under 30 words)"}
    }
  ]
}"""


@lru_cache
def style_examples() -> str:
    """Gold examples: every chapter of the hand-written Kyoto and Giza stories (copy only; scene
    fields are taught by the catalog), so the model sees the target voice and rhythm."""
    out = []
    for name in ("sample-kyoto.json", "sample-giza.json"):
        spec = json.loads((SAMPLES_DIR / name).read_text(encoding="utf-8"))
        out.append(f'Story "{spec["title"]}", subtitle: {spec["subtitle"]}')
        for c in spec["chapters"]:
            out.append(f'  heading: {c["heading"]} | subheading: {c["subheading"]} | body: {c["body"]}')
    return "\n".join(out)


# Real headings from earlier runs, each with what is wrong with it.
NEVER_LIKE_THIS = [
    ("A cone that dominates the horizon.", "generic, fits any mountain"),
    ("A sea of sand stretches beyond the horizon.", "stock image, no fact"),
    ("Bricks and towers marked a new resolve.", "abstract, says nothing"),
    ("Subtropical high pressure creates a sun-baked world where rain is a rarity.", "a summary, too long"),
    ("A ridge that kisses the heavens.", "cliche"),
    ("The longest water on this planet.", "awkward and vague"),
    ("Height confirmed in recent years.", "flat report"),
]


def anti_examples() -> str:
    return "\n".join(f"  {h}  ({why})" for h, why in NEVER_LIKE_THIS)


def build_prompt(content: RetrievedContent, chapters: int = 3) -> str:
    return f"""Write a {chapters}-chapter story about: {content.topic}

GOLD EXAMPLES (match this voice, rhythm and level of detail; do not reuse their facts)
{style_examples()}

NEVER LIKE THIS (real headings from earlier drafts and why they fail)
{anti_examples()}

SCENE CATALOG (pick the best-fitting kit for each chapter; if nothing fits well, pick the closest mood and light)
{catalog_text()}
Never show the wrong landmark: LANDMARK-SPECIFIC kits only when the topic is that place. Otherwise use the closest GENERIC
kit and recolour it for the topic. Use the kit's painted time of day and background unless the source clearly calls for another. Pick colours that suit the
topic and light: primaryColor is a dark base (never pure black), accentColor a warm or cool glow. No purple or violet. LANDMARK: when a chapter is about one specific, visible structure (a building, monument, bridge, tower or statue) that the
SOURCE TEXT names and describes, set "landmark" to its name and a short physical description taken only from the source.
Otherwise set "landmark": null (natural features like mountains, deserts and rivers are null; the scene already shows them).
SETTING GUIDE: people, music, history, events and ideas with no physical place ALWAYS use "cosmos" (ink or
ink-wash), never a landscape; forests and jungles use "grove" (jungle); beaches and islands use "beach" (lagoon);
the poles, glaciers and ice use "polar" (glacier); cities, towns and urban monuments use "skyline" (oldtown); ancient and archaeological sites use "ruin"
(ancient); coastal landmarks, ports and seafronts use "harbor" (port); mountains use "peak"; deserts use "dune";
rivers use "tide"; Japanese shrines and gardens use "threshold".
Keep ONE setting: every chapter uses the same sceneTemplate (a mountain story stays on "peak"), and variety comes from
the kits of that template, time of day, colours and transitions. Mix templates only when the topic itself spans different
settings (a river journey that ends in a desert), and then set "mixedSettingsReason" to one sentence. Vary kits, light and
transitions across chapters so each chapter feels distinct. titleLayout "vertical" only for lantern-dawn.

SOURCE IDS: {", ".join(content.sources)}
SOURCE TEXT
{content.as_prompt_text()}

Return JSON exactly in this shape ({chapters} chapters):
{FORMAT}"""


def correction_prompt(errors: list[str]) -> str:
    listed = "\n".join(f"- {e}" for e in errors[:20])
    return (
        "The JSON you returned failed validation:\n"
        f"{listed}\n"
        "Return the complete corrected JSON object only. Keep everything that was valid. "
        "Remember: facts and numbers only from the SOURCE TEXT, no em dashes, no cliches."
    )


def grounding_correction_prompt(report) -> str:
    listed = "\n".join(f'- {c.id} "{c.text}": {report.unsupported[c.id]}' for c in report.unsupported_claims())
    return (
        "A fact check found these sentences are not supported by the SOURCE TEXT:\n"
        f"{listed}\n"
        "Rewrite each so it states only what the source says, or drop it. Keep every other sentence and all scene "
        "fields unchanged. Return the complete JSON object only."
    )
