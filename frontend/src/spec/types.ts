/**
 * StorySpec — the single contract between backend and frontend.
 * The frontend only ever renders a StorySpec; it never calls the LLM.
 *
 * Keep in sync with backend/app/schemas/story.py
 */

export type HexColor = `#${string}`

export type SceneTemplateId =
  | 'threshold'
  | 'peak'
  | 'tide'
  | 'grove'
  | 'skyline'
  | 'dune'
  | 'cosmos'
  | 'ruin'

export type ParticleType = 'petals' | 'snow' | 'embers' | 'fireflies' | 'dust' | 'rain' | 'none'

export type GroundType = 'grass' | 'sand' | 'water' | 'stone' | 'void'

export type BackgroundObject = 'moon' | 'sun' | 'stars' | 'clouds' | 'none'

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night'

/** Full-screen shader pass used to leave this chapter. */
export type TransitionType = 'noise-dissolve' | 'ink-wipe' | 'bloom-out'

/** All variation a scene template receives. No topic-specific code inside templates. */
export interface SceneParams {
  primaryColor: HexColor
  accentColor: HexColor
  particleType: ParticleType
  groundType: GroundType
  backgroundObject: BackgroundObject
  /** Template-specific variant, e.g. 'gate' | 'tower' | 'tree'. */
  propVariant: string
  /** Art kit folder under public/artkits/<template>/<kit>/. */
  artKit: string
  timeOfDay: TimeOfDay
  /** Swap-in prop layers from the kit's props/ folder. */
  props: string[]
  /** 0–1 multiplier on the template's base particle count. */
  particleDensity?: number
}

export interface ImageRef {
  url: string
  attribution: string
  license?: string
}

export interface Chapter {
  index: number
  /** e.g. "CHAPTER 01 — THE HIDDEN GATE" */
  label: string
  /** The giant 3D title word placed between mid and near layers. */
  titleWord: string
  heading: string
  subheading: string
  body: string
  sceneTemplate: SceneTemplateId
  sceneParams: SceneParams
  transition: TransitionType
  heroImage?: ImageRef
}

export interface StorySpec {
  version: 1
  id: string
  topic: string
  title: string
  subtitle: string
  slug: string
  chapters: Chapter[]
  /** ISO 8601 timestamp. */
  createdAt: string
}
