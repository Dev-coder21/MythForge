# MythForge — Experience Spec (the 3D scroll story)

The bar: a generated story should feel like a hand-built award-site landing page (the Kage reference), while being driven entirely by a `StorySpec` JSON so it changes per topic. Match the *quality and feel* of the reference, never its assets or code.

---

## 1. What actually makes the reference look that good

| Ingredient | What it is | Share of the "wow" |
|---|---|---|
| **Painted layered art** | 5–8 transparent illustrated layers per scene (sky, far range, mid structure, near foliage, foreground grass/props) | ~40% |
| **Depth + camera** | Layers placed at real Z depths; camera travels a curved path so parallax is physical, not faked | ~20% |
| **Typography in the scene** | Giant title as a 3D object *between* layers (foreground occludes it), kinetic text reveals | ~15% |
| **Atmosphere + post** | Fog planes, bloom on moon/lanterns, grain, vignette, subtle chromatic aberration, color grade | ~15% |
| **Smooth scroll + transitions** | Lenis smoothing, scrubbed GSAP timelines, shader wipes between chapters | ~10% |

Procedural shapes alone will not reach this bar. **Art kits are mandatory.**

## 2. Art kits (how variety per topic works)

Each scene template ships one or more art kits in `public/artkits/<template>/<kit>/`:
```
sky.webp  far.webp  mid.webp  structure.webp  near.webp  fore.webp  props/*.webp  kit.json
```
- `kit.json` lists each layer's default Z, scale, anchor, and which layers accept tinting.
- Style must be consistent across ALL kits (same brush/illustration style, same lighting logic) so stories feel like one product.
- Sources: your own illustration, licensed asset packs, or AI-generated images you have rights to, cut into layers (remove.bg / Photoshop / Krita). Generate once per kit, never at request time.
- Target: 2 kits per template for v1 (e.g. Threshold: `torii-night`, `temple-dusk`).

Per-topic variation comes from combining:
1. **Template + kit** (chosen by Claude)
2. **Color grade**: per-layer tint + a global grade (lift/gamma/gain or 3D LUT) from `primaryColor` / `accentColor`
3. **Time of day**: sky gradient + sun/moon position + light color
4. **Particles**: petals / snow / embers / fireflies / dust / rain
5. **Props**: swap-in layers (lanterns, banners, boats, statues)
6. **Copy + title word**

## 3. Scene layer stack (per chapter)

```
z -60  Sky dome / gradient + stars shader
z -45  Sun/Moon: emissive disc + bloom + slow drift
z -35  Far range (tinted toward fog color)
z -25  Fog plane (animated noise, additive, low opacity)
z -15  Mid structure (temple / skyline / pyramids)
z -10  Volumetric light shafts (additive cones or screen-space god rays)
z  -6  TITLE (drei <Text> / troika, huge, slight emissive, masked reveal)
z  -3  Near foliage (vertex-shader sway)
z   0  Particles (instanced, 300–600, depth-sorted)
z  +2  Foreground grass/rocks (shader sway, rim light from moon color)
```
The title sits between mid and near layers so the foreground covers its lower part. Non-negotiable signature effect.

## 4. Camera and scroll choreography

- **Lenis** for smooth scroll, synced with ScrollTrigger (`lenis.on('scroll', ScrollTrigger.update)` + `gsap.ticker`).
- Each chapter = a pinned section of ~250vh with a **scrubbed GSAP timeline** (`scrub: 1.2`).
- Camera follows a per-chapter **CatmullRomCurve3** path + a look-at target path (dolly forward, rise slightly, small yaw). Never a straight linear zoom.
- Add inertial mouse parallax (lerped, max ~0.3 units) on top of the scroll path.
- Timeline beats inside one chapter:
  1. 0–15%: title letters rise from behind the foreground (per-letter stagger)
  2. 15–60%: camera push through the scene, heading + body reveal (SplitText line masks)
  3. 60–85%: title drifts back / fades, particles thicken, light intensifies
  4. 85–100%: chapter transition begins

## 5. Chapter transitions

Not black fades. Use a full-screen shader pass mixing chapter A and B render targets with:
- noise dissolve (default), or
- ink/smoke wipe, or
- light bloom-out (flash to accent color and back)
Chosen per chapter by the spec (`transition` field).

## 6. Post-processing stack (@react-three/postprocessing)

Bloom (selective, threshold ~0.8) → Depth of field (subtle, focus on title plane) → Chromatic aberration (tiny, increases during transitions) → Noise/grain (opacity ~0.06) → Vignette → Tone mapping (ACES) → optional LUT grade.

## 7. Shaders to write

- `GrassSway` / `FoliageSway`: vertex displacement by UV.y * sin(time + worldX), wind strength param
- `FogNoise`: scrolling fbm noise, alpha by height
- `WaterRipple`: normal-map distortion + reflection of sky layer
- `SkyGradient`: 3-stop gradient + twinkling stars
- `TitleReveal`: clip by per-letter progress uniform, soft edge glow
- `ChapterDissolve`: fbm threshold mix of two render targets

## 8. Typography and UI chrome

- Display face: a condensed heavy grotesque or high-contrast serif for 3D titles; humanist sans for body. Pick your own pairing, not the reference's.
- Kinetic reveals with GSAP SplitText (line masks, char stagger).
- Persistent chrome: chapter ticker (01/02/03…), scroll progress line, story title, sound toggle.
- Vertical side text and oversized chapter numbers as secondary kinetic elements.
- Loading screen: real texture-loading progress (drei `useProgress`), then an intro reveal.

## 9. Extra polish (after the core feels great)

Custom cursor that reacts to hover, ambient audio per template (off by default), lantern flicker point lights, gallery section with WebGL image distortion on hover, end-of-story index section.

## 10. Performance

60fps target on a mid-range laptop; test mobile early. Textures webp ≤ 2048px (KTX2 later), DPR ≤ 1.75, pause rendering off-screen, preload next chapter's kit only, dispose previous chapter's textures.

## 11. Definition of done for the experience

- One chapter with placeholder art that already feels smooth and cinematic (camera path, Lenis, title occlusion, post stack).
- Then: 2 art kits for Threshold looking as rich as the reference.
- Then: 3 sample specs (Kyoto, jazz, Giza) that look clearly different from each other while using the same code.
- Recorded side by side, a viewer can't tell a generated story from a hand-built one.
