import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { useEffect } from 'react'

gsap.registerPlugin(ScrollTrigger)

/**
 * Lenis smooth scroll driven by the GSAP ticker and feeding ScrollTrigger,
 * so scrubbed timelines and the smoothed scroll position never drift apart.
 * Disabled under reduced motion (native scroll).
 */
export function useSmoothScroll(enabled: boolean, lerp = 0.085) {
  useEffect(() => {
    if (!enabled) return

    const lenis = new Lenis({ autoRaf: false, lerp })
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    // Dev-only handle for scripted scroll checks (e.g. __lenis.scrollTo(y, { immediate: true })).
    if (import.meta.env.DEV) (window as { __lenis?: Lenis }).__lenis = lenis

    return () => {
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33)
      lenis.destroy()
    }
  }, [enabled, lerp])
}
