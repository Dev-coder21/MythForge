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
ending with a full stop, with no numbers or dates (figures belong in the body). Style: "Carved from the ground itself." and
"For centuries, nothing stood taller." Wrong: "A cone that dominates the horizon." (generic), "Subtropical high pressure creates
a sun-baked world." (summary), "At 3,776.24 m it pierces the sky." (number). Subheadings are short, plain and specific.

COPY RULES (hard rules; breaking one fails validation)
- No em dashes anywhere. Use commas or full stops.
- No "it's not X, it's Y" constructions, and no "less like X, more like Y" or "not just X, but Y".
- No cliches or stock phrases (for example: nestled, tapestry, testament to, rich history, breathtaking, hidden gem, journey through, vibrant, bustling, delve, in the heart of, timeless, iconic, echoes of, whispers of, pulse of, beyond imagination, stretches to the horizon).
- Plain ASCII punctuation: straight quotes and plain hyphens.
- No placeholder text.

FACTS
- Only state facts found in the SOURCE TEXT. Do not add numbers, names, dates or claims that are not in it.
- Copy numbers exactly as written in the source (keep its digits and units).
- Every chapter has a "source" that is one of the SOURCE ids given.

OUTPUT
Return only one JSON object, no prose, no code fences."""

FORMAT = """{
  "title": "short story title, 1 to 3 words",
  "subtitle": "one line, under 90 characters",
  "chapters": [
    {
      "labelName": "UPPERCASE CHAPTER NAME, 2 TO 5 WORDS",
      "titleWord": "ONE UPPERCASE WORD, 3 TO 8 LETTERS, NO SPACES",
      "heading": "evocative line, max 60 characters, no digits, ends with a full stop",
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
      "titleLayout": "horizontal | vertical"
    }
  ]
}"""


@lru_cache
def style_examples() -> str:
    """Copy from the hand-written Kyoto and Giza samples, trimmed to what teaches the voice."""
    out = []
    for name in ("sample-kyoto.json", "sample-giza.json"):
        spec = json.loads((SAMPLES_DIR / name).read_text(encoding="utf-8"))
        out.append(f'Story "{spec["title"]}", subtitle: {spec["subtitle"]}')
        for c in spec["chapters"][:2]:
            p = c["sceneParams"]
            out.append(
                f'  {c["titleWord"]} | heading: {c["heading"]} | subheading: {c["subheading"]} | body: {c["body"]} '
                f'| scene: {c["sceneTemplate"]}/{p["artKit"]}, {p["timeOfDay"]}, {p["backgroundObject"]}, {p["particleType"]}, '
                f'{p["primaryColor"]}/{p["accentColor"]}, {c["transition"]}'
            )
    return "\n".join(out)


def build_prompt(content: RetrievedContent, chapters: int = 3) -> str:
    return f"""Write a {chapters}-chapter story about: {content.topic}

STYLE EXAMPLES (match this voice and level of detail; do not reuse their facts)
{style_examples()}

SCENE CATALOG (pick the best-fitting kit for each chapter; if nothing fits well, pick the closest mood and light)
{catalog_text()}
Never show the wrong landmark: LANDMARK-SPECIFIC kits only when the topic is that place. Otherwise use the closest GENERIC
kit and recolour it for the topic. Use the kit's painted time of day and background unless the source clearly calls for another. Pick colours that suit the
topic and light: primaryColor is a dark base (never pure black), accentColor a warm or cool glow. No purple or violet. Vary kits, light and
transitions across chapters so the story travels. titleLayout "vertical" only for lantern-dawn.

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
