"""
Golden topics for the quality evaluation. Each lists the scene templates that suit
it (template fit = every chapter uses one of them). The last two are deliberately
hard: a topic too thin to write about, and one no scene family fits.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Golden:
    topic: str
    family: str  # mountain | desert | river | temple | hard
    fits: tuple[str, ...]  # acceptable sceneTemplates; empty = nothing fits
    expect: str = "story"  # "story" | "reject" (thin content)
    note: str = ""


GOLDEN: tuple[Golden, ...] = (
    Golden("Mount Kilimanjaro", "mountain", ("peak",)),
    Golden("Mount Fuji", "mountain", ("peak",), note="also a shrine landmark; peak is the setting"),
    Golden("Matterhorn", "mountain", ("peak",)),
    Golden("Sahara Desert", "desert", ("dune",)),
    Golden("Namib Desert", "desert", ("dune",)),
    Golden("Atacama Desert", "desert", ("dune",)),
    Golden("Nile", "river", ("tide",)),
    Golden("Amazon River", "river", ("tide",), note="only river kit is the Nile landmark"),
    Golden("Mekong", "river", ("tide",), note="only river kit is the Nile landmark"),
    Golden("Kinkaku-ji", "temple", ("threshold",)),
    Golden("Fushimi Inari-taisha", "temple", ("threshold",)),
    Golden("Petra", "desert", ("dune",), note="rock-cut city in desert; no carved-stone kit yet"),
    Golden("Zorvath Pass of Queldmoor", "hard", (), expect="reject", note="invented, should be rejected as too thin"),
    Golden("History of jazz", "hard", (), note="off-theme: no scene family fits"),
)
