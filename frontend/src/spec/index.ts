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
  // Dev-only template preview (tuning, npm run shots / fps); stripped from production builds.
  ...(import.meta.env.DEV ? {
        'peak-preview': async () => (await import('./preview-peak.json')).default as StorySpec,
        'hero-preview': async () => (await import('./preview-hero.json')).default as StorySpec,
        'settings-preview': async () => (await import('./preview-settings.json')).default as StorySpec,
        'nature-preview': async () => (await import('./preview-nature.json')).default as StorySpec,
      } : {}),
}

/** Stories to offer readers (previews excluded). */
export const PUBLIC_STORIES = Object.keys(STORIES).filter((s) => !s.endsWith('-preview'))

export const DEFAULT_STORY = 'kyoto'
