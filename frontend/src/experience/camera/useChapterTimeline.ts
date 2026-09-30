import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import type { RefObject } from 'react'
import { resetLetters, type ChapterState } from '../store'

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText)

interface ChapterTimelineOptions {
  index: number
  letterCount: number
  reducedMotion: boolean
}

/** [data-reveal key, timeline position, duration] for the line-mask copy reveal. */
const LINE_REVEALS: [string, number, number][] = [
  ['heading', 0.2, 0.1],
  ['body', 0.27, 0.12],
]

/** Where the outgoing chapter hands over to the next one (EXPERIENCE_SPEC §4 beat 4). */
export const TRANSITION_START = 0.85

/**
 * Choreography for one chapter. `section` is the chapter's scroll spacer (its
 * height is the scroll length); `copy` is its DOM copy in the fixed overlay.
 *
 * Title intro: chapter 1 rises on load (time-based) so the page opens composed;
 * later chapters rise at the start of their own segment, right after the
 * transition reveals them.
 *
 * Scroll (scrubbed, timeline duration 1 = whole segment):
 *   0–10%   intro copy crossfades out; chapter copy fades in at 10–16%
 *   14–40%  title ghosts back, scene dims, label/heading then body reveal
 *   60–85%  title out, particles thicken, light intensifies
 *   80–100% copy clears; the shader transition to the next chapter runs from 85%
 */
export function useChapterTimeline(
  sectionRef: RefObject<HTMLElement | null>,
  copyRef: RefObject<HTMLElement | null>,
  state: ChapterState,
  { index, letterCount, reducedMotion }: ChapterTimelineOptions,
) {
  useGSAP(
    () => {
      const section = sectionRef.current
      const copy = copyRef.current
      if (!section || !copy) return

      resetLetters(state, letterCount)
      state.progress = 0
      state.titleOut = 0
      state.intensity = 0
      state.dim = 0

      const q = gsap.utils.selector(copy)
      const rise = reducedMotion ? 0 : 1

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: 'bottom top',
          scrub: reducedMotion ? true : 1.2,
          invalidateOnRefresh: true,
        },
      })
      tl.to(state, { progress: 1, duration: 1 }, 0)

      if (index === 0) {
        // Opening chapter: timed intro so the first frame is already composed.
        const intro = gsap.timeline({ delay: 0.5 })
        intro.to(state.letters, { v: 1, duration: reducedMotion ? 0.8 : 1.3, ease: 'power3.out', stagger: 0.09 })
        intro.from(q('[data-hero] > *'), { autoAlpha: 0, y: 18 * rise, duration: 0.9, ease: 'power2.out', stagger: 0.1 }, 0.35)
      } else {
        const n = state.letters.length
        tl.to(state.letters, { v: 1, duration: 0.08, ease: 'power2.out', stagger: n > 1 ? 0.05 / (n - 1) : 0 }, 0.005)
      }

      // Crossfade intro → chapter copy. The intro animates the hero's children and
      // the scroll animates the wrapper, so a mid-intro scroll still hides it.
      tl.to(q('[data-hero]'), { autoAlpha: 0, y: -40 * rise, duration: 0.1, ease: 'power1.in' }, index === 0 ? 0 : 0.03)
      tl.fromTo(q('[data-copy]'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.06 }, 0.1)

      // Title ghosts back while the scene dims for reading.
      tl.to(state, { titleOut: 0.8, duration: 0.2, ease: 'power1.inOut' }, 0.14)
      tl.to(state, { dim: 1, duration: 0.18, ease: 'sine.inOut' }, 0.14)

      tl.fromTo(q('[data-reveal="label"]'), { autoAlpha: 0, y: 12 * rise }, { autoAlpha: 1, y: 0, duration: 0.06, ease: 'power2.out' }, 0.17)
      const splits = LINE_REVEALS.map(([key, at, duration]) =>
        SplitText.create(q(`[data-reveal="${key}"]`), {
          type: 'lines',
          mask: 'lines',
          autoSplit: true,
          // Return the tween itself (not `tl`), so a re-split only kills this tween.
          onSplit: (self) => {
            const tween = reducedMotion
              ? gsap.fromTo(self.lines, { autoAlpha: 0 }, { autoAlpha: 1, duration, stagger: duration * 0.2 })
              : gsap.fromTo(self.lines, { yPercent: 115 }, { yPercent: 0, duration, ease: 'power3.out', stagger: duration * 0.2 })
            tl.add(tween, at)
            return tween
          },
        }),
      )
      tl.fromTo(q('[data-reveal="cta"], [data-reveal="source"]'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.06 }, 0.38)
      tl.fromTo(q('[data-reveal="body-mobile"]'), { autoAlpha: 0, y: 14 * rise }, { autoAlpha: 1, y: 0, duration: 0.08, ease: 'power2.out' }, 0.34)

      // Title out, light up.
      tl.to(state, { titleOut: 1, duration: 0.2, ease: 'power1.in' }, 0.62)
      tl.to(state, { intensity: 1, duration: 0.25, ease: 'sine.inOut' }, 0.6)

      // Clear the copy before the transition; the scene brightens back for the handover.
      tl.to(q('[data-copy], [data-reveal="body-mobile"]'), { autoAlpha: 0, duration: 0.06 }, 0.8)
      tl.to(state, { dim: 0.2, duration: 0.08 }, 0.8)

      return () => splits.forEach((split) => split.revert())
    },
    { scope: copyRef, dependencies: [index, letterCount, reducedMotion, state], revertOnUpdate: true },
  )
}
