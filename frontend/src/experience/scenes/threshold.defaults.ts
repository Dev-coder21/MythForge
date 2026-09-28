import { Color } from 'three'
import type { SceneParams } from '@/spec'
import type { Vec3Tuple } from '../camera/paths'

/**
 * Default layout for the Threshold template, standing in for kit.json until
 * real art kits exist. All values are exposed in leva for live tuning.
 */
export const THRESHOLD_LAYOUT = {
  sky: { z: -60, midPosition: 0.45, stars: 1 },
  moon: {
    z: -45,
    // Low enough that the gate's top beam cuts across the disc.
    u: 0.64,
    v: 0.66,
    // Portrait: copy fills the top of the screen, so the moon drops to frame inside the gate.
    uPortrait: 0.55,
    vPortrait: 0.5,
    size: 0.09,
    driftU: -0.04,
    driftV: 0.03,
    intensity: 1.5,
    haloRadius: 2.3,
    halo: 0.06,
  },
  far: { z: -35, heightFrac: 0.55, bottomFrac: 0.02, fogMix: 0.22 },
  fog: { z: -25, opacity: 0.16, speed: 0.035, height: 0.5, scale: 2.2 },
  // anchorUv = the hill's ground line in the structure texture, pinned at bottomFrac.
  mid: { z: -15, heightFrac: 0.62, bottomFrac: 0.16, anchorUv: 0.31, maxWidthFrac: 2.4, fogMix: 0.18 },
  // Landscape: wide-tracked, left-anchored, scaled to fitWidth × the opening
  // frame so the last letter is partly clipped by the right edge (margin 0.05 +
  // 0.98 → right edge at ~103%). Portrait: centered and fitted. Baseline sits deep in the hill.
  title: {
    z: -6,
    v: 0.17,
    // Portrait: tighter tracking so the fitted word stays large, and a higher baseline so it clears the grass.
    vPortrait: 0.3,
    fontSize: 6.4,
    letterSpacing: 0.3,
    letterSpacingPortrait: 0.06,
    riseDistance: 1.05,
    driftBack: 3,
    fitWidth: 0.98,
    fitWidthPortrait: 0.9,
    leftMargin: 0.05,
  },
  near: { z: -3, heightFrac: 1.12, bottomFrac: -0.06, sway: 0.35, rim: 0.25 },
  particles: { zMin: -18, zMax: 1 },
  fore: { z: 2, heightFrac: 0.62, bottomFrac: -0.14, sway: 0.6, rim: 0.55 },
}

export const THRESHOLD_CAMERA: { position: Vec3Tuple[]; lookAt: Vec3Tuple[] } = {
  // Straight dolly-in that settles slightly and tips down onto the hill, so the
  // mound grows to fill the frame while the sky/moon stay nearly locked. Only a
  // hint of yaw. (Matches the reference feel; EXPERIENCE_SPEC §4 suggested a rise.)
  position: [
    [0, 1.3, 14],
    [0.05, 1.25, 11.4],
    [0.12, 1.15, 8.6],
    [0.2, 1.05, 6],
  ],
  lookAt: [
    [0, 2.6, -20],
    [0.1, 2.2, -20],
    [0.25, 1.6, -20],
    [0.4, 1.0, -20],
  ],
}

const hex = (c: Color) => `#${c.getHexString()}`

/** Derive the full layer palette from the two spec colors + time of day. */
export function thresholdPalette(p: SceneParams) {
  const primary = new Color(p.primaryColor)
  const accent = new Color(p.accentColor)
  const white = new Color('#ffffff')

  // At night the moon takes the chapter accent (a vermilion moon for Kyoto);
  // other times of day keep a warm natural tone.
  const moonByTime = {
    night: hex(accent.clone().lerp(white, 0.18)),
    dawn: '#ffe9c9',
    dusk: '#ffd2a1',
    day: '#fffaf0',
  } as const

  const sunLight = new Color(moonByTime[p.timeOfDay])
  const pale = new Color('#b9c8ff')

  // Sky per time of day. Night: near-black with little haze, so the few lit
  // accents carry the frame. Dusk: a warm band low on the horizon under a deep
  // top (never purple-and-black). Dawn: pale gold horizon, cool slate top.
  const sky = {
    night: {
      top: primary.clone().multiplyScalar(0.35),
      mid: primary.clone().multiplyScalar(0.8),
      horizon: primary.clone().lerp(accent, 0.1).lerp(white, 0.08),
      fog: primary.clone().lerp(white, 0.18),
    },
    dusk: {
      top: new Color('#0c1424').lerp(primary, 0.25),
      mid: primary.clone().lerp(sunLight, 0.12).multiplyScalar(0.75),
      horizon: sunLight.clone().lerp(accent, 0.3).multiplyScalar(0.85),
      fog: primary.clone().lerp(sunLight, 0.3).multiplyScalar(0.75),
    },
    dawn: {
      top: primary.clone().multiplyScalar(0.6),
      mid: primary.clone().lerp(white, 0.1),
      horizon: accent.clone().lerp(white, 0.3).multiplyScalar(0.9),
      fog: primary.clone().lerp(accent, 0.15).lerp(white, 0.22),
    },
    day: {
      top: primary.clone().lerp(white, 0.2),
      mid: primary.clone().lerp(white, 0.45),
      horizon: white.clone().lerp(accent, 0.15),
      fog: primary.clone().lerp(white, 0.6),
    },
  }[p.timeOfDay]

  return {
    skyTop: hex(sky.top),
    skyMid: hex(sky.mid),
    skyHorizon: hex(sky.horizon),
    fog: hex(sky.fog),
    /** Tint for kit layers that opt in (kit.json "tint"), so kits follow the chapter palette. */
    kitTint: hex(p.timeOfDay === 'night' ? primary.clone().lerp(white, 0.55) : sky.fog.clone().lerp(sunLight, 0.3)),
    /** Runtime rim on kit edges: the key light. Moonlight is cooled toward pale blue; sun stays warm. */
    kitRim: hex(p.timeOfDay === 'night' ? sunLight.clone().lerp(pale, 0.6) : sunLight.clone()),
    moon: moonByTime[p.timeOfDay],
    title: '#ece6da',
    titleGlow: hex(accent),
    particles: '',
  }
}
