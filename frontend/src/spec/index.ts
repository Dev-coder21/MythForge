import kyoto from './sample-kyoto.json'
import type { StorySpec } from './types'

export type * from './types'

// JSON imports widen string literals to `string`, so the cast is needed; the
// literal values (templates, particle types, ...) are checked in spec.test.ts.
export const sampleKyoto = kyoto as StorySpec

/**
 * Stories available without a backend, by URL slug (?story=<slug>). Each spec
 * is loaded on demand so one story never ships another's JSON up front.
 */
export const STORIES: Record<string, () => Promise<StorySpec>> = {
  kyoto: async () => sampleKyoto,
  giza: async () => (await import('./sample-giza.json')).default as StorySpec,
}

export const DEFAULT_STORY = 'kyoto'
