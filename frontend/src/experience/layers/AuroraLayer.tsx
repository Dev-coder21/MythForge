import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, Color, ShaderMaterial } from 'three'
import type { Rect } from '../camera/paths'
import { NOISE_GLSL } from './glsl'

interface AuroraLayerProps {
  z: number
  rect: Rect
  /** Two curtain colours (the kit's aurora block). */
  colorA: string
  colorB: string
  opacity: number
  /** Vertical band centre and half-height, fractions of the frame. */
  v: number
  h: number
  speed: number
}

/**
 * Aurora (Ice / polar template, night only): two folded light curtains. Each is a wavy band whose
 * edge is pulled by noise; brightness falls off upward in vertical rays, additive over the sky.
 */
export function AuroraLayer({ z, rect, colorA, colorB, opacity, v, h, speed }: AuroraLayerProps) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uA: { value: new Color() },
          uB: { value: new Color() },
          uOpacity: { value: 0.6 },
          uV: { value: 0.7 },
          uH: { value: 0.2 },
          uTime: { value: 0 },
          uSpeed: { value: 0.05 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uA; uniform vec3 uB; uniform float uOpacity; uniform float uV; uniform float uH;
          uniform float uTime; uniform float uSpeed;
          varying vec2 vUv;
          ${NOISE_GLSL}
          float curtain(vec2 uv, float seed, float base) {
            float t = uTime * uSpeed;
            float fold = sin(uv.x * 6.0 + seed + t * 2.0) * 0.05 + (fbm(vec2(uv.x * 3.0 + seed, t)) - 0.5) * 0.12;
            float edge = base + fold;
            float d = uv.y - edge;                          // above the lower edge glows, fading upward
            float body = smoothstep(-0.01, 0.02, d) * exp(-max(d, 0.0) / (uH * 0.9));
            float rays = 0.6 + 0.4 * fbm(vec2(uv.x * 40.0 + seed, t * 3.0));
            return body * rays;
          }
          void main() {
            float a = curtain(vUv, 1.7, uV - uH * 0.5);
            float b = curtain(vUv * vec2(1.3, 1.0) + vec2(0.2, 0.0), 4.1, uV - uH * 0.1);
            vec3 col = uA * a + uB * b * 0.8;
            float edgeFade = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
            gl_FragColor = vec4(col, (a + b * 0.8) * uOpacity * edgeFade);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  const u = material.uniforms
  u.uA!.value.set(colorA)
  u.uB!.value.set(colorB)
  u.uOpacity!.value = opacity
  u.uV!.value = v
  u.uH!.value = h
  u.uSpeed!.value = speed
  useFrame(({ clock }) => {
    u.uTime!.value = clock.elapsedTime
  })
  const w = rect.w * 1.4
  return (
    <mesh position={[(rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2, z]} scale={[w, rect.h, 1]} material={material}>
      <planeGeometry />
    </mesh>
  )
}
