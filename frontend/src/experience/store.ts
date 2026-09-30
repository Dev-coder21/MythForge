import { createContext, useContext } from 'react'
import { Vector3, Vector4 } from 'three'

/**
 * Mutable per-frame state. Deliberately not React state: scrolling must never
 * trigger re-renders. GSAP timelines write it; useFrame callbacks read it.
 */

export const MAX_LIGHTS = 4

/** Point-light uniforms shared by every layer material of one chapter (lanterns). */
export function createLightUniforms() {
  return {
    uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4()) },
    uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector3()) },
    uLightCount: { value: 0 },
  }
}
export type LightUniforms = ReturnType<typeof createLightUniforms>

export interface LetterState {
  /** 0 = hidden behind the foreground, 1 = fully risen. */
  v: number
}

/** State of one chapter (each chapter has its own scene, camera and timeline). */
export interface ChapterState {
  index: number
  /** 0–1 progress through the chapter's scroll segment. */
  progress: number
  /** Per-letter reveal of the 3D title. */
  letters: LetterState[]
  /** Title drifting back + fading. */
  titleOut: number
  /** Particles thicken, moon/bloom intensify. */
  intensity: number
  /** Scene darkens + desaturates behind the chapter copy (0–1). */
  dim: number
  /** Focal plane z (the title) for layer depth of field. */
  focusZ: number
  /** Primary colour for the shadow-lift grade. */
  gradeTint: string
  lights: LightUniforms
  /** True once the chapter's scene has loaded its kit and mounted (safe to show). */
  ready: boolean
  /** Heat shimmer band: screen height 0–1 from the bottom, half-height, strength (0 = none). */
  heat: { v: number; h: number; strength: number }
}

export function createChapterState(index: number): ChapterState {
  return {
    index,
    progress: 0,
    letters: [],
    titleOut: 0,
    intensity: 0,
    dim: 0,
    focusZ: -6,
    gradeTint: '#000000',
    lights: createLightUniforms(),
    ready: false,
    heat: { v: 0, h: 0, strength: 0 },
  }
}

export function resetLetters(state: ChapterState, count: number) {
  state.letters = Array.from({ length: count }, () => ({ v: 0 }))
}

/** Story-wide state: input, accessibility, which chapter is on screen, DOF settings. */
export const storyState = {
  /** Normalized pointer, -1..1 on both axes. */
  pointer: { x: 0, y: 0 },
  reducedMotion: false,
  /** Chapter on screen; during a transition this is the outgoing one. */
  active: 0,
  /** 0 = only `active` visible, 1 = fully the next chapter. */
  transition: 0,
  /** Layer depth of field: blur strength (0 = off) and multiplier for layers in front of focus. */
  dof: { strength: 0, front: 0.2 },
}

export const ChapterContext = createContext<ChapterState | null>(null)

/** The state of the chapter this component renders in. */
export function useChapter(): ChapterState {
  const s = useContext(ChapterContext)
  if (!s) throw new Error('useChapter() outside a ChapterContext provider')
  return s
}

/** All chapter states of the mounted story (filled by StoryExperience). */
export const chapterStates: ChapterState[] = []

// Dev-only handle for scripted checks (npm run shots / fps) and console debugging.
if (import.meta.env.DEV) (window as { __story?: unknown }).__story = { storyState, chapterStates }
