import { PerformanceMonitor, Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useControls } from 'leva'
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { StorySpec } from '@/spec'
import { THRESHOLD_CAMERA } from './scenes/threshold.defaults'
import { Threshold } from './scenes/Threshold'
import { ChapterOverlay } from './ChapterOverlay'
import { useChapterTimeline } from './camera/useChapterTimeline'
import { useSmoothScroll } from './camera/useSmoothScroll'
import { disposePlaceholders } from './layers/placeholderTextures'
import { chapterState } from './store'
import { useReducedMotion } from './useReducedMotion'

const MAX_DPR = 1.75
/**
 * Device-pixel budget for the canvas. Six full-screen painted layers plus post
 * cost per pixel, so large windows start at a lower DPR (1440×900 → ~1.3) while
 * phones keep the full 1.75. PerformanceMonitor adapts further from there.
 */
const PIXEL_BUDGET = 2.2e6
const maxDprFor = (w: number, h: number) => Math.max(1, Math.min(MAX_DPR, Math.sqrt(PIXEL_BUDGET / (w * h))))

interface StoryExperienceProps {
  spec: StorySpec
  /** Index into spec.chapters. Only one chapter is rendered for now. */
  chapterIndex?: number
}

/** One pinned, scroll-scrubbed chapter: WebGL scene + DOM copy. */
export function StoryExperience({ spec, chapterIndex = 0 }: StoryExperienceProps) {
  const chapter = spec.chapters[chapterIndex]
  const debug = useControls('Debug', { forceReducedMotion: false, showStats: false })
  const reduced = useReducedMotion(debug.forceReducedMotion)
  const sectionRef = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(true)
  const [maxDpr, setMaxDpr] = useState(() => maxDprFor(window.innerWidth, window.innerHeight))
  const [dpr, setDpr] = useState(maxDpr)
  useEffect(() => {
    const onResize = () => setMaxDpr(maxDprFor(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => setDpr((d) => Math.min(d, maxDpr)), [maxDpr])

  useLayoutEffect(() => {
    chapterState.reducedMotion = reduced
  }, [reduced])

  useSmoothScroll(!reduced)
  useChapterTimeline(sectionRef, { letterCount: chapter?.titleWord.length ?? 0, reducedMotion: reduced })

  // Pointer for inertial parallax.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      chapterState.pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      chapterState.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  // Stop rendering once the chapter has scrolled off-screen.
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Line splits depend on the web fonts; re-measure once they're in.
  useEffect(() => {
    void document.fonts.ready.then(() => ScrollTrigger.refresh())
  }, [])

  useEffect(() => () => disposePlaceholders(), [])

  if (!chapter) return null

  return (
    <div>
      <section ref={sectionRef} className="relative h-screen w-full overflow-hidden bg-black">
        <Canvas
          className="!absolute inset-0"
          frameloop={visible ? 'always' : 'never'}
          dpr={dpr}
          flat
          gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
          camera={{ fov: 35, near: 0.1, far: 200, position: THRESHOLD_CAMERA.position[0] }}
        >
          {/* Scale DPR between 1 and the pixel-budget cap to hold ~60fps. No flip-flop
              fallback: load-time dips (shader compile, texture upload) used to trip it
              and pin fast devices at DPR 1. */}
          <PerformanceMonitor
            factor={1}
            bounds={(refresh) => {
              const target = Math.min(refresh, 60)
              return [target * 0.92, target * 0.99]
            }}
            onChange={({ factor }) => setDpr(Math.round((1 + (maxDpr - 1) * factor) * 20) / 20)}
            flipflops={Infinity}
          />
          <Suspense fallback={null}>
            <Threshold chapter={chapter} reducedMotion={reduced} />
          </Suspense>
          {debug.showStats && <Stats />}
        </Canvas>
        <ChapterOverlay spec={spec} chapterIndex={chapterIndex} />
      </section>
    </div>
  )
}
