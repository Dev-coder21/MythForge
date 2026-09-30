"""
Turn the hand-painted sources in art-raw/ into kit layers for torii-night.

    python frontend/scripts/artkit/process_raw.py                 (all sets, from the repo root)
    python frontend/scripts/artkit/process_raw.py --set giza      (just one set: kyoto | giza | peak)

Per element:
  1. remove the sparkle watermark (fill its corner box with the background colour)
  2. alpha: rembg (AI matte) as the main mask, tightened by a narrow chroma key
     that only removes pixels very close to the flat green/magenta. rembg handles
     the painted blue glow corners; the key cleans rembg's leftovers without
     eating pink blossoms, which sit far enough from pure magenta.
  3. edges: colour decontamination (edge pixels take colour from the solid
     interior) + despill of the key colour on the edge band only, so foliage
     greens and blossom pinks inside the element are untouched
  4. slice sheets, trim transparent borders, cap at 2048px (sources are 1024px,
     so nothing is upscaled), make the wall tile horizontally
  5. match brightness/saturation across elements, then one shared night grade
Writes public/artkits/threshold/torii-night/<name>.webp (alpha) and a contact
sheet to frontend/.captures/art_processed.png.
"""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image
from rembg import new_session, remove
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "art-raw"
OUT = ROOT / "frontend" / "public" / "artkits" / "threshold" / "torii-night"
CAPTURES = ROOT / "frontend" / ".captures"

MAX_SIDE = 2048
# Sparkle watermark: bottom-right corner, as a fraction of width/height (box to repaint).
WATERMARK_BOX = (0.84, 0.78, 0.97, 0.94)

# BiRefNet keeps fine foliage, blossoms and plaster that isnet/u2net drop, and removes painted glows.
session = new_session("birefnet-general-lite")


def load(name: str) -> np.ndarray:
    return np.asarray(Image.open(RAW / name).convert("RGB")).astype(np.float32) / 255.0


def key_color(rgb: np.ndarray) -> np.ndarray:
    """Background colour = median of the left/bottom border (the glow is always top-right)."""
    border = np.concatenate([rgb[:, :8].reshape(-1, 3), rgb[-8:].reshape(-1, 3)])
    return np.median(border, axis=0)


def remove_watermark(rgb: np.ndarray, key: np.ndarray, box=WATERMARK_BOX) -> np.ndarray:
    h, w, _ = rgb.shape
    x0, y0, x1, y1 = int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)
    out = rgb.copy()
    region = out[y0:y1, x0:x1]
    # Only repaint pixels that are background-ish or the bright sparkle itself (never the art).
    dist = np.linalg.norm(region - key, axis=2)
    bright = region.mean(axis=2) > 0.55
    mask = (dist < 0.55) | bright
    mask = ndimage.binary_dilation(mask, iterations=2)
    region[mask] = key
    return out


def chroma_alpha(rgb: np.ndarray, key: np.ndarray, wide: bool = False) -> np.ndarray:
    """1 = keep. Narrow band: only pixels close to the flat key colour go transparent."""
    d = np.linalg.norm(rgb - key, axis=2)
    # Magenta sheets hold no pink art (blossoms are on green), so key them wider: this also
    # clears background trapped between grass blades and leaves that the matte keeps opaque.
    green = key[1] > max(key[0], key[2])
    lo, hi = (0.3, 0.55) if (wide or not green) else (0.14, 0.34)
    return np.clip((d - lo) / (hi - lo), 0.0, 1.0)


def rembg_alpha(rgb: np.ndarray) -> np.ndarray:
    img = Image.fromarray((rgb * 255).astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    out = remove(buf.getvalue(), session=session, post_process_mask=True)
    return np.asarray(Image.open(io.BytesIO(out)).convert("RGBA")).astype(np.float32)[..., 3] / 255.0


def decontaminate(rgb: np.ndarray, alpha: np.ndarray, key: np.ndarray, despill_all: bool = False) -> np.ndarray:
    """Edge pixels: colour from the solid interior nearby, then despill the key colour."""
    solid = (alpha > 0.96).astype(np.float32)
    wsum = ndimage.gaussian_filter(solid, 3.0) + 1e-6
    interior = np.stack([ndimage.gaussian_filter(rgb[..., c] * solid, 3.0) for c in range(3)], axis=2) / wsum[..., None]
    # BiRefNet mattes are fairly hard, so the spill sits on near-opaque pixels at the
    # boundary: treat everything within 4px of the transparent side as the edge band.
    band = ndimage.binary_dilation(alpha < 0.5, iterations=4) & (alpha > 0.001)
    # Art with no genuine key colour in it (desert set) is despilled everywhere, not just
    # at the edge: spill also sits between fronds, plumes and on painted waterlines.
    spill_zone = (alpha > 0.001) if despill_all else band
    out = rgb.copy()
    # Low-alpha pixels are mostly background: blend toward the interior colour by (1 - alpha).
    t = np.clip(1.0 - alpha, 0, 1)[..., None] * band[..., None]
    has_interior = (wsum > 0.02)[..., None]
    out = np.where(has_interior, out * (1 - t) + interior * t, out)
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    if key[1] > key[0] and key[1] > key[2]:  # green screen
        g_limit = np.maximum(r, b)
        out[..., 1] = np.where(spill_zone, np.minimum(g, g_limit), g)
    else:  # magenta screen: remove the red+blue excess over green (purple cast), edge band only
        m = np.minimum(r, b)
        spill = np.clip(m - g - 0.02, 0, None) * spill_zone
        out[..., 0] = r - spill
        out[..., 2] = b - spill
        if despill_all:
            # Translucent plumes and frond tips mixed with the screen read salmon-pink; this set has
            # no genuine pink, so pull pink-hued pixels back to the tan they were painted as.
            r2, g2, b2 = out[..., 0], out[..., 1], out[..., 2]
            pink = np.clip((b2 - g2 + 0.02) / 0.12, 0, 1) * np.clip((r2 - g2) / 0.12, 0, 1) * spill_zone
            out[..., 0] = r2 + (np.minimum(r2, g2 * 1.22) - r2) * pink
            out[..., 2] = b2 + (g2 * 0.72 - b2) * pink
    return np.clip(out, 0, 1)


def cutout(rgb: np.ndarray, watermark: bool = True, wide_key: bool = False, despill_all: bool = False) -> tuple[np.ndarray, np.ndarray]:
    """Cut out one element. Sheets are de-watermarked whole, then sliced, then cut per slice
    (rembg picks one salient subject per image, so slicing must come first)."""
    key = key_color(rgb)
    if watermark:
        rgb = remove_watermark(rgb, key)
    a = rembg_alpha(rgb) * chroma_alpha(rgb, key, wide_key)
    # Drop specks left in the background (keep components with meaningful area).
    labels, n = ndimage.label(a > 0.1)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(a), labels, index=np.arange(1, n + 1))
        keep = np.isin(labels, 1 + np.flatnonzero(sizes > 0.002 * a.size))
        a = a * ndimage.binary_dilation(keep, iterations=2)
    # Anti-aliased edge: pull the matte in by a pixel (drops the last contaminated row), then soften.
    a = np.minimum(a, ndimage.grey_erosion(a, size=(3, 3)) * 0.35 + a * 0.65)
    a = np.clip(ndimage.gaussian_filter(a, 0.6), 0, 1)
    return decontaminate(rgb, a, key, despill_all), a


def trim(rgba: np.ndarray, pad: int = 4) -> np.ndarray:
    ys, xs = np.nonzero(rgba[..., 3] > 0.02)
    y0, y1 = max(0, ys.min() - pad), min(rgba.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(rgba.shape[1], xs.max() + pad + 1)
    return rgba[y0:y1, x0:x1]


def luma(rgb):
    return rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def stats(rgba) -> tuple[float, float]:
    a = rgba[..., 3] > 0.5
    rgb = rgba[..., :3][a]
    mx, mn = rgb.max(axis=1), rgb.min(axis=1)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    return float(np.median(luma(rgb))), float(np.median(sat))


def grade(rgba, target_l, target_s, own_l, own_s, keep_warm=False, look="night"):
    """Match median brightness/saturation, then the set's shared grade (cool night or warm desert)."""
    rgb = rgba[..., :3].copy()
    gain = np.clip(target_l / max(own_l, 1e-3), 0.7, 1.45)
    rgb = rgb * gain
    l = luma(rgb)[..., None]
    s_gain = np.clip(target_s / max(own_s, 1e-3), 0.75, 1.3)
    rgb = l + (rgb - l) * s_gain
    # Night grade: slight blue lift in shadows, a touch of overall cool, gentle contrast.
    if look == "desert":
        # Warm desert: sun-baked highlights, amber-lifted shadows, a touch more contrast.
        warm = np.array([1.06, 1.0, 0.9], dtype=np.float32)
        graded = rgb * warm + np.array([0.022, 0.012, 0.0], dtype=np.float32) * (1 - l)
        graded = 0.5 + (graded - 0.5) * 1.06
    else:
        night = np.array([0.93, 0.97, 1.08], dtype=np.float32)
        graded = rgb * night + np.array([0.0, 0.004, 0.018], dtype=np.float32) * (1 - l)
        graded = 0.5 + (graded - 0.5) * 1.04
    if keep_warm:  # the lantern window stays warm: don't cool the hottest pixels
        hot = np.clip((rgb[..., 0] - rgb[..., 2] - 0.25) * 4, 0, 1)[..., None]
        graded = graded * (1 - hot) + rgb * hot
    rgba = rgba.copy()
    rgba[..., :3] = np.clip(graded, 0, 1)
    return rgba


def tile_wall(rgba: np.ndarray) -> np.ndarray:
    """Crop between two matching posts so the right edge continues into the left."""
    a = rgba[..., 3] > 0.5
    # Posts are the dark vertical bands in the plaster body: columns well below the median brightness.
    body = rgba[int(rgba.shape[0] * 0.45) : int(rgba.shape[0] * 0.85), :, :3]
    col = np.median(luma(body), axis=0)
    posts = np.flatnonzero(col < 0.65 * np.median(col))
    groups = np.split(posts, np.flatnonzero(np.diff(posts) > 4) + 1) if posts.size else []
    centers = [int(g.mean()) for g in groups if g.size > 3]
    # Keep only posts spaced like real bays (stains can read as posts); tile = whole bays.
    if len(centers) >= 3:
        gaps = np.diff(centers)
        bay = float(np.median(gaps))
        keep = [centers[-1]]
        for c in reversed(centers[:-1]):
            if abs((keep[-1] - c) - bay) < 0.12 * bay:
                keep.append(c)
        centers = sorted(keep)
    print(f"  wall posts at {centers}")
    if len(centers) >= 2:
        x0, x1 = centers[0], centers[-1]
        rgba = rgba[:, x0:x1]
    # Fully opaque across the width (no feathered left/right edges on a tiling strip).
    ys = np.flatnonzero(a.any(axis=1))
    return rgba[ys.min() : ys.max() + 1]


def pond_water_mask(rgba: np.ndarray) -> np.ndarray:
    """Soft mask of open water: dark, low saturation, not green (moss/lily), inside the rim."""
    rgb, a = rgba[..., :3], rgba[..., 3]
    l = luma(rgb)
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    greenish = rgb[..., 1] > np.maximum(rgb[..., 0], rgb[..., 2]) * 1.08
    # The open water of this painting is an ellipse inside the stone rim; its bright and
    # dark halves defeat colour-based detection, so it is measured once from the trimmed
    # image (centre and semi-axes as fractions of width/height). Update if pond.png changes.
    h, w = l.shape
    cx, cy, rx, ry = 0.52 * w, 0.47 * h, 0.37 * w, 0.245 * h
    yy, xx = np.mgrid[0:h, 0:w]
    inside = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0
    water = inside & (a > 0.9) & ~ndimage.binary_dilation(greenish, iterations=1)
    return np.clip(ndimage.gaussian_filter(water.astype(np.float32), 1.5), 0, 1)


def to_image(rgba: np.ndarray) -> Image.Image:
    img = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")
    if max(img.size) > MAX_SIDE:
        k = MAX_SIDE / max(img.size)
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    return img


def rgba_of(rgb, a):
    return np.dstack([rgb, a])


def run_kyoto() -> None:
    """Threshold art for Kyoto: art-raw/*.png -> artkits/threshold/torii-night/ (night grade)."""
    OUT.mkdir(parents=True, exist_ok=True)
    CAPTURES.mkdir(parents=True, exist_ok=True)
    elements: dict[str, np.ndarray] = {}

    singles = [
        ("torii", "torii.png"), ("hill", "hill.png"), ("grass", "tall-grass.png"), ("wall", "wall.png"),
        ("branch", "blossom-branch.png"), ("maple", "maple.png"), ("pond", "pond.png"), ("stones", "stepping-stones.png"),
    ]
    # Green-screen art without pink/green-adjacent colours can take the wide key too
    # (clears background trapped between leaves).
    wide = {"maple"}
    for name, src in singles:
        rgb, a = cutout(load(src), wide_key=name in wide)
        rgba = rgba_of(rgb, a)
        elements[name] = tile_wall(rgba) if name == "wall" else trim(rgba)
        print(f"cut {name}")

    # Small sheet: lantern TL, bush TR, rocks BL (the BR branch is ignored).
    sheet = load("sheet-small.png")
    sheet = remove_watermark(sheet, key_color(sheet))
    h, w, _ = sheet.shape
    quads = {"lantern": (0, 0, w // 2, h // 2), "bush": (w // 2, 0, w, h // 2), "rocks": (0, h // 2, w // 2, h)}
    for name, (x0, y0, x1, y1) in quads.items():
        rgb, a = cutout(sheet[y0:y1, x0:x1], watermark=False)
        elements[name] = trim(rgba_of(rgb, a))
        print(f"cut {name}")

    # Cedars: left and right halves.
    ced = load("sheet-cedars.png")
    ced = remove_watermark(ced, key_color(ced))
    mid = ced.shape[1] // 2
    for name, part in (("cedar-a", ced[:, :mid]), ("cedar-b", ced[:, mid:])):
        rgb, a = cutout(part, watermark=False)
        elements[name] = trim(rgba_of(rgb, a))
    print("cut cedars")

    # Water mask for the pond: the dark, low-saturation water inside the stone rim
    # (not rocks, moss or lily pads). Used by the runtime water shader.
    water_mask = pond_water_mask(elements["pond"])

    # Consistent grade across the set.
    measured = {k: stats(v) for k, v in elements.items()}
    target_l = float(np.median([m[0] for m in measured.values()]))
    target_s = float(np.median([m[1] for m in measured.values()]))
    thumbs = []
    for name, rgba in elements.items():
        l, s = measured[name]
        # Elements meant to read brighter/darker keep part of their own balance (half-way match).
        graded = grade(rgba, (target_l + l) / 2, (target_s + s) / 2, l, s, keep_warm=(name == "lantern"))
        img = to_image(graded)
        img.save(OUT / f"{name}.webp", "WEBP", quality=90, method=6)
        print(f"{name:8s} {img.width}x{img.height}  L {l:.2f}->{(target_l + l) / 2:.2f}  S {s:.2f}")
        t = img.copy()
        t.thumbnail((360, 360))
        thumbs.append(t)

    mask_img = Image.fromarray((water_mask * 255).astype(np.uint8), "L")
    rgba_mask = Image.merge("RGBA", (mask_img, mask_img, mask_img, mask_img))
    rgba_mask.save(OUT / "pond-water.webp", "WEBP", quality=90, method=6)
    print(f"pond-water mask {mask_img.width}x{mask_img.height}  coverage {water_mask.mean():.2f}")

    # Contact sheet on a mid grey so fringes/halos are visible.
    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    sheet_img = Image.new("RGBA", (cols * 380, rows * 380), (90, 96, 110, 255))
    for i, t in enumerate(thumbs):
        sheet_img.alpha_composite(t, ((i % cols) * 380 + 10, (i // cols) * 380 + 10))
    sheet_img.convert("RGB").save(CAPTURES / "art_processed.png")
    print("sheet ->", CAPTURES / "art_processed.png")


GIZA_DUNE = ROOT / "frontend" / "public" / "artkits" / "dune" / "hand"
GIZA_TIDE = ROOT / "frontend" / "public" / "artkits" / "tide" / "hand"


def run_giza() -> None:
    """Giza art: art-raw/giza/*.png -> artkits/dune/hand/ and artkits/tide/hand/ (warm desert grade).
    The code-painted versions in each template's painted/ folder stay as fallbacks; sand stays code-made."""
    GIZA_DUNE.mkdir(parents=True, exist_ok=True)
    GIZA_TIDE.mkdir(parents=True, exist_ok=True)
    out_dir = {
        "pyramids": GIZA_DUNE, "sphinx": GIZA_DUNE, "dune-far": GIZA_DUNE, "dune-mid": GIZA_DUNE,
        "dune-near": GIZA_DUNE, "rocks-sandstone": GIZA_DUNE, "palm": GIZA_DUNE, "palm-b": GIZA_DUNE,
        "boat": GIZA_TIDE, "bank-far": GIZA_TIDE, "bank-near": GIZA_TIDE, "reeds": GIZA_TIDE, "papyrus": GIZA_TIDE,
    }
    elements: dict[str, np.ndarray] = {}
    for name in ["pyramids", "sphinx", "dune-far", "dune-mid", "dune-near", "rocks-sandstone", "boat", "bank-far", "bank-near"]:
        rgb, a = cutout(load(f"giza/{name}.png"), despill_all=True)
        elements[name] = trim(rgba_of(rgb, a))
        print(f"cut {name}")

    # Two-up sheets: left/right halves, watermark removed on the whole sheet first.
    # The pink on the reed plumes and papyrus heads was magenta spill, not paint, so both
    # sheets take the standard (wide) magenta key plus the full despill.
    for sheet, (left, right) in [("giza/sheet-palms.png", ("palm", "palm-b")), ("giza/sheet-reeds.png", ("reeds", "papyrus"))]:
        img = load(sheet)
        img = remove_watermark(img, key_color(img))
        mid = img.shape[1] // 2
        for name, part in ((left, img[:, :mid]), (right, img[:, mid:])):
            rgb, a = cutout(part, watermark=False, despill_all=True)
            elements[name] = trim(rgba_of(rgb, a))
            print(f"cut {name}")

    measured = {k: stats(v) for k, v in elements.items()}
    target_l = float(np.median([m[0] for m in measured.values()]))
    target_s = float(np.median([m[1] for m in measured.values()]))
    thumbs = []
    for name, rgba in elements.items():
        l, sat = measured[name]
        graded = grade(rgba, (target_l + l) / 2, (target_s + sat) / 2, l, sat, look="desert")
        img = to_image(graded)
        img.save(out_dir[name] / f"{name}.webp", "WEBP", quality=90, method=6)
        print(f"{name:16s} {img.width}x{img.height}  L {l:.2f}->{(target_l + l) / 2:.2f}  S {sat:.2f}  -> {out_dir[name].parent.name}/hand")
        t = img.copy()
        t.thumbnail((360, 360))
        thumbs.append(t)
    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    sheet_img = Image.new("RGBA", (cols * 380, rows * 380), (90, 96, 110, 255))
    for i, t in enumerate(thumbs):
        sheet_img.alpha_composite(t, ((i % cols) * 380 + 10, (i // cols) * 380 + 10))
    sheet_img.convert("RGB").save(CAPTURES / "giza_processed.png")
    print("sheet ->", CAPTURES / "giza_processed.png")


PEAK_OUT = ROOT / "frontend" / "public" / "artkits" / "peak" / "hand"


def remove_sparkle(rgb: np.ndarray, box=WATERMARK_BOX) -> np.ndarray:
    """Watermark that may sit on top of the art (snow): replace only pixels brighter than their
    local median with that median, so the painting under the sparkle survives."""
    h, w, _ = rgb.shape
    x0, y0, x1, y1 = int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)
    out = rgb.copy()
    region = out[y0:y1, x0:x1]
    med = np.stack([ndimage.median_filter(region[..., c], size=21) for c in range(3)], axis=2)
    mask = (luma(region) - luma(med)) > 0.02
    mask = ndimage.binary_dilation(mask, iterations=2)
    region[mask] = med[mask]
    return out


def soft_cutout(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Translucent art (clouds): alpha from the distance to the screen colour, then un-mix the
    screen out of the colour, so soft edges stay soft instead of a hard matte."""
    key = key_color(rgb)
    rgb = remove_sparkle(rgb)
    d = np.linalg.norm(rgb - key, axis=2)
    a = np.clip((d - 0.12) / 0.75, 0.0, 1.0)
    a = ndimage.gaussian_filter(a, 0.8)
    c = (rgb - key[None, None, :] * (1 - a[..., None])) / np.maximum(a[..., None], 0.05)
    c = np.clip(c, 0, 1)
    # Residual green: clouds are neutral, so clamp green to the red/blue level.
    c[..., 1] = np.minimum(c[..., 1], np.maximum(c[..., 0], c[..., 2]) * 1.02)
    # Un-mixing overshoots into magenta in thin areas; clouds are near-neutral, so keep 15% of the chroma.
    lum = luma(c)[..., None]
    c = np.clip(lum + (c - lum) * 0.15, 0, 1)
    a[a < 0.02] = 0
    # Drop specks (watermark residue, noise) away from the cloud body.
    labels, n = ndimage.label(a > 0.05)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(a), labels, index=np.arange(1, n + 1))
        keep = np.isin(labels, 1 + np.flatnonzero(sizes > 0.002 * a.size))
        a = a * ndimage.binary_dilation(keep, iterations=6)
    return c, a


def run_peak() -> None:
    """Peak art: art-raw/peak/*.png -> artkits/peak/hand/ (neutral mid tones; the kit's per-time sky
    grades them). Code-painted versions in peak/painted/ stay as fallbacks; snow stays code-made."""
    PEAK_OUT.mkdir(parents=True, exist_ok=True)
    elements: dict[str, np.ndarray] = {}
    # Only the forest has genuine green; everything else (snow, rock) is despilled all over.
    for name in ["summit", "range-far", "range-mid", "slope-forest", "ledge"]:
        raw = remove_sparkle(load(f"peak/{name}.png"))
        rgb, a = cutout(raw, watermark=False, despill_all=name != "slope-forest")
        elements[name] = trim(rgba_of(rgb, a))
        print(f"cut {name}")
    rgb, a = soft_cutout(load("peak/cloud.png"))
    elements["cloud"] = trim(rgba_of(rgb, a))
    print("cut cloud (soft alpha)")
    sheet = remove_sparkle(load("peak/sheet-pines.png"))
    mid = sheet.shape[1] // 2
    for name, part in (("pine", sheet[:, :mid]), ("pine-b", sheet[:, mid:])):
        rgb, a = cutout(part, watermark=False, despill_all=True)  # magenta sheet, no genuine pink
        elements[name] = trim(rgba_of(rgb, a))
        print(f"cut {name}")

    # Neutral mid tones: every element is pulled halfway to the set median and then toward a
    # mid luma, with no colour cast, so moonlight, alpenglow and day light all read on it.
    measured = {k: stats(v) for k, v in elements.items()}
    set_l = float(np.median([m[0] for m in measured.values()]))
    set_s = float(np.median([m[1] for m in measured.values()]))
    thumbs = []
    for name, rgba in elements.items():
        l, sat = measured[name]
        target = 0.5 * (0.5 * (set_l + l)) + 0.5 * 0.56
        rgb = rgba[..., :3] * np.clip(target / max(l, 1e-3), 0.7, 1.3)
        lum = luma(rgb)[..., None]
        rgb = lum + (rgb - lum) * np.clip(0.9 * set_s / max(sat, 1e-3), 0.7, 1.1)
        graded = rgba.copy()
        graded[..., :3] = np.clip(rgb, 0, 1)
        img = to_image(graded)
        img.save(PEAK_OUT / f"{name}.webp", "WEBP", quality=90, method=6)
        print(f"{name:14s} {img.width}x{img.height}  L {l:.2f}->{target:.2f}  S {sat:.2f}")
        t = img.copy()
        t.thumbnail((360, 360))
        thumbs.append(t)
    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    sheet_img = Image.new("RGBA", (cols * 380, rows * 380), (70, 76, 92, 255))
    for i, t in enumerate(thumbs):
        sheet_img.alpha_composite(t, ((i % cols) * 380 + 10, (i // cols) * 380 + 10))
    sheet_img.convert("RGB").save(CAPTURES / "peak_processed.png")
    print("sheet ->", CAPTURES / "peak_processed.png")


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="Process hand-painted art into kit layers.")
    ap.add_argument("--set", choices=["kyoto", "giza", "peak", "all"], default="all", help="which art set to process")
    which = ap.parse_args().set
    if which in ("kyoto", "all"):
        run_kyoto()
    if which in ("giza", "all"):
        run_giza()
    if which in ("peak", "all"):
        run_peak()


if __name__ == "__main__":
    main()
