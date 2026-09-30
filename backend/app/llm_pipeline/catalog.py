"""
Scene templates and art kits that actually exist in frontend/public/artkits/,
described by what they depict, so the model can pick the best fit. Keep in
sync with the frontend kits when new ones are added.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Kit:
    template: str
    name: str
    depicts: str
    suits: str
    time_of_day: str
    background: str


KITS: tuple[Kit, ...] = (
    Kit("threshold", "torii-night", "a vermilion torii gate on a grassy mound, tall cedars, stone lanterns, a blossom branch, pampas grass",
        "shrines, gateways, sacred places, forests, Japan, thresholds", "night", "moon"),
    Kit("threshold", "temple-dusk", "a temple garden: stone wall, maples, a pond with lily pads, stepping stones, lanterns",
        "gardens, temples, courtyards, quiet places, water in a garden", "dusk", "sun"),
    Kit("threshold", "lantern-dawn", "two rows of stone lanterns receding along a path to a small gate in morning mist, cedars",
        "pilgrimage routes, long approaches, walls and roads, endings, reflection", "dawn", "stars"),
    Kit("dune", "giza", "layered sand dunes, the three Giza pyramids, a huge low sun, palms, sandstone rocks, heat shimmer",
        "deserts, ancient monuments, pyramids, heat, vast open land", "dusk", "sun"),
    Kit("dune", "giza-sphinx", "a great stone monument (the Sphinx) on the sand under a bright moon, pyramids behind, dunes",
        "carved monuments, deserts at night, ancient statues, mysteries", "night", "moon"),
    Kit("tide", "nile", "a wide river at dawn, a wooden sailing cargo boat, reeds and papyrus, palms, distant pyramids, mist",
        "rivers, trade, boats, journeys, water, transport", "dawn", "sun"),
)

KITS_BY_TEMPLATE: dict[str, set[str]] = {}
for k in KITS:
    KITS_BY_TEMPLATE.setdefault(k.template, set()).add(k.name)


def catalog_text() -> str:
    """Compact catalog for the prompt."""
    lines = []
    for k in KITS:
        lines.append(
            f'- template "{k.template}", artKit "{k.name}": {k.depicts}. Best for: {k.suits}. '
            f"Painted for {k.time_of_day} with {k.background}."
        )
    return "\n".join(lines)


def kit_problem(template: str, kit: str) -> str | None:
    kits = KITS_BY_TEMPLATE.get(template)
    if not kits:
        return f'sceneTemplate "{template}" has no art yet; use one of: {", ".join(sorted(KITS_BY_TEMPLATE))}'
    if kit not in kits:
        return f'artKit "{kit}" does not exist for template "{template}"; use one of: {", ".join(sorted(kits))}'
    return None
