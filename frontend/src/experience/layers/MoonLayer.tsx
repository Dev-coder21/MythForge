import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { AdditiveBlending, Color, Group, Mesh, MeshBasicMaterial, ShaderMaterial } from 'three'
import type { Rect } from '../camera/paths'
import { useChapter } from '../store'
import { NOISE_GLSL } from './glsl'
import { getPlaceholder } from './placeholderTextures'

interface MoonLayerProps {
  /** 'moon' has maria and a crisp limb; 'sun' is a smooth, soft-edged disc. */
  surface?: 'moon' | 'sun'
  z: number
  rect: Rect
  /** Position within the visible rect, 0–1. */
  u: number
  v: number
  /** Radius as a fraction of the visible rect's short side. */
  size: number
  /** Drift across the whole chapter, in fractions of the visible rect. */
  driftU: number
  driftV: number
  color: string
  /** HDR multiplier on the disc (drives bloom). */
  intensity: number
  glowOpacity: number
  haloOpacity: number
  /** Halo ring radius, in moon radii. */
  haloRadius: number
  /** Only the disc is passed to SelectiveBloom. */
  discRef: RefObject<Mesh | null>
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Emissive moon disc + faint halo ring + soft glow, drifting slowly across the chapter. */
export function MoonLayer({
  z,
  rect,
  u,
  v,
  size,
  driftU,
  driftV,
  color,
  intensity,
  glowOpacity,
  haloOpacity,
  haloRadius,
  discRef,
  surface = 'moon',
}: MoonLayerProps) {
  const chapter = useChapter()
  const group = useRef<Group>(null)

  const discMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color() }, uIntensity: { value: 2 }, uMaria: { value: 1 }, uSoft: { value: 0.03 } },
        vertexShader: VERT,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uIntensity;
          uniform float uMaria;
          uniform float uSoft;
          varying vec2 vUv;
          ${NOISE_GLSL}
          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            float r = length(p);
            if (r > 1.0) discard;
            float maria = fbm(p * 2.3 + 3.0);
            float limb = mix(0.78, 1.0, sqrt(1.0 - r * r));
            float shade = mix(1.0, 0.82 + 0.18 * smoothstep(0.35, 0.7, maria), uMaria) * limb;
            float edge = smoothstep(1.0, 1.0 - uSoft, r);
            gl_FragColor = vec4(uColor * shade * uIntensity, edge);
          }
        `,
        transparent: true,
        depthWrite: false,
      }),
    [],
  )

  const haloMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color() }, uOpacity: { value: 0.1 }, uRadius: { value: 0.7 } },
        vertexShader: VERT,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uRadius;
          varying vec2 vUv;
          void main() {
            float r = length(vUv * 2.0 - 1.0);
            float ring = exp(-pow((r - uRadius) / 0.035, 2.0));
            float inner = exp(-pow((r - uRadius * 0.93) / 0.08, 2.0)) * 0.35;
            gl_FragColor = vec4(uColor, (ring + inner) * uOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  )

  const glowMat = useMemo(
    () =>
      new MeshBasicMaterial({
        map: getPlaceholder('glow'),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  )

  useEffect(
    () => () => {
      discMat.dispose()
      haloMat.dispose()
      glowMat.dispose()
    },
    [discMat, haloMat, glowMat],
  )

  // Short side, so the moon doesn't balloon on tall portrait screens.
  const radius = Math.min(rect.h, rect.w) * size
  const haloScale = radius * haloRadius * 2 / 0.7 // ring sits at uv radius 0.7 of the plane
  discMat.uniforms.uColor!.value.set(color)
  discMat.uniforms.uMaria!.value = surface === 'sun' ? 0 : 1
  discMat.uniforms.uSoft!.value = surface === 'sun' ? 0.12 : 0.03
  haloMat.uniforms.uColor!.value.set(color)
  haloMat.uniforms.uOpacity!.value = haloOpacity
  glowMat.color.set(color)

  useFrame(() => {
    const p = chapter.progress
    const g = group.current
    if (g) {
      g.position.x = rect.minX + rect.w * (u + driftU * p)
      g.position.y = rect.minY + rect.h * (v + driftV * p)
    }
    const boost = 1 + chapter.intensity * 0.45
    discMat.uniforms.uIntensity!.value = intensity * boost
    glowMat.opacity = glowOpacity * boost
    haloMat.uniforms.uOpacity!.value = haloOpacity * boost
  })

  return (
    <group ref={group} position={[rect.minX + rect.w * u, rect.minY + rect.h * v, z]}>
      <mesh material={glowMat} scale={radius * 7} position-z={-0.2}>
        <planeGeometry />
      </mesh>
      <mesh material={haloMat} scale={haloScale} position-z={-0.1}>
        <planeGeometry />
      </mesh>
      <mesh ref={discRef} material={discMat} scale={radius * 2}>
        <planeGeometry />
      </mesh>
    </group>
  )
}
