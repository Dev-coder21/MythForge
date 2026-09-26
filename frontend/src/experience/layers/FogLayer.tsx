import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, Color, ShaderMaterial } from 'three'
import type { Rect } from '../camera/paths'
import { NOISE_GLSL } from './glsl'

interface FogLayerProps {
  z: number
  rect: Rect
  color: string
  opacity: number
  speed: number
  /** Fraction of the plane (from the bottom) where fog fades out. */
  height: number
  scale: number
}

/** FogNoise: scrolling, domain-warped fbm; additive and denser near the ground. */
export function FogLayer({ z, rect, color, opacity, speed, height, scale }: FogLayerProps) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color() },
          uOpacity: { value: 0.3 },
          uSpeed: { value: 0.03 },
          uHeight: { value: 0.6 },
          uScale: { value: 2 },
          uAspect: { value: 1 },
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uSpeed;
          uniform float uHeight;
          uniform float uScale;
          uniform float uAspect;
          uniform float uTime;
          varying vec2 vUv;
          ${NOISE_GLSL}

          void main() {
            vec2 p = vUv * vec2(uAspect, 1.0) * uScale;
            float t = uTime * uSpeed;
            // One cheap warp sample (not a full fbm pair) keeps this under budget at 1.75 DPR.
            float warp = valueNoise(p * 0.5 + vec2(t * 0.6, t * 0.3));
            float n = fbm(p + vec2(warp * 1.6 + t, warp * 0.6));
            float heightMask = 1.0 - smoothstep(0.0, uHeight, vUv.y);
            float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
            float a = smoothstep(0.3, 0.85, n) * heightMask * edge * uOpacity;
            gl_FragColor = vec4(uColor, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  const w = rect.w * 1.5
  const h = rect.h * 0.9
  const u = material.uniforms
  u.uColor!.value.set(color)
  u.uOpacity!.value = opacity
  u.uSpeed!.value = speed
  u.uHeight!.value = height
  u.uScale!.value = scale
  u.uAspect!.value = w / h

  useFrame(({ clock }) => {
    u.uTime!.value = clock.elapsedTime
  })

  return (
    <mesh position={[(rect.minX + rect.maxX) / 2, rect.minY + h / 2 - rect.h * 0.05, z]} scale={[w, h, 1]} material={material}>
      <planeGeometry />
    </mesh>
  )
}
