/**
 * Mutable per-frame state shared between the GSAP scroll timeline (writer) and
 * the R3F scene (reader in useFrame). Deliberately not React state: scrolling
 * must never trigger re-renders.
 */
export interface LetterState {
  /** 0 = hidden behind the foreground, 1 = fully risen. */
  v: number
}

export const chapterState = {
  /** 0–1 progress through the pinned chapter. */
  progress: 0,
  /** Per-letter reveal of the 3D title (beat 1). */
  letters: [] as LetterState[],
  /** Title drifting back + fading (beat 3). */
  titleOut: 0,
  /** Particles thicken, moon/bloom intensify (beat 3). */
  intensity: 0,
  /** Scene darkens + desaturates behind the chapter copy (0–1). */
  dim: 0,
  /** Normalized pointer, -1..1 on both axes. */
  pointer: { x: 0, y: 0 },
  /** Layer depth of field: focal plane z (the title), blur strength (0 = off), and
   *  multiplier for layers in front of the focal plane (keeps foreground silhouettes crisp). */
  focus: { z: -6, strength: 0, front: 0.2 },
  reducedMotion: false,
}

export function resetLetters(count: number) {
  chapterState.letters = Array.from({ length: count }, () => ({ v: 0 }))
}

// Dev-only handle for scripted checks (npm run shots) and console debugging.
if (import.meta.env.DEV) (window as { __chapter?: typeof chapterState }).__chapter = chapterState
