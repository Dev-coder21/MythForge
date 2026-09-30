import { describe, expect, it } from 'vitest'
import { STORIES } from '.'
import type { StorySpec } from './types'
// One rule set for backend validation and this test: edit backend/app/schemas/copy_rules.json only.
import RULES from '../../../backend/app/schemas/copy_rules.json'

const TEMPLATES = ['threshold', 'peak', 'tide', 'grove', 'skyline', 'dune', 'cosmos', 'ruin', 'harbor']
const PARTICLES = ['petals', 'snow', 'embers', 'fireflies', 'dust', 'rain', 'none']
const GROUNDS = ['grass', 'sand', 'water', 'stone', 'void']
const BACKGROUNDS = ['moon', 'sun', 'stars', 'clouds', 'none']
const TIMES = ['dawn', 'day', 'dusk', 'night']
const TRANSITIONS = ['noise-dissolve', 'ink-wipe', 'bloom-out']
const HEX = /^#[0-9a-f]{6}$/i
const NOT_X_BUT_Y = new RegExp(RULES.notXButY, 'i')

/** Mirrors purple_problem() in backend/app/schemas/story.py (HLS hue/saturation/lightness). */
function isPurple(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return false
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  const p = RULES.purple
  return h >= p.hueMin && h <= p.hueMax && s > p.minSaturation && l > p.minLightness
}

function copyTexts(spec: StorySpec): string[] {
  return [spec.title, spec.subtitle, ...spec.chapters.flatMap((c) => [c.label, c.titleWord, c.heading, c.subheading, c.body])]
}

function checkSpec(spec: StorySpec) {
  expect(spec.version).toBe(1)
  expect(spec.chapters.map((c) => c.index)).toEqual(spec.chapters.map((_, i) => i + 1))

  // Copy rules (CLAUDE.md "Design quality rules").
  for (const t of copyTexts(spec)) {
    expect(t).not.toContain(RULES.emDash)
    expect(t).not.toMatch(NOT_X_BUT_Y)
    for (const c of RULES.cliches) expect(t.toLowerCase(), `cliche "${c}"`).not.toContain(c)
  }

  for (const c of spec.chapters) {
    const p = c.sceneParams
    expect(c.label).toMatch(new RegExp(RULES.label))
    expect(c.titleWord).toMatch(new RegExp(RULES.titleWord))
    expect(c.heading.length).toBeLessThanOrEqual(RULES.headingMax)
    expect(TEMPLATES).toContain(c.sceneTemplate)
    expect(TRANSITIONS).toContain(c.transition)
    expect(PARTICLES).toContain(p.particleType)
    expect(GROUNDS).toContain(p.groundType)
    expect(BACKGROUNDS).toContain(p.backgroundObject)
    expect(TIMES).toContain(p.timeOfDay)
    expect(p.primaryColor).toMatch(HEX)
    expect(p.accentColor).toMatch(HEX)
    expect(isPurple(p.primaryColor), `${p.primaryColor} is purple`).toBe(false)
    expect(isPurple(p.accentColor), `${p.accentColor} is purple`).toBe(false)
  }
}

describe.each(Object.keys(STORIES))('story "%s"', (slug) => {
  it('follows the spec and copy rules', async () => {
    const spec = await STORIES[slug]!()
    expect(spec.slug.startsWith(slug)).toBe(true)
    checkSpec(spec)
  })
})

// Specs written by the backend pipeline also follow the stricter generated-heading rules.
const generated = import.meta.glob<StorySpec>('../../../backend/samples/*.json', { eager: true, import: 'default' })
const generatedSpecs = Object.entries(generated).filter(([path]) => !path.endsWith('grounding.json'))

describe.each(generatedSpecs)('generated %s', (_path, spec) => {
  it('follows the spec and copy rules', () => checkSpec(spec))

  it('has short, number-free headings', () => {
    for (const c of spec.chapters) {
      expect(c.heading.length).toBeLessThanOrEqual(RULES.generatedHeadingMax)
      if (RULES.generatedHeadingNoDigits) expect(c.heading).not.toMatch(/\d/)
    }
  })
})

describe('purple rule', () => {
  it('flags violet, passes dark neutrals and warm tones', () => {
    expect(isPurple('#9a8bd3')).toBe(true)
    expect(isPurple('#6a2c91')).toBe(true)
    expect(isPurple('#1e1c2a')).toBe(false)
    expect(isPurple('#0b1026')).toBe(false)
    expect(isPurple('#f0a24a')).toBe(false)
  })
})
