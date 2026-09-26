import type { ParticleType } from '@/spec'

export interface ParticlePreset {
  color: string
  size: number
  speed: number
  /** Vertical travel per second in world units (negative = falls). */
  rise: number
  /** 0–1 how much particles blink (fireflies). */
  blink: number
}

/** Motion/look per SceneParams.particleType. Template code stays topic-agnostic. */
export const PARTICLE_PRESETS: Record<Exclude<ParticleType, 'none'>, ParticlePreset> = {
  fireflies: { color: '#ffd98a', size: 0.09, speed: 0.6, rise: 0.08, blink: 1 },
  petals: { color: '#f6c3d0', size: 0.11, speed: 0.9, rise: -0.35, blink: 0 },
  snow: { color: '#f2f6ff', size: 0.07, speed: 0.5, rise: -0.45, blink: 0 },
  embers: { color: '#ff8a3d', size: 0.06, speed: 1.2, rise: 0.6, blink: 0.4 },
  dust: { color: '#e9dcc0', size: 0.04, speed: 0.3, rise: 0.02, blink: 0.1 },
  rain: { color: '#b9c8dc', size: 0.035, speed: 1, rise: -6, blink: 0 },
}
