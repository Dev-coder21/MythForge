import { useFrame } from '@react-three/fiber'
import {
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  Noise,
  SelectiveBloom,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing'
import { useControls } from 'leva'
import { BlendFunction, ToneMappingMode, type SelectiveBloomEffect } from 'postprocessing'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { Color, Vector2, type Light, type Object3D } from 'three'
import { chapterState } from '../store'
import { ColorGradeEffect } from './ColorGradeEffect'

interface PostStackProps {
  /** Objects that bloom (the moon disc). */
  bloomSelection: RefObject<Object3D | null>[]
  bloomLights: RefObject<Light | null>[]
  /** World point the depth of field focuses on (the title plane). */
  focusTarget: [number, number, number]
  /** Shadow tint for the grade (SceneParams.primaryColor). */
  gradeTint: string
}

/**
 * EXPERIENCE_SPEC §6: selective bloom → DOF → chromatic aberration → grain →
 * vignette → ACES filmic tone mapping → color grade. DOF defaults to the
 * per-layer version (see layerMaterial) to hold 60fps; the post pass is optional.
 */
export function PostStack({ bloomSelection, bloomLights, focusTarget, gradeTint }: PostStackProps) {
  const bloom = useControls('Post / Bloom', {
    intensity: { value: 1.6, min: 0, max: 5, step: 0.05 },
    threshold: { value: 0.35, min: 0, max: 1.5, step: 0.01 },
    smoothing: { value: 0.3, min: 0, max: 1, step: 0.01 },
    radius: { value: 0.85, min: 0, max: 1, step: 0.01 },
  })
  const dof = useControls('Post / DOF', {
    // 'layer' blurs each depth layer by mip bias (near free); 'post' is the
    // full-screen bokeh pass, which alone cost ~30fps at 1280x720 @1.75 DPR on an iGPU.
    mode: { value: 'layer', options: ['layer', 'post', 'off'] },
    layerStrength: { value: 2.2, min: 0, max: 6, step: 0.1 },
    postFocusRange: { value: 9, min: 0.5, max: 40, step: 0.5 },
    postBokehScale: { value: 1.6, min: 0, max: 6, step: 0.1 },
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
    tintOverride: { value: '', label: 'tint (blank = primary)' },
    // Behind the chapter copy the scene darkens and loses color (0 = off).
    readingDim: { value: 0.5, min: 0, max: 0.9, step: 0.01 },
    readingDesaturate: { value: 0.45, min: 0, max: 1, step: 0.01 },
  })

  const bloomRef = useRef<SelectiveBloomEffect>(null)
  const caOffset = useMemo(() => new Vector2(), [])
  caOffset.set(fx.aberration, fx.aberration)

  const gradeEffect = useMemo(() => new ColorGradeEffect(), [])
  useEffect(() => () => gradeEffect.dispose(), [gradeEffect])
  const tint = new Color(grade.tintOverride || gradeTint)
  // Normalise so the tint sets hue direction; `lift` sets strength.
  const max = Math.max(tint.r, tint.g, tint.b, 1e-4)
  gradeEffect.uniforms.get('uTint')!.value = tint.multiplyScalar(1 / max)
  gradeEffect.uniforms.get('uLift')!.value = grade.lift

  useEffect(() => {
    chapterState.focus.z = focusTarget[2]
    chapterState.focus.strength = dof.mode === 'layer' ? dof.layerStrength : 0
  }, [focusTarget, dof.mode, dof.layerStrength])

  useFrame(() => {
    const { dim, intensity } = chapterState
    // Beat 3: light intensifies.
    if (bloomRef.current) bloomRef.current.intensity = bloom.intensity * (1 + intensity * 0.6)
    gradeEffect.uniforms.get('uExposure')!.value = 1 - grade.readingDim * dim
    gradeEffect.uniforms.get('uSaturation')!.value = grade.saturation * (1 - grade.readingDesaturate * dim)
  })

  return (
    <EffectComposer multisampling={0} stencilBuffer={false}>
      <SelectiveBloom
        ref={bloomRef}
        selection={bloomSelection}
        lights={bloomLights}
        intensity={bloom.intensity}
        luminanceThreshold={bloom.threshold}
        luminanceSmoothing={bloom.smoothing}
        radius={bloom.radius}
        mipmapBlur
        resolutionScale={0.5}
      />
      {dof.mode === 'post' ? (
        <DepthOfField
          target={focusTarget}
          worldFocusRange={dof.postFocusRange}
          bokehScale={dof.postBokehScale}
          resolutionScale={0.5}
        />
      ) : (
        <></>
      )}
      <ChromaticAberration offset={caOffset} radialModulation={false} modulationOffset={0} />
      <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={fx.grain} />
      <Vignette offset={fx.vignetteOffset} darkness={fx.vignetteDarkness} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <primitive object={gradeEffect} dispose={null} />
    </EffectComposer>
  )
}
