import { PerformanceMonitor, Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useControls } from 'leva'
import { createRef, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import type { StorySpec } from '@/spec'
import { ChapterCopy, chromeRefs, StoryChrome } from './ChapterOverlay'
import { useChapterTimeline } from './camera/useChapterTimeline'
import { useSmoothScroll } from './camera/useSmoothScroll'
import { disposePlaceholders } from './layers/placeholderTextures'
import { StoryRenderer } from './StoryRenderer'
import { chapterStates, createChapterState, storyState, type ChapterState } from './store'
import { useReducedMotion } from './useReducedMotion'

const MAX_DPR = 1.75
/**
 * Device-pixel budget for the canvas. Many full-screen painted layers plus post
 * cost per pixel, so large windows start at a lower DPR (1440×900 → ~1.3) while
 * phones keep the full 1.75. PerformanceMonitor adapts further from there.
 */
const PIXEL_BUDGET = 2.2e6
const maxDprFor = (w: number, h: number) => Math.max(1, Math.min(MAX_DPR, Math.sqrt(PIXEL_BUDGET / (w * h))))

/** Scroll length of one chapter segment, in viewport heights. */
export const CHAPTER_VH = 250

interface StoryExperienceProps {
  spec: StorySpec
}

/**
 * The whole scroll story: a fixed stage (canvas + copy + chrome) over one
 * scroll spacer per chapter. Every chapter is driven by the spec; nothing here
 * knows which chapter is which.
 */
export function StoryExperience({ spec }: StoryExperienceProps) {
  const debug = useControls('Debug', { forceReducedMotion: false, showStats: false })
  const reduced = useReducedMotion(debug.forceReducedMotion)

  const states = useMemo(() => spec.chapters.map((_, i) => createChapterState(i)), [spec])
  useLayoutEffect(() => {
    chapterStates.splice(0, chapterStates.length, ...states)
  }, [states])

  const sectionRefs = useMemo(() => spec.chapters.map(() => createRef<HTMLElement>()), [spec])
  const copyRefs = useMemo(() => spec.chapters.map(() => createRef<HTMLDivElement>()), [spec])

  const [maxDpr, setMaxDpr] = useState(() => maxDprFor(window.innerWidth, window.innerHeight))
  const [dpr, setDpr] = useState(maxDpr)
  useEffect(() => {
    const onResize = () => setMaxDpr(maxDprFor(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => setDpr((d) => Math.min(d, maxDpr)), [maxDpr])

  useLayoutEffect(() => {
    storyState.reducedMotion = reduced
  }, [reduced])

  useSmoothScroll(!reduced)

  // Pointer for inertial parallax.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      storyState.pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      storyState.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  // Line splits depend on the web fonts; re-measure once they're in.
  useEffect(() => {
    void document.fonts.ready.then(() => ScrollTrigger.refresh())
  }, [])

  useEffect(() => () => disposePlaceholders(), [])

  return (
    <div className="relative">
      <div className="fixed inset-0 overflow-hidden bg-black">
        <Canvas
          className="!absolute inset-0"
          dpr={dpr}
          flat
          gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
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
          <StoryRenderer spec={spec} states={states} reducedMotion={reduced} />
          {debug.showStats && <Stats />}
        </Canvas>

        {spec.chapters.map((chapter, i) => (
          <ChapterCopy
            key={chapter.index}
            ref={(el) => {
              copyRefs[i]!.current = el
              chromeRefs.copies[i] = el
            }}
            spec={spec}
            chapter={chapter}
            isFirst={i === 0}
          />
        ))}
        <StoryChrome spec={spec} />
      </div>

      {spec.chapters.map((chapter, i) => (
        <section
          key={chapter.index}
          ref={sectionRefs[i]}
          aria-label={chapter.label}
          style={{ height: `${CHAPTER_VH}vh` }}
        />
      ))}
      {/* Room for the last chapter to reach the end of its segment. */}
      <div style={{ height: '100vh' }} />

      {spec.chapters.map((chapter, i) => (
        <ChapterTimeline
          key={chapter.index}
          index={i}
          section={sectionRefs[i]!}
          copy={copyRefs[i]!}
          state={states[i]!}
          letterCount={chapter.titleWord.length}
          reducedMotion={reduced}
        />
      ))}
    </div>
  )
}

function ChapterTimeline({
  index,
  section,
  copy,
  state,
  letterCount,
  reducedMotion,
}: {
  index: number
  section: RefObject<HTMLElement | null>
  copy: RefObject<HTMLDivElement | null>
  state: ChapterState
  letterCount: number
  reducedMotion: boolean
}) {
  useChapterTimeline(section, copy, state, { index, letterCount, reducedMotion })
  return null
}
