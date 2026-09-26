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

/** [data-reveal key, timeline position, duration] for the line-mask copy reveal (beat 2). */
const LINE_REVEALS: [string, number, number][] = [
  ['heading', 0.17, 0.12],
  ['subheading', 0.27, 0.08],
  ['body', 0.33, 0.14],
]

/**
 * Pins the chapter section and builds one scrubbed master timeline (duration 1
 * = the whole chapter) with the four beats from EXPERIENCE_SPEC §4. The 3D
 * scene reads the values it writes into `chapterState`.
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

      const q = gsap.utils.selector(section)
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

      // Beat 1 (0–15%): letters rise from behind the foreground.
      const n = s.letters.length
      tl.to(
        s.letters,
        { v: 1, duration: 0.075, ease: 'power2.out', stagger: n > 1 ? 0.07 / (n - 1) : 0 },
        0.005,
      )
      tl.to(q('[data-hint]'), { autoAlpha: 0, duration: 0.04 }, 0)
      tl.fromTo(
        q('[data-reveal="label"]'),
        { autoAlpha: 0, y: reducedMotion ? 0 : 16 },
        { autoAlpha: 1, y: 0, duration: 0.06, ease: 'power2.out' },
        0.04,
      )

      // Beat 2 (15–60%): heading + body reveal through line masks. onSplit must
      // return the line tween itself (not `tl`, which tl.fromTo returns) so a
      // re-split on resize/font load only kills that tween.
      const splits = LINE_REVEALS.map(([key, at, duration]) =>
        SplitText.create(q(`[data-reveal="${key}"]`), {
          type: 'lines',
          mask: 'lines',
          autoSplit: true,
          onSplit: (self) => {
            const tween = reducedMotion
              ? gsap.fromTo(self.lines, { autoAlpha: 0 }, { autoAlpha: 1, duration, stagger: duration * 0.2 })
              : gsap.fromTo(
                  self.lines,
                  { yPercent: 115 },
                  { yPercent: 0, duration, ease: 'power3.out', stagger: duration * 0.25 },
                )
            tl.add(tween, at)
            return tween
          },
        }),
      )

      // Beat 3 (60–85%): title drifts back + fades, particles thicken, light intensifies.
      tl.to(s, { titleOut: 1, duration: 0.25, ease: 'power1.in' }, 0.6)
      tl.to(s, { intensity: 1, duration: 0.25, ease: 'sine.inOut' }, 0.6)

      // Beat 4 (85–100%): clear the copy; the shader transition will live here.
      tl.to(q('[data-copy]'), { autoAlpha: 0, duration: 0.1 }, 0.87)

      return () => splits.forEach((split) => split.revert())
    },
    { scope: sectionRef, dependencies: [letterCount, reducedMotion, pinLength], revertOnUpdate: true },
  )
}
