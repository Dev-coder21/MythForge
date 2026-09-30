import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing'
import { Fragment, Suspense, useEffect, useMemo, useState } from 'react'
import { Color, HalfFloatType, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderTarget } from 'three'
import type { StorySpec } from '@/spec'
import { chapterCaption, chromeRefs, RING_C } from './ChapterOverlay'
import { TRANSITION_START } from './camera/useChapterTimeline'
import { ColorGradeEffect } from './post/ColorGradeEffect'
import { templateFor } from './scenes/templates'
import { ChapterContext, storyState, type ChapterState } from './store'
import { TRANSITION_IDS, TransitionPass } from './transitions/TransitionPass'

interface StoryRendererProps {
  spec: StorySpec
  states: ChapterState[]
  reducedMotion: boolean
  /** Called once with a JPEG data URL of the first chapter, shortly after it is ready (gallery posters). */
  onPoster?: (dataUrl: string) => void
}

/** Frames the first chapter must have been on screen before its poster is taken (art settled, fades done). */
const POSTER_AFTER_FRAMES = 90
const POSTER_WIDTH = 1280

/** Copy the WebGL canvas right after rendering (same task, so no preserveDrawingBuffer) into a scaled JPEG. */
function capturePoster(source: HTMLCanvasElement): string {
  const w = Math.min(POSTER_WIDTH, source.width)
  const h = Math.round((source.height / source.width) * w)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(source, 0, 0, w, h)
  return c.toDataURL('image/jpeg', 0.82)
}

const pad = (n: number) => String(n).padStart(2, '0')
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Owns rendering for the whole story:
 * - one Scene + camera per chapter, mounted through R3F portals; only the
 *   chapter on screen, the next one (preloading) and, while near a segment
 *   start, the previous one are mounted, so art is loaded ahead and released behind
 * - each frame renders the active chapter (and, during a transition, the next)
 *   into half-float targets, composites them with the chapter's transition
 *   shader, then runs one post chain: bloom on HDR highlights (moon, lanterns,
 *   fireflies), grain, vignette, ACES filmic, and a grade blended between chapters
 * - drives the DOM chrome and gates each chapter's copy, without React renders
 */
export function StoryRenderer({ spec, states, reducedMotion, onPoster }: StoryRendererProps) {
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const n = spec.chapters.length
  // Dev-only: lets npm run fps read GPU memory stats.
  if (import.meta.env.DEV) (window as { __gl?: unknown }).__gl = gl

  const bloomCtl = useControls('Post / Bloom', {
    intensity: { value: 1.3, min: 0, max: 5, step: 0.05 },
    threshold: { value: 0.9, min: 0, max: 2, step: 0.01 },
    smoothing: { value: 0.35, min: 0, max: 1, step: 0.01 },
    radius: { value: 0.8, min: 0, max: 1, step: 0.01 },
  })
  const dofCtl = useControls('Post / DOF', {
    layerStrength: { value: 2.2, min: 0, max: 6, step: 0.1 },
    // Layers in front of the title get this fraction of the blur, so grass reads as a silhouette.
    frontBlur: { value: 0.2, min: 0, max: 1, step: 0.01 },
  })
  const fx = useControls('Post / Grain + Lens', {
    grain: { value: 0.06, min: 0, max: 0.3, step: 0.005 },
    vignetteOffset: { value: 0.2, min: 0, max: 1, step: 0.01 },
    vignetteDarkness: { value: 0.95, min: 0, max: 1.5, step: 0.01 },
    aberration: { value: 0.0006, min: 0, max: 0.005, step: 0.0001 },
  })
  const grade = useControls('Post / Grade', {
    lift: { value: 0.018, min: 0, max: 0.2, step: 0.002 },
    saturation: { value: 0.95, min: 0, max: 1.5, step: 0.01 },
    readingDim: { value: 0.5, min: 0, max: 0.9, step: 0.01 },
    readingDesaturate: { value: 0.45, min: 0, max: 1, step: 0.01 },
  })
  const trans = useControls('Transitions', {
    edgeGlow: { value: 0.6, min: 0, max: 3, step: 0.05 },
    override: { value: 'spec', options: ['spec', 'noise-dissolve', 'ink-wipe', 'bloom-out', 'crossfade'] },
  })

  useEffect(() => {
    storyState.dof.strength = dofCtl.layerStrength
    storyState.dof.front = dofCtl.frontBlur
  }, [dofCtl.layerStrength, dofCtl.frontBlur])

  // --- per-chapter scenes and cameras -------------------------------------------
  const scenes = useMemo(() => Array.from({ length: n }, () => new Scene()), [n])
  const cameras = useMemo(() => Array.from({ length: n }, () => new PerspectiveCamera(35, 1, 0.1, 200)), [n])
  useEffect(() => {
    for (const c of cameras) {
      c.aspect = size.width / size.height
      c.updateProjectionMatrix()
    }
  }, [cameras, size.width, size.height])

  // --- render targets + post chain ---------------------------------------------
  const targets = useMemo(
    () =>
      [0, 1].map(
        () => new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true, stencilBuffer: false }),
      ) as [WebGLRenderTarget, WebGLRenderTarget],
    [],
  )
  const { composer, transition, bloom, noise, vignette, gradeEffect } = useMemo(() => {
    const composer = new EffectComposer(gl, { frameBufferType: HalfFloatType, multisampling: 0 })
    const transition = new TransitionPass()
    transition.inputs = targets
    const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.9, luminanceSmoothing: 0.35, intensity: 1.3, radius: 0.8, resolutionScale: 0.5 })
    const noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN })
    const vignette = new VignetteEffect({ offset: 0.2, darkness: 0.95 })
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
    const gradeEffect = new ColorGradeEffect()
    composer.addPass(transition)
    composer.addPass(new EffectPass(cameras[0], bloom, noise, vignette, tone, gradeEffect))
    return { composer, transition, bloom, noise, vignette, gradeEffect }
  }, [gl, targets, cameras])
  useEffect(
    () => () => {
      composer.dispose()
      targets.forEach((t) => t.dispose())
    },
    [composer, targets],
  )

  const buf = useMemo(() => new Vector2(), [])
  useEffect(() => {
    composer.setSize(size.width, size.height)
  }, [composer, size.width, size.height])

  // Live post settings.
  bloom.intensity = bloomCtl.intensity
  bloom.luminanceMaterial.threshold = bloomCtl.threshold
  bloom.luminanceMaterial.smoothing = bloomCtl.smoothing
  bloom.mipmapBlurPass.radius = bloomCtl.radius
  noise.blendMode.opacity.value = fx.grain
  vignette.offset = fx.vignetteOffset
  vignette.darkness = fx.vignetteDarkness
  transition.material.uniforms.uCA!.value = fx.aberration
  transition.material.uniforms.uEdge!.value = trans.edgeGlow
  gradeEffect.uniforms.get('uLift')!.value = grade.lift

  // --- which chapters are mounted ------------------------------------------------
  const [active, setActive] = useState(0)
  const [nearStart, setNearStart] = useState(true)
  const mounted = useMemo(() => {
    const m = new Set([active])
    if (active + 1 < n) m.add(active + 1) // preload the next chapter's art
    if (active > 0 && nearStart) m.add(active - 1) // keep the previous one while scrolling back is likely
    return m
  }, [active, nearStart, n])

  // Compile each chapter's shaders once it has loaded, before it is ever shown.
  const compiled = useMemo(() => new Set<number>(), [])

  const poster = useMemo(() => ({ frames: 0, done: false }), [])

  const tintA = useMemo(() => new Color(), [])
  const tintB = useMemo(() => new Color(), [])
  const accent = useMemo(() => new Color(), [])

  useFrame((state, dt) => {
    // Active chapter = first one not finished; its last 15% hands over to the next.
    let a = states.findIndex((s) => s.progress < 1)
    if (a < 0) a = n - 1
    const A = states[a]!
    const B = states[a + 1]
    let t = B ? smooth(TRANSITION_START, 1, A.progress) : 0
    if (t > 0 && (!B!.ready || !compiled.has(a + 1))) t = 0 // never show a chapter that isn't ready
    storyState.active = a
    storyState.transition = t
    if (a !== active) setActive(a)
    const ns = A.progress < 0.15
    if (ns !== nearStart) setNearStart(ns)

    for (const i of mounted) {
      const s = states[i]!
      if (s.ready && !compiled.has(i)) {
        gl.compile(scenes[i]!, cameras[i]!)
        compiled.add(i)
      }
    }

    gl.getDrawingBufferSize(buf)
    for (const rt of targets) if (rt.width !== buf.x || rt.height !== buf.y) rt.setSize(buf.x, buf.y)

    gl.setRenderTarget(targets[0])
    gl.clear()
    gl.render(scenes[a]!, cameras[a]!)
    if (t > 0) {
      gl.setRenderTarget(targets[1])
      gl.clear()
      gl.render(scenes[a + 1]!, cameras[a + 1]!)
    }
    gl.setRenderTarget(null)

    const chapterA = spec.chapters[a]!
    const u = transition.material.uniforms
    u.uT!.value = t
    const type = reducedMotion ? 'crossfade' : trans.override === 'spec' ? chapterA.transition : trans.override
    u.uType!.value = TRANSITION_IDS[type as keyof typeof TRANSITION_IDS] ?? 0
    // The flash/edge takes the incoming chapter's accent so the new scene "arrives" in its own colour.
    accent.set(spec.chapters[a + 1]?.sceneParams.accentColor ?? chapterA.sceneParams.accentColor)
    ;(u.uAccent!.value as Color).copy(accent)
    u.uTime!.value = state.clock.elapsedTime
    const heatA = A.heat
    const heatB = B?.heat ?? A.heat
    const heatK = storyState.reducedMotion ? 0.3 : 1
    ;(u.uHeatA!.value as Vector3).set(heatA.v, heatA.h, heatA.strength * heatK)
    ;(u.uHeatB!.value as Vector3).set(heatB.v, heatB.h, heatB.strength * heatK)

    // Grade: blend tint and reading dim between the two chapters.
    tintA.set(A.gradeTint)
    tintB.set(B?.gradeTint ?? A.gradeTint)
    const tint = tintA.lerp(tintB, t)
    const max = Math.max(tint.r, tint.g, tint.b, 1e-4)
    gradeEffect.uniforms.get('uTint')!.value.copy(tint).multiplyScalar(1 / max)
    const dim = A.dim * (1 - t) + (B?.dim ?? 0) * t
    gradeEffect.uniforms.get('uExposure')!.value = 1 - grade.readingDim * dim
    gradeEffect.uniforms.get('uSaturation')!.value = grade.saturation * (1 - grade.readingDesaturate * dim)
    const intensity = A.intensity * (1 - t) + (B?.intensity ?? 0) * t
    bloom.intensity = bloomCtl.intensity * (1 + intensity * 0.5)

    composer.render(dt)

    if (onPoster && !poster.done) {
      poster.frames = a === 0 && t === 0 && A.ready && compiled.has(0) && A.progress < 0.2 ? poster.frames + 1 : 0
      if (poster.frames >= POSTER_AFTER_FRAMES) {
        poster.done = true
        onPoster(capturePoster(gl.domElement))
      }
    }

    // --- DOM: chrome + copy gating ---------------------------------------------------
    const shown = t > 0.5 ? a + 1 : a
    const shownState = states[shown]!
    const r = chromeRefs
    if (r.number) {
      const label = pad(spec.chapters[shown]!.index)
      if (r.number.textContent !== label) r.number.textContent = label
    }
    if (r.ring) {
      r.ring.setAttribute('stroke-dashoffset', String(RING_C * (1 - shownState.progress)))
      r.ring.setAttribute('stroke', spec.chapters[shown]!.sceneParams.accentColor)
    }
    if (r.caption) {
      const cap = chapterCaption(spec, spec.chapters[shown]!)
      if (r.caption.textContent !== cap) r.caption.textContent = cap
    }
    r.fills.forEach((el, i) => {
      if (el) el.style.transform = `scaleX(${states[i]!.progress})`
    })
    r.copies.forEach((el, i) => {
      if (!el) return
      const o = i === a ? 1 - smooth(0, 0.35, t) : i === a + 1 ? smooth(0.6, 1, t) : 0
      const vis = o > 0.001 ? 'visible' : 'hidden'
      if (el.style.visibility !== vis) el.style.visibility = vis
      el.style.opacity = String(o)
    })
  }, 1)

  return (
    <>
      {spec.chapters.map((chapter, i) =>
        mounted.has(i) ? (
          <Fragment key={chapter.index}>
            {createPortal(
              <ChapterContext.Provider value={states[i]!}>
                <Suspense fallback={null}>
                  <ChapterScene chapter={chapter} index={i} reducedMotion={reducedMotion} />
                </Suspense>
              </ChapterContext.Provider>,
              scenes[i]!,
              { camera: cameras[i]! },
            )}
          </Fragment>
        ) : null,
      )}
    </>
  )
}

/** The chapter's scene template, chosen by the spec's sceneTemplate. */
function ChapterScene(props: { chapter: StorySpec['chapters'][number]; index: number; reducedMotion: boolean }) {
  const Template = templateFor(props.chapter.sceneTemplate)
  return <Template {...props} />
}
