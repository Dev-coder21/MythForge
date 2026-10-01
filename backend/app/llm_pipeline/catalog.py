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
    # Landmark kits paint a real place; they may only be used when the topic is that place.
    # Empty = generic (fits any topic of that kind, recoloured by the chapter palette).
    landmark: str = ""
    landmark_keys: tuple[str, ...] = ()


KITS: tuple[Kit, ...] = (
    Kit("threshold", "torii-night", "a vermilion torii gate on a grassy mound, tall cedars, stone lanterns, a blossom branch, pampas grass",
        "shrines, gateways, sacred places, forests, Japan, thresholds", "night", "moon",
        landmark="the Fushimi Inari torii in Kyoto", landmark_keys=("kyoto", "fushimi", "inari", "torii")),
    Kit("threshold", "temple-dusk", "a temple garden: stone wall, maples, a pond with lily pads, stepping stones, lanterns",
        "gardens, temples, courtyards, quiet places, water in a garden", "dusk", "sun"),
    Kit("threshold", "lantern-dawn", "two rows of stone lanterns receding along a path to a small gate in morning mist, cedars",
        "pilgrimage routes, long approaches, walls and roads, endings, reflection", "dawn", "stars"),
    Kit("dune", "giza", "layered sand dunes, the three Giza pyramids, a huge low sun, palms, sandstone rocks, heat shimmer",
        "the Giza pyramids and ancient Egypt only", "dusk", "sun",
        landmark="the Giza pyramids", landmark_keys=("giza", "pyramid", "khufu", "egypt", "pharaoh")),
    Kit("dune", "erg", "open sand dunes, sandstone rocks, palms, a huge low sun, heat shimmer; no buildings",
        "any desert, sand sea, oasis, arid land, heat, emptiness, caravans", "dusk", "sun"),
    Kit("dune", "giza-sphinx", "a great stone monument (the Sphinx) on the sand under a bright moon, pyramids behind, dunes",
        "the Great Sphinx and ancient Egypt only", "night", "moon",
        landmark="the Great Sphinx of Giza", landmark_keys=("sphinx", "giza", "egypt", "pharaoh")),
    Kit("peak", "alpine", "layered snow-capped mountain ranges with one dominant summit, clouds and mist between the ridges, "
        "pine forest on the lower slopes, a rocky foreground ledge, blowing snow; no buildings or flags",
        "any mountain, range, summit, volcano, glacier, high pass, climbing and expeditions; set timeOfDay: night "
        "(moonlight), dawn (alpenglow on the peaks) or day", "dawn", "sun"),
    Kit("skyline", "oldtown", "an old city: layered tiled rooftops and chimneys, distant domes and spires (no specific building), "
        "a paved plaza with iron lamp posts in front, birds, soft haze",
        "cities, towns, old quarters, urban monuments, towers, palaces, cathedrals, city squares, gates and arches in a city",
        "dusk", "sun"),
    Kit("ruin", "ancient", "ancient ruins: broken columns, a ruined arch and fallen stone blocks at several depths, "
        "dry grass and wildflowers in front, distant hills, dust in light shafts",
        "ancient sites, archaeological sites, amphitheatres, temples in ruin, forums, lost cities, classical antiquity",
        "day", "sun"),
    Kit("harbor", "port", "a harbor: open sea with moving water and a sun glitter path, a stone seawall promenade with a lamp, "
        "moored boats and a ferry, a low distant skyline, gulls, sea mist",
        "coasts, ports, harbors, bays, lighthouses, seafront monuments, bridges over the sea, island towns",
        "dawn", "sun"),
    Kit("grove", "jungle", "a forest or jungle: a misty far canopy, a row of tall trunks, hanging vines, ferns in front, "
        "light shafts, fireflies at night", "rainforests, jungles, forests, national parks with woodland, temples in a jungle", "day", "sun"),
    Kit("beach", "lagoon", "a beach or island: shallow turquoise water with a glitter path, a sand beach with a foam edge, "
        "leaning palms, shore rocks, low islands on the horizon", "beaches, islands, atolls, lagoons, tropical coasts, reefs", "day", "sun"),
    Kit("polar", "glacier", "ice and snow: a far glacier range, an ice cliff with blue crevasses, an iceberg, a snowfield, "
        "drifting snow, an aurora at night", "Antarctica, the Arctic, glaciers, ice shelves, polar expeditions, tundra in winter", "night", "moon"),
    Kit("cosmos", "ink", "an abstract painterly cosmos: a flowing nebula in the chapter colours, light ribbons, floating "
        "shapes, drifting motes; no landscape at all", "people, musicians, writers, scientists, music styles, history, events, "
        "ideas, science and anything that is not a physical place", "night", "stars"),
    Kit("cosmos", "ink-wash", "an abstract ink wash: soft pigment washes with pooled edges in the chapter colours, light "
        "ribbons, floating shapes; no landscape at all", "people, art, literature, philosophy, history and ideas (calmer, "
        "paper-like alternative to the cosmos)", "dusk", "none"),
    Kit("tide", "nile", "a wide river at dawn, a wooden sailing cargo boat, reeds and papyrus, palms, distant pyramids, mist",
        "the Nile and ancient Egypt only (pyramids on the far bank)", "dawn", "sun",
        landmark="the Nile at Giza", landmark_keys=("nile", "egypt", "giza", "pharaoh", "pyramid")),
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
            f"Painted for {k.time_of_day} with {k.background}. "
            + (f"LANDMARK-SPECIFIC ({k.landmark}): only when the topic is that place." if k.landmark else "GENERIC.")
        )
    return "\n".join(lines)


def kit_problem(template: str, kit: str) -> str | None:
    kits = KITS_BY_TEMPLATE.get(template)
    if not kits:
        return f'sceneTemplate "{template}" has no art yet; use one of: {", ".join(sorted(KITS_BY_TEMPLATE))}'
    if kit not in kits:
        return f'artKit "{kit}" does not exist for template "{template}"; use one of: {", ".join(sorted(kits))}'
    return None


def landmark_problem(kit_name: str, topic: str) -> str | None:
    kit = next((k for k in KITS if k.name == kit_name), None)
    if kit is None or not kit.landmark:
        return None
    low = topic.lower()
    if any(key in low for key in kit.landmark_keys):
        return None
    generic = ", ".join(f"{k.template}/{k.name}" for k in KITS if not k.landmark)
    return (
        f'artKit "{kit_name}" shows {kit.landmark}, which is not this topic; choose the closest GENERIC kit '
        f"({generic}) and recolour it with primaryColor and accentColor"
    )
