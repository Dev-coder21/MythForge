import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, ShaderMaterial } from 'three'
import type { Rect } from '../camera/paths'
import type { KitRiver } from '../scenes/kit'
import { storyState, useChapter } from '../store'
import { NOISE_GLSL } from './glsl'

interface RiverWaterProps {
  river: KitRiver
  rectAt: (z: number) => Rect
  portrait: boolean
  skyTop: string
  skyMid: string
  skyHorizon: string
  sun: string
  /** Sun position in the opening frame (0–1 from left / bottom). */
  sunUV: [number, number]
}

/**
 * A wide river surface (Tide template). One stretched plane from the near
 * bank to the far bank, shaded procedurally:
 * - sky reflection: horizon colour at the far edge, deeper sky toward the viewer
 * - ripples that compress toward the horizon (fake perspective) and drift in
 * - a sun glitter path under the sun, widening toward the viewer, with sparkles
 * - lantern/light reflections via the chapter's light uniforms
 * The far edge fades softly into the far bank.
 */
export function RiverWater({ river, rectAt, portrait, skyTop, skyMid, skyHorizon, sun, sunUV }: RiverWaterProps) {
  const chapter = useChapter()
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uTop: { value: new Color() },
          uMid: { value: new Color() },
          uHorizon: { value: new Color() },
          uSun: { value: new Color() },
          uSunX: { value: 0 },
          uWidth: { value: 1 },
          uGlitter: { value: 1 },
          uIntensity: { value: 0 },
          ...chapter.lights,
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uTop;
          uniform vec3 uMid;
          uniform vec3 uHorizon;
          uniform vec3 uSun;
          uniform float uSunX;
          uniform float uWidth;
          uniform float uGlitter;
          uniform float uIntensity;
          varying vec2 vUv;
          varying vec3 vWorld;
          ${NOISE_GLSL}

          void main() {
            float far = vUv.y;                         // 0 near bank, 1 far bank
            float s = 1.0 / (1.06 - far);              // perspective: bands compress toward the far edge
            float t = uTime;
            vec2 rp = vec2(vUv.x * 5.0 * (0.4 + s * 0.12), s * 3.2 - t * 0.35);
            float ripple = fbm(rp);
            float fine = fbm(rp * 3.1 + vec2(t * 0.2, 0.0));

            // Sky reflection, broken by ripples.
            vec3 sky = mix(uMid, uHorizon, smoothstep(0.35, 1.0, far));
            sky = mix(uTop * 0.7, sky, smoothstep(0.0, 0.45, far));
            // Water is darker and bluer than the sky it mirrors (Fresnel: brighter only toward the far edge).
            sky = mix(sky, uTop, 0.35);
            vec3 col = sky * (0.6 + 0.4 * ripple) * mix(0.32, 0.8, pow(far, 1.5));

            // Sun glitter path: a column under the sun, wider near the viewer.
            float halfW = mix(0.16, 0.03, far) * uWidth;
            float dx = (vWorld.x - uSunX) / max(halfW, 1e-3);
            dx += (ripple - 0.5) * 1.6;
            float path = exp(-dx * dx);
            float sparkle = pow(smoothstep(0.62, 0.95, fine), 2.0);
            col += uSun * path * (0.22 + sparkle * 2.2) * uGlitter * (1.0 + uIntensity * 0.4);

            float a = smoothstep(1.0, 0.93, far);    // soft seam into the far bank
            gl_FragColor = vec4(col, a);
          }
        `,
        transparent: true,
        depthWrite: false,
      }),
    [chapter],
  )
  useEffect(() => () => material.dispose(), [material])

  const place = portrait && river.portrait ? { ...river, ...river.portrait } : river
  const rect = rectAt(river.z)
  const h = rect.h * place.height
  const w = rect.w * 1.5
  const y = rect.minY + rect.h * place.bottom + h / 2
  const x = (rect.minX + rect.maxX) / 2

  const u = material.uniforms
  u.uTop!.value.set(skyTop)
  u.uMid!.value.set(skyMid)
  u.uHorizon!.value.set(skyHorizon)
  u.uSun!.value.set(sun)
  u.uSunX!.value = rect.minX + rect.w * sunUV[0]
  u.uWidth!.value = rect.w
  u.uGlitter!.value = river.glitter ?? 1

  useFrame(({ clock }) => {
    u.uTime!.value = clock.elapsedTime * (storyState.reducedMotion ? 0.3 : 1)
    u.uIntensity!.value = chapter.intensity
  })

  return (
    <mesh position={[x, y, river.z]} scale={[w, h, 1]} material={material}>
      <planeGeometry />
    </mesh>
  )
}
