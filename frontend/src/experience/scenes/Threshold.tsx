import { useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { Mesh, PerspectiveCamera, Texture } from 'three'
import type { Chapter } from '@/spec'
import { CameraRig } from '../camera/CameraRig'
import { buildPaths, makeRectAt, type Rect, type Vec3Tuple } from '../camera/paths'
import { FogLayer } from '../layers/FogLayer'
import { KitParticles } from '../layers/KitParticles'
import { LightShafts } from '../layers/LightShafts'
import { MoonLayer } from '../layers/MoonLayer'
import { Particles } from '../layers/Particles'
import { PARTICLE_PRESETS } from '../layers/particlePresets'
import { SkyLayer } from '../layers/SkyLayer'
import { TitleLayer } from '../layers/TitleLayer'
import { useChapter } from '../store'
import type { Kit } from './kit'
import { KitLayers, useKit, useKitGlowRefs, useKitTextures } from './KitLayers'
import { THRESHOLD_CAMERA, THRESHOLD_LAYOUT as L, thresholdPalette } from './threshold.defaults'

export interface TemplateProps {
  chapter: Chapter
  /** Position in the story; namespaces this chapter's leva folders. */
  index: number
  reducedMotion: boolean
}

/** What a template's extra effects need from the shared layered scene. */
export interface SceneContext {
  kit: Kit
  textures: Record<string, Texture>
  rectAt: (z: number) => Rect
  portrait: boolean
  colors: { skyTop: string; skyMid: string; skyHorizon: string; fog: string; moon: string; kitRim: string }
  /** Sun/moon position in the opening frame (0–1 from left / bottom). */
  celestialUV: [number, number]
  reducedMotion: boolean
  ns: (folder: string) => string
}

interface LayeredSceneProps extends TemplateProps {
  /** Template-specific effects (heat shimmer, river water...) rendered into the same scene. */
  extras?: (ctx: SceneContext) => ReactNode
}

const v3 = (value: Vec3Tuple) => ({ value, step: 0.1 })
const zRange = (value: number) => ({ value, min: -80, max: 10, step: 0.5 })
const frac = (value: number, min = -0.5, max = 1.5) => ({ value, min, max, step: 0.01 })

/**
 * The shared layered scene every template builds on: the EXPERIENCE_SPEC §3
 * layer stack at real Z depths.
 * Sky, moon, fog, title and particles are procedural; every painted element
 * comes from the art kit named by `sceneParams.artKit` (kit.json + webp), so
 * all variation comes from the spec and the kit, never from topic code.
 */
export function LayeredScene({ chapter, index, reducedMotion, extras }: LayeredSceneProps) {
  const params = chapter.sceneParams
  const state = useChapter()
  const ns = (folder: string) => `Ch${index + 1} / ${folder}`
  const palette = useMemo(() => thresholdPalette(params), [params])
  const kit = useKit(chapter.sceneTemplate, params.artKit)
  const kitTextures = useKitTextures(chapter.sceneTemplate, params.artKit, kit)
  const glowRefs = useKitGlowRefs(kit)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const aspect = useThree((s) => s.size.width / s.size.height)

  // --- leva -----------------------------------------------------------------
  // Camera move, sun/moon and title placement come from the kit (defaults = the original Threshold framing).
  const kc = kit.camera ?? { ...THRESHOLD_CAMERA, fov: 35 }
  const cel = { ...L.moon, ...kit.celestial }
  const kt = { ...L.title, ...kit.title }
  const vertical = chapter.titleLayout === 'vertical'
  const cam = useControls(ns('Camera'), {
    fov: { value: kc.fov ?? 35, min: 20, max: 70, step: 1 },
    p0: v3(kc.position[0]!),
    p1: v3(kc.position[1]!),
    p2: v3(kc.position[2]!),
    p3: v3(kc.position[3]!),
    look0: v3(kc.lookAt[0]!),
    look1: v3(kc.lookAt[1]!),
    look2: v3(kc.lookAt[2]!),
    look3: v3(kc.lookAt[3]!),
    parallax: { value: 0.3, min: 0, max: 1, step: 0.01 },
    parallaxDamping: { value: 2.5, min: 0.5, max: 10, step: 0.1 },
    reducedPoseT: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'reduced-motion pose' },
  })
  const layers = useControls(ns('Layers'), {
    skyZ: zRange(L.sky.z),
    moonZ: zRange(L.moon.z),
    fogZ: zRange(L.fog.z),
    titleZ: zRange(L.title.z),
    stars: frac(L.sky.stars, 0, 3),
    skyMidPosition: frac(L.sky.midPosition, 0.05, 0.95),
  })
  const colors = useControls(ns('Colors'), {
    skyTop: palette.skyTop,
    skyMid: palette.skyMid,
    skyHorizon: palette.skyHorizon,
    fog: palette.fog,
    kitTint: palette.kitTint,
    kitRim: palette.kitRim,
    moon: palette.moon,
    title: palette.title,
    titleGlow: palette.titleGlow,
  })
  // Fog layers, shafts and falling petals are authored per kit; these scale them live.
  const fog = useControls(ns('Fog'), {
    opacity: frac(1, 0, 3),
    speed: frac(1, 0, 4),
  })
  const shafts = useControls(ns('Shafts'), {
    opacity: frac(1, 0, 3),
    angle: { value: kit.shafts?.angle ?? -1.95, min: -3.1, max: 0, step: 0.01 },
    z: zRange(-13.5),
  })
  const petals = useControls(ns('Petals'), {
    count: frac(1, 0, 3),
    opacity: frac(1, 0, 2),
    tint: '#f2e6ef',
  })
  const moon = useControls(ns(params.backgroundObject === 'sun' ? 'Sun' : 'Moon'), {
    u: frac(cel.u, 0, 1),
    v: frac(cel.v, 0, 1),
    uPortrait: frac(cel.uPortrait, 0, 1),
    vPortrait: frac(cel.vPortrait, 0, 1),
    size: { value: cel.size, min: 0.01, max: 0.3, step: 0.005 },
    driftU: frac(cel.driftU, -0.5, 0.5),
    driftV: frac(cel.driftV, -0.5, 0.5),
    intensity: { value: cel.intensity, min: 0.5, max: 8, step: 0.1 },
    glow: frac(0.35, 0, 1.5),
    halo: frac(cel.halo, 0, 1),
    haloRadius: { value: L.moon.haloRadius, min: 1.2, max: 5, step: 0.05 },
  })
  const title = useControls(ns('Title'), {
    v: frac(kt.v, 0, 1),
    vPortrait: frac(kt.vPortrait, 0, 1),
    x: frac(kit.title?.x ?? -0.3, -0.5, 0.5),
    xPortrait: frac(kit.title?.xPortrait ?? kit.title?.x ?? -0.3, -0.5, 0.5),
    stackHeight: frac(kit.title?.height ?? 0.6, 0.1, 1.2),
    fontSize: { value: L.title.fontSize, min: 1, max: 12, step: 0.1 },
    letterSpacing: { value: L.title.letterSpacing, min: -0.1, max: 0.8, step: 0.005 },
    letterSpacingPortrait: { value: L.title.letterSpacingPortrait, min: -0.1, max: 0.8, step: 0.005 },
    fitWidth: frac(L.title.fitWidth, 0.3, 1.6),
    fitWidthPortrait: frac(L.title.fitWidthPortrait, 0.3, 1.2),
    leftMargin: frac(L.title.leftMargin, -0.2, 0.5),
    riseDistance: frac(L.title.riseDistance, 0, 2),
    driftBack: { value: L.title.driftBack, min: 0, max: 10, step: 0.1 },
    glowOpacity: frac(0, 0, 1),
  })
  // Global multipliers over the kit's authored per-layer values (kit.json).
  const kitLook = useControls(ns('Kit'), {
    wind: { value: 0.35, min: 0, max: 2, step: 0.01 },
    rim: frac(1.35, 0, 3),
    lightGain: frac(1, 0, 3),
    fogBoost: frac(0, -1, 2),
  })
  const preset = params.particleType === 'none' ? null : PARTICLE_PRESETS[params.particleType]
  const particles = useControls(ns('Particles'), {
    count: { value: Math.round(300 + 300 * (params.particleDensity ?? 0.5)), min: 0, max: 1000, step: 10 },
    baseDensity: frac(0.55, 0, 1),
    color: preset?.color ?? '#ffffff',
    size: { value: preset?.size ?? 0.08, min: 0.01, max: 0.5, step: 0.005 },
    speed: { value: preset?.speed ?? 0.5, min: 0, max: 3, step: 0.05 },
    opacity: frac(0.9, 0, 2),
  })

  // --- camera + framing ---------------------------------------------------------
  useEffect(() => {
    camera.fov = cam.fov
    camera.updateProjectionMatrix()
  }, [camera, cam.fov])

  // Sideways travel/yaw is authored for a wide frame; on narrow screens the same
  // world offset is a much larger share of the view, so scale x by aspect.
  const portrait = aspect < 1
  const lateral = Math.min(1, Math.max(0.25, aspect / 1.6))
  const paths = useMemo(() => {
    const sx = (p: Vec3Tuple): Vec3Tuple => [p[0] * lateral, p[1], p[2]]
    return buildPaths(
      ([cam.p0, cam.p1, cam.p2, cam.p3] as Vec3Tuple[]).map(sx),
      ([cam.look0, cam.look1, cam.look2, cam.look3] as Vec3Tuple[]).map(sx),
    )
  }, [cam.p0, cam.p1, cam.p2, cam.p3, cam.look0, cam.look1, cam.look2, cam.look3, lateral])
  // Widest pose (chapter start) sizes the layers. The title is fitted at the
  // pose where it starts fading (60%), the closest the camera gets while the
  // word must still read in full.
  const rectAt = useMemo(() => makeRectAt(paths, 0, cam.fov, aspect), [paths, cam.fov, aspect])
  const fitRectAt = useMemo(() => makeRectAt(paths, 0.6, cam.fov, aspect), [paths, cam.fov, aspect])

  const titleRect = rectAt(layers.titleZ)
  const titleX = vertical
    ? (titleRect.minX + titleRect.maxX) / 2 + titleRect.w * (portrait ? title.xPortrait : title.x)
    : (titleRect.minX + titleRect.maxX) / 2
  const titleY = titleRect.minY + titleRect.h * (portrait ? title.vPortrait : title.v)
  // Landscape: the word starts at a left margin and runs off the right edge.
  const titleLeft = portrait || vertical ? undefined : titleRect.minX + titleRect.w * title.leftMargin
  // Landscape: the word spans fitWidth × the opening frame (> 1 = runs off the
  // right edge from the first frame). Portrait: shrink-to-fit at the closest pose.
  const titleFit = vertical
    ? titleRect.h * title.stackHeight
    : portrait
      ? fitRectAt(layers.titleZ).w * title.fitWidthPortrait
      : titleRect.w * title.fitWidth
  const particleRect = rectAt(-8)
  const moonU = portrait ? moon.uPortrait : moon.u
  const moonV = portrait ? moon.vPortrait : moon.v
  const moonAt = (z: number): [number, number, number] => {
    const r = rectAt(z)
    return [r.minX + r.w * moonU, r.minY + r.h * moonV, z]
  }

  const moonDisc = useRef<Mesh>(null)
  const reduced = reducedMotion
  const celestial = params.backgroundObject === 'moon' || params.backgroundObject === 'sun'

  // Report what the story renderer needs (focus plane, grade tint) and that the scene is ready.
  useLayoutEffect(() => {
    state.focusZ = layers.titleZ
    state.gradeTint = params.primaryColor
  }, [state, layers.titleZ, params.primaryColor])
  useEffect(() => {
    state.ready = true
    return () => {
      state.ready = false
    }
  }, [state])

  return (
    <>
      <CameraRig
        paths={paths}
        parallax={cam.parallax}
        parallaxDamping={cam.parallaxDamping}
        reducedPoseT={cam.reducedPoseT}
      />

      <SkyLayer
        z={layers.skyZ}
        rect={rectAt(layers.skyZ)}
        top={colors.skyTop}
        mid={colors.skyMid}
        horizon={colors.skyHorizon}
        midPosition={layers.skyMidPosition}
        stars={
          params.backgroundObject === 'stars' || params.timeOfDay === 'night'
            ? layers.stars * (params.timeOfDay === 'dawn' ? 0.45 : 1)
            : 0
        }
      />

      {celestial && (
        <MoonLayer
          surface={params.backgroundObject === 'sun' ? 'sun' : 'moon'}
          z={layers.moonZ}
          rect={rectAt(layers.moonZ)}
          u={moonU}
          v={moonV}
          size={moon.size}
          driftU={reduced ? 0 : moon.driftU}
          driftV={reduced ? 0 : moon.driftV}
          color={colors.moon}
          intensity={moon.intensity}
          glowOpacity={moon.glow}
          haloOpacity={moon.halo}
          haloRadius={moon.haloRadius}
          discRef={moonDisc}
        />
      )}

      <KitLayers
        kit={kit}
        textures={kitTextures}
        rectAt={rectAt}
        portrait={portrait}
        glowRefs={glowRefs}
        look={{
          tint: colors.kitTint,
          fogColor: colors.fog,
          rimColor: colors.kitRim,
          rim: kitLook.rim,
          wind: reduced ? kitLook.wind * 0.3 : kitLook.wind,
          lightGain: kitLook.lightGain,
          fogBoost: kitLook.fogBoost,
          skyTop: colors.skyTop,
          skyMid: colors.skyMid,
          skyHorizon: colors.skyHorizon,
          sun: colors.moon,
        }}
      />

      {(kit.fog ?? [{ z: layers.fogZ, opacity: L.fog.opacity, speed: L.fog.speed, height: L.fog.height, scale: L.fog.scale }]).map(
        (f, i) => (
          <FogLayer
            key={i}
            z={f.z}
            rect={rectAt(f.z)}
            color={colors.fog}
            opacity={f.opacity * fog.opacity}
            speed={f.speed * fog.speed * (reduced ? 0.4 : 1)}
            height={f.height}
            scale={f.scale}
          />
        ),
      )}

      {kit.shafts && celestial && (
        <LightShafts
          origin={moonAt(shafts.z)}
          angle={shafts.angle}
          count={kit.shafts.count}
          length={rectAt(shafts.z).h * kit.shafts.length}
          spread={kit.shafts.spread}
          width={rectAt(shafts.z).h * 0.22}
          color={colors.kitRim}
          opacity={kit.shafts.opacity * shafts.opacity}
        />
      )}

      {kit.particles?.map((p, i) => {
        const texture = kitTextures[p.texture]
        if (!texture) return null
        const r = rectAt((p.zMin + p.zMax) / 2)
        return (
          <KitParticles
            key={i}
            texture={texture}
            cells={p.cells}
            count={Math.round(p.count * petals.count * (portrait ? 0.6 : 1))}
            min={[r.minX * 1.2, r.minY, p.zMin]}
            max={[r.maxX * 1.2, r.maxY * 1.1, p.zMax]}
            size={p.size}
            speed={p.speed}
            fall={p.fall}
            opacity={p.opacity * petals.opacity}
            tint={petals.tint}
          />
        )
      })}


      <TitleLayer
        word={chapter.titleWord}
        z={layers.titleZ}
        x={titleX}
        left={titleLeft}
        baseY={titleY}
        fontSize={title.fontSize}
        letterSpacing={portrait ? title.letterSpacingPortrait : title.letterSpacing}
        maxWidth={titleFit}
        fill={!portrait && !vertical}
        vertical={vertical}
        maxLetterHeight={titleRect.h * 0.4}
        color={colors.title}
        glowColor={colors.titleGlow}
        glowOpacity={title.glowOpacity}
        riseDistance={title.riseDistance}
        driftBack={reduced ? 0 : title.driftBack}
      />


      <Particles
        type={params.particleType}
        count={particles.count}
        min={[particleRect.minX * 1.1, particleRect.minY, L.particles.zMin]}
        max={[particleRect.maxX * 1.1, particleRect.maxY, L.particles.zMax]}
        baseDensity={particles.baseDensity}
        color={particles.color}
        size={particles.size}
        speed={reduced ? particles.speed * 0.4 : particles.speed}
        opacity={particles.opacity}
      />


      {extras?.({
        kit,
        textures: kitTextures,
        rectAt,
        portrait,
        colors: {
          skyTop: colors.skyTop,
          skyMid: colors.skyMid,
          skyHorizon: colors.skyHorizon,
          fog: colors.fog,
          moon: colors.moon,
          kitRim: colors.kitRim,
        },
        celestialUV: [moonU, moonV],
        reducedMotion: reduced,
        ns,
      })}
    </>
  )
}

/** Threshold: the layered scene with no extra effects (gates, gardens, approaches). */
export function Threshold(props: TemplateProps) {
  return <LayeredScene {...props} />
}
