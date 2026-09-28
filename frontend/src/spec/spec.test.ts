import { describe, expect, it } from 'vitest'
import { sampleKyoto } from '.'

const TEMPLATES = ['threshold', 'peak', 'tide', 'grove', 'skyline', 'dune', 'cosmos', 'ruin']
const PARTICLES = ['petals', 'snow', 'embers', 'fireflies', 'dust', 'rain', 'none']
const GROUNDS = ['grass', 'sand', 'water', 'stone', 'void']
const BACKGROUNDS = ['moon', 'sun', 'stars', 'clouds', 'none']
const TIMES = ['dawn', 'day', 'dusk', 'night']
const TRANSITIONS = ['noise-dissolve', 'ink-wipe', 'bloom-out']
const HEX = /^#[0-9a-f]{6}$/i

describe('sample-kyoto.json', () => {
  it('has 3 chapters with unique, ordered indices', () => {
    expect(sampleKyoto.version).toBe(1)
    expect(sampleKyoto.chapters.map((c) => c.index)).toEqual([1, 2, 3])
  })

  // Copy rules (CLAUDE.md "Design quality rules"): no em dashes anywhere in story copy.
  it('has no em dashes in any copy', () => {
    const texts = [
      sampleKyoto.title,
      sampleKyoto.subtitle,
      ...sampleKyoto.chapters.flatMap((c) => [c.label, c.titleWord, c.heading, c.subheading, c.body]),
    ]
    for (const t of texts) expect(t).not.toMatch(/—/)
  })

  it('uses only valid enum values and hex colors', () => {
    for (const c of sampleKyoto.chapters) {
      const p = c.sceneParams
      expect(TEMPLATES).toContain(c.sceneTemplate)
      expect(TRANSITIONS).toContain(c.transition)
      expect(PARTICLES).toContain(p.particleType)
      expect(GROUNDS).toContain(p.groundType)
      expect(BACKGROUNDS).toContain(p.backgroundObject)
      expect(TIMES).toContain(p.timeOfDay)
      expect(p.primaryColor).toMatch(HEX)
      expect(p.accentColor).toMatch(HEX)
    }
  })
})
