import { describe, expect, it } from 'vitest'
import { sourceOf } from './ChapterOverlay'

describe('sourceOf', () => {
  it('reads English and other-language sources', () => {
    expect(sourceOf('wikipedia:Mount Fuji')).toMatchObject({ label: 'Wikipedia · Mount Fuji', lang: 'en' })
    expect(sourceOf('wikipedia:hi:शनिवार वाड़ा')).toMatchObject({
      label: 'Wikipedia · Hindi · शनिवार वाड़ा',
      lang: 'hi',
      href: `https://hi.wikipedia.org/wiki/${encodeURIComponent('शनिवार_वाड़ा')}`,
    })
    expect(sourceOf('wikipedia:Star Wars: A New Hope')?.lang).toBe('en')
  })
})
