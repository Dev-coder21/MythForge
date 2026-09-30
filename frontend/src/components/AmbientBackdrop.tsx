import { Canvas, useFrame } from '@react-three/fiber'
import { Leva } from 'leva'
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { StoryRenderer } from '@/experience/StoryRenderer'
import { chapterStates, createChapterState, resetLetters, storyState, type ChapterState } from '@/experience/store'
import { useReducedMotion } from '@/experience/useReducedMotion'
import type { StorySpec } from '@/spec'

interface AmbientBackdropProps {
  /** Story whose chapter is shown; only that chapter is mounted. */
  spec: StorySpec
  chapter?: number
  /** 0–1 reading dim through the story grade (exposure + saturation). */
  dim?: number
  /** Seconds for one slow drift out and back along the chapter's camera path. */
  period?: number
}

/**
 * A single story chapter as a slow, dimmed backdrop: the real renderer and
 * scene template, with the camera drifting a short way along its path instead
 * of following the scroll. The 3D title stays hidden (no letters rise).
 */
export function AmbientBackdrop({ spec, chapter = 0, dim = 0.6, period = 70 }: AmbientBackdropProps) {
  const reduced = useReducedMotion(false)
  const wrap = useRef<HTMLDivElement>(null)
  const one = useMemo<StorySpec>(() => {
    const c = spec.chapters[chapter] ?? spec.chapters[0]!
    return { ...spec, chapters: [{ ...c, index: 1 }] }
  }, [spec, chapter])
  const states = useMemo(() => [createChapterState(0)], [one])

  useLayoutEffect(() => {
    chapterStates.splice(0, chapterStates.length, ...states)
    resetLetters(states[0]!, one.chapters[0]!.titleWord.length)
    storyState.reducedMotion = reduced
  }, [states, one, reduced])

  // Gentle pointer parallax, same as the story.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      storyState.pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      storyState.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  return (
    // Starts transparent and fades in once the chapter's art has loaded (no pop-in).
    <div ref={wrap} className="pointer-events-none fixed inset-0 opacity-0 transition-opacity duration-[2500ms]" aria-hidden="true">
      {/* The renderer reads leva controls; keep the panel hidden here. */}
      <Leva hidden />
      <Canvas
        className="!absolute inset-0"
        dpr={[1, 1.5]}
        flat
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      >
        <Drift state={states[0]!} dim={dim} period={period} reduced={reduced} wrap={wrap} />
        <StoryRenderer spec={one} states={states} reducedMotion={reduced} />
      </Canvas>
    </div>
  )
}

/** Moves the chapter's camera slowly between 4% and 32% of its path and holds the dim. */
function Drift({
  state,
  dim,
  period,
  reduced,
  wrap,
}: {
  state: ChapterState
  dim: number
  period: number
  reduced: boolean
  wrap: RefObject<HTMLDivElement | null>
}) {
  useFrame(({ clock }) => {
    if (state.ready && wrap.current && wrap.current.style.opacity !== '1') wrap.current.style.opacity = '1'
    const phase = (1 - Math.cos((clock.elapsedTime / period) * Math.PI * 2)) / 2
    state.progress = reduced ? 0.12 : 0.04 + 0.28 * phase
    state.dim = dim
    state.intensity = 0.25
    state.titleOut = 1
  }, -1)
  return null
}
