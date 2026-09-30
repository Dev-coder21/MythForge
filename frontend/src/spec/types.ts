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

export type TitleLayout = 'horizontal' | 'vertical'

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

/** Quality-check verdict for an AI-painted landmark layer. */
export interface LandmarkCheck {
  passed: boolean
  /** "provider:model" of the vision model that judged it. */
  checkedBy: string
  reasons: string[]
  attempts: number
}

/**
 * The physical landmark a chapter depicts, described only from the sources. When
 * `layer` is set, an AI-painted cutout is composited into the template's hero slot.
 */
export interface Landmark {
  name: string
  description: string
  /** Transparent webp of the painted landmark (served by the backend). */
  layer?: ImageRef
  /** The Wikipedia lead photo the painting was checked against. */
  reference?: ImageRef
  check?: LandmarkCheck
}

export interface Chapter {
  index: number
  /** e.g. "CHAPTER 01 · THE HIDDEN GATE" (middle dot separator, never an em dash) */
  label: string
  /** The giant 3D title word placed between mid and near layers. */
  titleWord: string
  heading: string
  subheading: string
  body: string
  sceneTemplate: SceneTemplateId
  sceneParams: SceneParams
  /** How the giant 3D title is set: across the frame (default) or stacked vertically. */
  titleLayout?: TitleLayout
  /** Where the chapter's facts come from, e.g. "wikipedia:Great Pyramid of Giza". */
  source?: string
  transition: TransitionType
  heroImage?: ImageRef
  landmark?: Landmark | null
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
