"""
Wikidata lookups for multilingual retrieval: the topic's entity, its country, its English names,
and the titles of its Wikipedia articles in every language (sitelinks).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx

WIKIDATA_API = "https://www.wikidata.org/w/api.php"

# Country (P17) -> local Wikipedia languages, most widely used first.
COUNTRY_LANGS: dict[str, list[str]] = {
    "Q668": ["hi", "mr", "bn", "ta", "te", "kn", "ml", "gu", "pa", "or", "ur"],  # India
    "Q17": ["ja"],  # Japan
    "Q148": ["zh"],  # China
    "Q865": ["zh"],  # Taiwan
    "Q884": ["ko"],  # South Korea
    "Q869": ["th"],  # Thailand
    "Q881": ["vi"],  # Vietnam
    "Q252": ["id"],  # Indonesia
    "Q837": ["ne"],  # Nepal
    "Q854": ["si", "ta"],  # Sri Lanka
    "Q843": ["ur"],  # Pakistan
    "Q902": ["bn"],  # Bangladesh
    "Q794": ["fa"],  # Iran
    "Q43": ["tr"],  # Turkey
    "Q79": ["ar"], "Q851": ["ar"], "Q796": ["ar"], "Q810": ["ar"], "Q1028": ["ar"], "Q262": ["ar"], "Q878": ["ar"],
    "Q142": ["fr"], "Q183": ["de"], "Q29": ["es"], "Q38": ["it"], "Q45": ["pt"], "Q155": ["pt"], "Q159": ["ru"],
    "Q41": ["el"], "Q36": ["pl"], "Q55": ["nl"], "Q34": ["sv"], "Q96": ["es"], "Q414": ["es"], "Q419": ["es"],
}
# Widely written Wikipedias tried after the local ones.
FALLBACK_LANGS = ["fr", "de", "es"]

LANG_NAMES = {
    "en": "English", "hi": "Hindi", "mr": "Marathi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu", "kn": "Kannada",
    "ml": "Malayalam", "gu": "Gujarati", "pa": "Punjabi", "or": "Odia", "ur": "Urdu", "ja": "Japanese", "zh": "Chinese",
    "ko": "Korean", "th": "Thai", "vi": "Vietnamese", "id": "Indonesian", "ne": "Nepali", "si": "Sinhala", "fa": "Persian",
    "tr": "Turkish", "ar": "Arabic", "fr": "French", "de": "German", "es": "Spanish", "it": "Italian", "pt": "Portuguese",
    "ru": "Russian", "el": "Greek", "pl": "Polish", "nl": "Dutch", "sv": "Swedish",
}


@dataclass
class Entity:
    qid: str
    sitelinks: dict[str, str] = field(default_factory=dict)  # lang -> article title
    countries: list[str] = field(default_factory=list)
    names: list[str] = field(default_factory=list)  # English label + aliases
    types: list[str] = field(default_factory=list)  # "instance of" (P31) item ids

    def local_langs(self) -> list[str]:
        out: list[str] = []
        for c in self.countries:
            out += [lang for lang in COUNTRY_LANGS.get(c, []) if lang not in out]
        return out

    def candidate_langs(self, limit: int = 6) -> list[str]:
        """Languages to try, local first, that actually have an article."""
        order = self.local_langs() + [lang for lang in FALLBACK_LANGS if lang not in self.local_langs()]
        return [lang for lang in order if lang in self.sitelinks and lang != "en"][:limit]


def qid_for_title(client: httpx.Client, title: str, lang: str = "en") -> str | None:
    r = client.get(f"https://{lang}.wikipedia.org/w/api.php", params={
        "action": "query", "prop": "pageprops", "titles": title, "redirects": 1, "format": "json", "formatversion": 2})
    r.raise_for_status()
    pages = r.json().get("query", {}).get("pages", [])
    return (pages[0].get("pageprops") or {}).get("wikibase_item") if pages else None


def search_qid(client: httpx.Client, topic: str) -> str | None:
    r = client.get(WIKIDATA_API, params={
        "action": "wbsearchentities", "search": topic, "language": "en", "limit": 1, "format": "json"})
    r.raise_for_status()
    hits = r.json().get("search", [])
    return hits[0]["id"] if hits else None


def fetch_entity(client: httpx.Client, qid: str) -> Entity:
    r = client.get(WIKIDATA_API, params={
        "action": "wbgetentities", "ids": qid, "props": "sitelinks|labels|aliases|claims", "languages": "en", "format": "json"})
    r.raise_for_status()
    e = r.json().get("entities", {}).get(qid, {})
    sitelinks = {}
    for key, link in (e.get("sitelinks") or {}).items():
        if key.endswith("wiki") and key not in ("commonswiki", "specieswiki", "metawiki") and "_" not in key[:-4]:
            sitelinks[key[:-4]] = link["title"]
    countries = []
    for claim in (e.get("claims") or {}).get("P17", []):
        val = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
        if isinstance(val, dict) and val.get("id"):
            countries.append(val["id"])
    types = []
    for claim in (e.get("claims") or {}).get("P31", []):
        val = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
        if isinstance(val, dict) and val.get("id"):
            types.append(val["id"])
    names = []
    if (label := (e.get("labels") or {}).get("en", {}).get("value")):
        names.append(label)
    names += [a["value"] for a in (e.get("aliases") or {}).get("en", [])]
    return Entity(qid=qid, sitelinks=sitelinks, countries=countries, names=names, types=types)


def type_labels(client: httpx.Client, type_ids: list[str], lang: str) -> list[str]:
    """Labels of the topic's "instance of" types and their direct superclasses (P279) in one language,
    e.g. Hindu temple -> ["हिंदू मंदिर", "मंदिर"] in Marathi. Empty when Wikidata has no label there."""
    if not type_ids:
        return []
    r = client.get(WIKIDATA_API, params={"action": "wbgetentities", "ids": "|".join(type_ids[:5]),
                                          "props": "labels|claims", "languages": lang, "format": "json"})
    r.raise_for_status()
    ents = r.json().get("entities", {})
    labels, parents = [], []
    for e in ents.values():
        if (v := (e.get("labels") or {}).get(lang, {}).get("value")):
            labels.append(v)
        for claim in (e.get("claims") or {}).get("P279", [])[:3]:
            val = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
            if isinstance(val, dict) and val.get("id"):
                parents.append(val["id"])
    if parents:
        r = client.get(WIKIDATA_API, params={"action": "wbgetentities", "ids": "|".join(dict.fromkeys(parents[:8])),
                                              "props": "labels", "languages": lang, "format": "json"})
        r.raise_for_status()
        for e in r.json().get("entities", {}).values():
            if (v := (e.get("labels") or {}).get(lang, {}).get("value")):
                labels.append(v)
    return list(dict.fromkeys(labels))


def matches_type(title: str, summary: str, labels: list[str]) -> bool:
    """Is the article about this kind of thing? Its title or opening must contain one of the type labels
    (or a label's last word: "Hindu temple" -> "temple"). No labels in that language = cannot judge = keep."""
    if not labels:
        return True
    text = f"{title} {summary[:400]}".lower()
    for label in labels:
        lab = label.lower()
        keys = {lab, lab.split()[-1]}
        if " " not in lab and len(lab) >= 3 and not lab.isascii():
            keys.add(lab[-2:])  # compounds in scripts without spaces: "仏教寺院" (Buddhist temple) -> "寺院"
        if any(len(k) >= 2 and k in text for k in keys):
            return True
    return False
