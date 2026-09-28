import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import type { RefObject } from 'react'
import { chapterState, resetLetters } from '../store'

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText)

interface ChapterTimelineOptions {
  letterCount: number
  reducedMotion: boolean
  /** Pinned scroll distance, as a percentage of viewport height. */
  pinLength?: number
}

/** [data-reveal key, timeline position, duration] for the line-mask copy reveal. */
const LINE_REVEALS: [string, number, number][] = [
  ['heading', 0.2, 0.1],
  ['body', 0.27, 0.12],
]

/**
 * Intro + scroll choreography for one chapter.
 *
 * Intro (time-based, on load): title letters rise from behind the foreground
 * and the hero copy fades in, so the chapter opens composed rather than empty.
 *
 * Scroll (pinned, scrubbed, timeline duration 1 = whole chapter):
 *   0–12%   hero copy + numerals leave, camera starts its push
 *   12–40%  title ghosts into the scene, scene dims, chapter copy reveals
 *   60–85%  title fades out, particles thicken, light intensifies
 *   85–100% copy clears (transition slot)
 */
export function useChapterTimeline(
  sectionRef: RefObject<HTMLElement | null>,
  { letterCount, reducedMotion, pinLength = 250 }: ChapterTimelineOptions,
) {
  useGSAP(
    () => {
      const section = sectionRef.current
      if (!section) return

      resetLetters(letterCount)
      const s = chapterState
      s.progress = 0
      s.titleOut = 0
      s.intensity = 0
      s.dim = 0

      const q = gsap.utils.selector(section)
      const rise = reducedMotion ? 0 : 1

      // --- intro -------------------------------------------------------------
      const intro = gsap.timeline({ delay: 0.5 })
      intro.to(s.letters, { v: 1, duration: reducedMotion ? 0.8 : 1.3, ease: 'power3.out', stagger: 0.09 })
      intro.from(
        q('[data-hero] > *'),
        { autoAlpha: 0, y: 18 * rise, duration: 0.9, ease: 'power2.out', stagger: 0.1 },
        0.35,
      )
      intro.from(q('[data-numerals] > *, [data-side]'), { autoAlpha: 0, y: 10 * rise, duration: 0.7, stagger: 0.06 }, 0.7)

      // --- scroll ------------------------------------------------------------
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: section,
          pin: true,
          start: 'top top',
          end: `+=${pinLength}%`,
          scrub: reducedMotion ? true : 1.2,
          invalidateOnRefresh: true,
        },
      })

      tl.to(s, { progress: 1, duration: 1 }, 0)

      // Hero leaves (to-tweens: start values are read on first scroll, after the intro).
      tl.to(q('[data-hero]'), { autoAlpha: 0, y: -48 * rise, duration: 0.12, ease: 'power1.in' }, 0)
      tl.to(q('[data-numerals], [data-side]'), { autoAlpha: 0, duration: 0.12 }, 0.04)

      // Title ghosts back while the scene dims for reading.
      tl.to(s, { titleOut: 0.9, duration: 0.2, ease: 'power1.inOut' }, 0.12)
      tl.to(s, { dim: 1, duration: 0.18, ease: 'sine.inOut' }, 0.14)

      tl.fromTo(
        q('[data-reveal="label"]'),
        { autoAlpha: 0, y: 12 * rise },
        { autoAlpha: 1, y: 0, duration: 0.06, ease: 'power2.out' },
        0.17,
      )
      const splits = LINE_REVEALS.map(([key, at, duration]) =>
        SplitText.create(q(`[data-reveal="${key}"]`), {
          type: 'lines',
          mask: 'lines',
          autoSplit: true,
          // Return the tween itself (not `tl`, which tl.fromTo returns), so a
          // re-split on resize/font load only kills this tween.
          onSplit: (self) => {
            const tween = reducedMotion
              ? gsap.fromTo(self.lines, { autoAlpha: 0 }, { autoAlpha: 1, duration, stagger: duration * 0.2 })
              : gsap.fromTo(
                  self.lines,
                  { yPercent: 115 },
                  { yPercent: 0, duration, ease: 'power3.out', stagger: duration * 0.2 },
                )
            tl.add(tween, at)
            return tween
          },
        }),
      )
      tl.fromTo(q('[data-reveal="cta"]'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.06 }, 0.38)

      // Title out, light up.
      tl.to(s, { titleOut: 1, duration: 0.2, ease: 'power1.in' }, 0.62)
      tl.to(s, { intensity: 1, duration: 0.25, ease: 'sine.inOut' }, 0.6)

      // Clear the copy; the shader transition will live here.
      tl.to(q('[data-copy]'), { autoAlpha: 0, duration: 0.1 }, 0.87)
      tl.to(s, { dim: 0.45, duration: 0.12 }, 0.87)

      return () => splits.forEach((split) => split.revert())
    },
    { scope: sectionRef, dependencies: [letterCount, reducedMotion, pinLength], revertOnUpdate: true },
  )
}
