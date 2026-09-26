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
    u: 0.68,
    v: 0.76,
    // Portrait: copy fills the top of the screen, so the moon drops to frame inside the gate.
    uPortrait: 0.55,
    vPortrait: 0.54,
    size: 0.075,
    driftU: -0.06,
    driftV: 0.05,
    intensity: 2.4,
    haloRadius: 2.3,
  },
  far: { z: -35, heightFrac: 0.55, bottomFrac: 0.02, fogMix: 0.3 },
  fog: { z: -25, opacity: 0.32, speed: 0.035, height: 0.55, scale: 2.2 },
  // anchorUv = the hill's ground line in the structure texture, pinned at bottomFrac.
  mid: { z: -15, heightFrac: 0.62, bottomFrac: 0.16, anchorUv: 0.31, maxWidthFrac: 2.4, fogMix: 0.18 },
  title: { z: -6, v: 0.25, fontSize: 5.2, letterSpacing: 0.02, riseDistance: 1.05, driftBack: 3, fitWidth: 0.84 },
  near: { z: -3, heightFrac: 1.12, bottomFrac: -0.06, sway: 0.35, rim: 0.25 },
  particles: { zMin: -18, zMax: 1 },
  fore: { z: 2, heightFrac: 0.62, bottomFrac: -0.14, sway: 0.6, rim: 0.55 },
}

export const THRESHOLD_CAMERA: { position: Vec3Tuple[]; lookAt: Vec3Tuple[] } = {
  // Push forward, rise slightly, small yaw to the right.
  position: [
    [-0.6, 1.2, 14],
    [-0.25, 1.35, 11.6],
    [0.2, 1.65, 8.8],
    [0.55, 1.95, 5.8],
  ],
  lookAt: [
    [0, 2.4, -20],
    [0.35, 2.55, -20],
    [0.9, 2.8, -20],
    [1.6, 3.1, -20],
  ],
}

const hex = (c: Color) => `#${c.getHexString()}`

/** Derive the full layer palette from the two spec colors + time of day. */
export function thresholdPalette(p: SceneParams) {
  const primary = new Color(p.primaryColor)
  const accent = new Color(p.accentColor)
  const white = new Color('#ffffff')

  const moonByTime = { night: '#f4efe2', dawn: '#ffe9c9', dusk: '#ffd2a1', day: '#fffaf0' } as const

  return {
    skyTop: hex(primary.clone().multiplyScalar(0.55)),
    skyMid: hex(primary.clone().lerp(white, 0.06)),
    skyHorizon: hex(primary.clone().lerp(accent, 0.12).lerp(white, 0.2)),
    fog: hex(primary.clone().lerp(white, 0.3)),
    far: hex(primary.clone().lerp(white, 0.05).multiplyScalar(1.6)),
    mid: hex(primary.clone().lerp(accent, 0.55).multiplyScalar(0.55)),
    near: hex(primary.clone().multiplyScalar(0.5)),
    fore: hex(primary.clone().multiplyScalar(0.28)),
    moon: moonByTime[p.timeOfDay],
    title: '#f3ebdd',
    titleGlow: hex(accent),
    particles: '',
  }
}
