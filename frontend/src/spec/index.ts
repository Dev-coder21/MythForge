import kyoto from './sample-kyoto.json'
import type { StorySpec } from './types'

export type * from './types'

// JSON imports widen string literals to `string`, so the cast is needed; the
// literal values (templates, particle types, ...) are checked in spec.test.ts.
export const sampleKyoto = kyoto as StorySpec
