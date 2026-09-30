"""Image prompt for a landmark layer: our painterly style + the sourced description + cutout-friendly framing."""

from __future__ import annotations

import re

# Matches the hand-painted kits: soft brushwork, mid tones, even light (the scene adds its own light and colour).
STYLE = (
    "Hand-painted digital matte painting, soft visible brushwork, muted natural colours in mid tones, "
    "even soft daylight from the upper right, gentle shading, no harsh shadows, detailed but painterly"
)

_GREENISH = re.compile(r"\b(green|verdigris|copper|jade|emerald|teal|moss|patina|olive)\b", re.IGNORECASE)


def screen_colour(description: str) -> str:
    """Green screen unless the structure itself is green; then magenta, so keying never eats the subject."""
    return "magenta" if _GREENISH.search(description) else "green"


def landmark_prompt(name: str, description: str) -> str:
    colour = screen_colour(description)
    hexcode = "#FF00FF" if colour == "magenta" else "#00FF00"
    return (
        f"{STYLE}. {name}: {description.rstrip('.')}. "
        "The whole structure fully visible and centred with empty margin around it, isolated, straight side view "
        f"at eye level, on a flat pure {colour} background ({hexcode}), a single even colour with no gradient. "
        "No ground, no sky, no trees, no people, no text, no signature, no watermark, no frame."
    )
