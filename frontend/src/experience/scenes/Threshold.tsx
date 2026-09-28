import { useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import { useEffect, useMemo, useRef } from 'react'
import type { AmbientLight, Mesh, PerspectiveCamera } from 'three'
import type { Chapter } from '@/spec'
import { CameraRig } from '../camera/CameraRig'
import { buildPaths, makeRectAt, type Vec3Tuple } from '../camera/paths'
import { FogLayer } from '../layers/FogLayer'
import { KitParticles } from '../layers/KitParticles'
import { LightShafts } from '../layers/LightShafts'
import { MoonLayer } from '../layers/MoonLayer'
import { Particles } from '../layers/Particles'
import { PARTICLE_PRESETS } from '../layers/particlePresets'
import { SkyLayer } from '../layers/SkyLayer'
import { TitleLayer } from '../layers/TitleLayer'
import { PostStack } from '../post/PostStack'
import { KitLayers, useKit, useKitGlowRefs, useKitTextures } from './KitLayers'
import { THRESHOLD_CAMERA, THRESHOLD_LAYOUT as L, thresholdPalette } from './threshold.defaults'

interface ThresholdProps {
  chapter: Chapter
  reducedMotion: boolean
}

const v3 = (value: Vec3Tuple) => ({ value, step: 0.1 })
const zRange = (value: number) => ({ value, min: -80, max: 10, step: 0.5 })
const frac = (value: number, min = -0.5, max = 1.5) => ({ value, min, max, step: 0.01 })

/**
 * Threshold template: the EXPERIENCE_SPEC §3 layer stack at real Z depths.
 * Sky, moon, fog, title and particles are procedural; every painted element
 * comes from the art kit named by `sceneParams.artKit` (kit.json + webp), so
 * all variation comes from the spec and the kit, never from topic code.
 */
export function Threshold({ chapter, reducedMotion }: ThresholdProps) {
  const params = chapter.sceneParams
  const palette = useMemo(() => thresholdPalette(params), [params])
  const kit = useKit(chapter.sceneTemplate, params.artKit)
  const kitTextures = useKitTextures(chapter.sceneTemplate, params.artKit, kit)
  const glowRefs = useKitGlowRefs(kit)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const aspect = useThree((s) => s.size.width / s.size.height)

  // --- leva -----------------------------------------------------------------
  const cam = useControls('Camera', {
    fov: { value: 35, min: 20, max: 70, step: 1 },
    p0: v3(THRESHOLD_CAMERA.position[0]!),
    p1: v3(THRESHOLD_CAMERA.position[1]!),
    p2: v3(THRESHOLD_CAMERA.position[2]!),
    p3: v3(THRESHOLD_CAMERA.position[3]!),
    look0: v3(THRESHOLD_CAMERA.lookAt[0]!),
    look1: v3(THRESHOLD_CAMERA.lookAt[1]!),
    look2: v3(THRESHOLD_CAMERA.lookAt[2]!),
    look3: v3(THRESHOLD_CAMERA.lookAt[3]!),
    parallax: { value: 0.3, min: 0, max: 1, step: 0.01 },
    parallaxDamping: { value: 2.5, min: 0.5, max: 10, step: 0.1 },
    reducedPoseT: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'reduced-motion pose' },
  })
  const layers = useControls('Layers', {
    skyZ: zRange(L.sky.z),
    moonZ: zRange(L.moon.z),
    fogZ: zRange(L.fog.z),
    titleZ: zRange(L.title.z),
    stars: frac(L.sky.stars, 0, 3),
    skyMidPosition: frac(L.sky.midPosition, 0.05, 0.95),
  })
  const colors = useControls('Colors', {
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
  const fog = useControls('Fog', {
    opacity: frac(1, 0, 3),
    speed: frac(1, 0, 4),
  })
  const shafts = useControls('Shafts', {
    opacity: frac(1, 0, 3),
    angle: { value: -1.95, min: -3.1, max: 0, step: 0.01 },
    z: zRange(-13.5),
  })
  const petals = useControls('Petals', {
    count: frac(1, 0, 3),
    opacity: frac(1, 0, 2),
    tint: '#f2e6ef',
  })
  const moon = useControls('Moon', {
    u: frac(L.moon.u, 0, 1),
    v: frac(L.moon.v, 0, 1),
    uPortrait: frac(L.moon.uPortrait, 0, 1),
    vPortrait: frac(L.moon.vPortrait, 0, 1),
    size: { value: L.moon.size, min: 0.01, max: 0.3, step: 0.005 },
    driftU: frac(L.moon.driftU, -0.5, 0.5),
    driftV: frac(L.moon.driftV, -0.5, 0.5),
    intensity: { value: L.moon.intensity, min: 0.5, max: 8, step: 0.1 },
    glow: frac(0.35, 0, 1.5),
    halo: frac(L.moon.halo, 0, 1),
    haloRadius: { value: L.moon.haloRadius, min: 1.2, max: 5, step: 0.05 },
  })
  const title = useControls('Title', {
    v: frac(L.title.v, 0, 1),
    vPortrait: frac(L.title.vPortrait, 0, 1),
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
  const kitLook = useControls('Kit', {
    wind: { value: 0.35, min: 0, max: 2, step: 0.01 },
    rim: frac(1.35, 0, 3),
    lightGain: frac(1, 0, 3),
    fogBoost: frac(0, -1, 2),
  })
  const preset = params.particleType === 'none' ? null : PARTICLE_PRESETS[params.particleType]
  const particles = useControls('Particles', {
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
  const titleX = (titleRect.minX + titleRect.maxX) / 2
  const titleY = titleRect.minY + titleRect.h * (portrait ? title.vPortrait : title.v)
  // Landscape: the word starts at a left margin and runs off the right edge.
  const titleLeft = portrait ? undefined : titleRect.minX + titleRect.w * title.leftMargin
  // Landscape: the word spans fitWidth × the opening frame (> 1 = runs off the
  // right edge from the first frame). Portrait: shrink-to-fit at the closest pose.
  const titleFit = portrait
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
  const light = useRef<AmbientLight>(null)
  // Moon disc + lantern glows bloom; everything else stays crisp.
  const bloomSelection = useMemo(() => [moonDisc, ...Object.values(glowRefs)], [glowRefs])
  const bloomLights = useMemo(() => [light], [])
  const reduced = reducedMotion

  return (
    <>
      <ambientLight ref={light} intensity={0} />
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
        stars={params.backgroundObject === 'stars' || params.timeOfDay === 'night' ? layers.stars : 0}
      />

      {params.backgroundObject === 'moon' && (
        <MoonLayer
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

      {kit.shafts && params.backgroundObject === 'moon' && (
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
        fill={!portrait}
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


      <PostStack
        bloomSelection={bloomSelection}
        bloomLights={bloomLights}
        focusTarget={[titleX, titleY + title.fontSize * 0.35, layers.titleZ]}
        gradeTint={params.primaryColor}
      />
    </>
  )
}
