import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, Color, ShaderMaterial, type Texture } from 'three'
import { storyState, useChapter } from '../store'
import type { LayerBox } from './DepthLayer'
import { NOISE_GLSL } from './glsl'

interface WaterSurfaceProps {
  /** Grey mask of the open water (white = water) in the pond element's UV space. */
  mask: Texture
  box: LayerBox
  z: number
  flip?: boolean
  skyTop: string
  skyMid: string
  skyHorizon: string
  /** Key light of the hour (sun/moon), for the glints. */
  sun: string
  opacity: number
}

/**
 * Life on a painted pond, confined to its water mask:
 * - the sky gradient mirrored (horizon colour at the far edge, higher sky nearer),
 *   broken up by slow horizontal ripples
 * - warm streak reflections below each of the chapter's lantern lights
 * - a fine shimmer of glints in the key light's colour
 * Additive over the painted water, so the painting stays readable underneath.
 */
export function WaterSurface({ mask, box, z, flip = false, skyTop, skyMid, skyHorizon, sun, opacity }: WaterSurfaceProps) {
  const chapter = useChapter()
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uMask: { value: mask },
          uTime: { value: 0 },
          uFlip: { value: 0 },
          uTop: { value: new Color() },
          uMid: { value: new Color() },
          uHorizon: { value: new Color() },
          uSun: { value: new Color() },
          uOpacity: { value: 0.35 },
          uWorldW: { value: 1 },
          // Lantern reflections read the chapter's light uniforms by reference.
          ...chapter.lights,
        },
        vertexShader: /* glsl */ `
          uniform float uFlip;
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vUv = vec2(mix(uv.x, 1.0 - uv.x, uFlip), uv.y);
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          #define MAX_LIGHTS 4
          uniform sampler2D uMask;
          uniform float uTime;
          uniform vec3 uTop;
          uniform vec3 uMid;
          uniform vec3 uHorizon;
          uniform vec3 uSun;
          uniform float uOpacity;
          uniform float uWorldW;
          uniform vec4 uLightPos[MAX_LIGHTS];
          uniform vec3 uLightCol[MAX_LIGHTS];
          uniform int uLightCount;
          varying vec2 vUv;
          varying vec3 vWorld;
          ${NOISE_GLSL}

          void main() {
            // Ripples: small horizontal offsets that drift, stronger toward the viewer.
            float nearness = 1.0 - vUv.y;
            float t = uTime;
            vec2 rp = vec2(vUv.x * 6.0, vUv.y * 22.0);
            float ripple = (fbm(rp + vec2(t * 0.25, t * 0.1)) - 0.5) * (0.012 + nearness * 0.02);
            float m = texture2D(uMask, vUv + vec2(ripple, 0.0)).r;
            if (m < 0.01) discard;

            // Mirrored sky: far edge of the pond shows the horizon, nearer water shows higher sky.
            float band = clamp(nearness + ripple * 6.0, 0.0, 1.0);
            vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.7, band));
            sky = mix(sky, uTop, smoothstep(0.6, 1.0, band));
            // Broken into ripple bands, as a real reflection is.
            float bands = 0.25 + 0.75 * smoothstep(0.4, 0.8, fbm(vec2(vUv.x * 3.0 + t * 0.05, vUv.y * 40.0)));
            vec3 col = sky * bands * 0.32;

            // Lantern streaks: vertical, wobbling columns under each light.
            for (int i = 0; i < MAX_LIGHTS; i++) {
              if (i >= uLightCount) break;
              vec3 lp = uLightPos[i].xyz;
              float dx = (vWorld.x - lp.x) / (0.06 * uWorldW);
              dx += (fbm(vec2(vUv.y * 30.0, t * 0.6 + float(i) * 3.1)) - 0.5) * 1.6;
              float depth = 1.0 / (1.0 + abs(lp.z - vWorld.z) * 0.35);
              float streak = exp(-dx * dx) * (0.35 + 0.65 * vUv.y) * depth;
              col += uLightCol[i] * streak * 0.5;
            }

            // Glints: sparse bright flecks that twinkle along the ripples.
            float g = fbm(vec2(vUv.x * 60.0 + t * 0.4, vUv.y * 120.0 - t * 0.2));
            col += uSun * pow(smoothstep(0.62, 0.9, g), 3.0) * 0.6;

            gl_FragColor = vec4(col, m * uOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [mask, chapter],
  )
  useEffect(() => () => material.dispose(), [material])

  const u = material.uniforms
  u.uFlip!.value = flip ? 1 : 0
  u.uTop!.value.set(skyTop)
  u.uMid!.value.set(skyMid)
  u.uHorizon!.value.set(skyHorizon)
  u.uSun!.value.set(sun)
  u.uOpacity!.value = opacity
  u.uWorldW!.value = box.w

  useFrame(({ clock }) => {
    u.uTime!.value = clock.elapsedTime * (storyState.reducedMotion ? 0.3 : 1)
  })

  return (
    <mesh position={[box.x, box.y, z + 0.02]} scale={[box.w, box.h, 1]} material={material}>
      <planeGeometry />
    </mesh>
  )
}
