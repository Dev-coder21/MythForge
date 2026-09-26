import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  PlaneGeometry,
  ShaderMaterial,
} from 'three'
import type { ParticleType } from '@/spec'
import { chapterState } from '../store'
import { PARTICLE_PRESETS } from './particlePresets'

interface ParticlesProps {
  type: ParticleType
  count: number
  /** Axis-aligned volume the particles live (and wrap) in. */
  min: [number, number, number]
  max: [number, number, number]
  /** 0–1 share of particles visible before beat 3 thickens them. */
  baseDensity: number
  color: string
  size: number
  speed: number
  opacity: number
}

const MAX_COUNT = 1000

/** Instanced camera-facing sprites, animated entirely on the GPU (one draw call). */
export function Particles({ type, count, min, max, baseDensity, color, size, speed, opacity }: ParticlesProps) {
  const preset = type === 'none' ? null : PARTICLE_PRESETS[type]

  const geometry = useMemo(() => {
    const quad = new PlaneGeometry(1, 1)
    const geo = new InstancedBufferGeometry()
    geo.index = quad.index
    geo.setAttribute('position', quad.getAttribute('position'))
    geo.setAttribute('uv', quad.getAttribute('uv'))
    const base = new Float32Array(MAX_COUNT * 3)
    const seed = new Float32Array(MAX_COUNT * 4)
    for (let i = 0; i < MAX_COUNT; i++) {
      base[i * 3] = Math.random()
      base[i * 3 + 1] = Math.random()
      base[i * 3 + 2] = Math.random()
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random()
    }
    geo.setAttribute('aBase', new InstancedBufferAttribute(base, 3))
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 4))
    return geo
  }, [])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMin: { value: [0, 0, 0] },
          uSize3: { value: [1, 1, 1] },
          uColor: { value: new Color() },
          uSize: { value: 0.1 },
          uSpeed: { value: 1 },
          uRise: { value: 0 },
          uBlink: { value: 0 },
          uDensity: { value: 0.6 },
          uIntensity: { value: 0 },
          uOpacity: { value: 1 },
          uFocusDist: { value: 20 },
          uDof: { value: 0 },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aBase;
          attribute vec4 aSeed;
          uniform float uTime;
          uniform vec3 uMin;
          uniform vec3 uSize3;
          uniform float uSize;
          uniform float uSpeed;
          uniform float uRise;
          uniform float uBlink;
          uniform float uDensity;
          uniform float uIntensity;
          uniform float uFocusDist;
          uniform float uDof;
          varying float vAlpha;
          varying vec2 vUv;

          void main() {
            vUv = uv;
            float t = uTime * uSpeed;
            vec3 p = uMin + aBase * uSize3;
            p.x += sin(t * 0.7 + aSeed.x * 6.283) * 0.6 * aSeed.y;
            p.z += cos(t * 0.45 + aSeed.w * 6.283) * 0.5;
            p.y += sin(t * 0.5 + aSeed.z * 6.283) * 0.35 + uTime * uRise * (0.6 + aSeed.y * 0.8);
            p.y = uMin.y + mod(p.y - uMin.y, uSize3.y);

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            // Out-of-focus particles swell into soft bokeh discs; alpha drops to conserve energy.
            float depth = max(0.1, -mv.z);
            float coc = uDof * abs(depth - uFocusDist) / depth;
            mv.xy += position.xy * uSize * (0.5 + aSeed.y) * (1.0 + coc * 3.0);
            gl_Position = projectionMatrix * mv;

            float blink = mix(1.0, smoothstep(0.15, 1.0, 0.5 + 0.5 * sin(t * 1.9 * (0.5 + aSeed.x) + aSeed.w * 40.0)), uBlink);
            float visible = step(aSeed.z, uDensity + uIntensity * (1.0 - uDensity));
            // Fade near the wrap edges so particles never pop.
            float yn = (p.y - uMin.y) / uSize3.y;
            float wrapFade = smoothstep(0.0, 0.08, yn) * smoothstep(1.0, 0.92, yn);
            vAlpha = blink * visible * wrapFade / (1.0 + coc * 4.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uIntensity;
          varying float vAlpha;
          varying vec2 vUv;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float core = smoothstep(0.35, 0.0, d);
            float halo = pow(max(0.0, 1.0 - d), 2.5) * 0.5;
            float a = (core + halo) * vAlpha * uOpacity * (1.0 + uIntensity * 0.5);
            if (a < 0.003) discard;
            gl_FragColor = vec4(uColor * (1.0 + core), a);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  )

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  geometry.instanceCount = Math.min(count, MAX_COUNT)
  const u = material.uniforms
  u.uMin!.value = min
  u.uSize3!.value = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  u.uColor!.value.set(color)
  u.uSize!.value = size
  u.uSpeed!.value = speed
  u.uRise!.value = preset?.rise ?? 0
  u.uBlink!.value = preset?.blink ?? 0
  u.uDensity!.value = baseDensity
  u.uOpacity!.value = opacity

  useFrame(({ clock, camera }) => {
    u.uTime!.value = clock.elapsedTime
    u.uIntensity!.value = chapterState.intensity
    u.uFocusDist!.value = Math.abs(camera.position.z - chapterState.focus.z)
    u.uDof!.value = chapterState.focus.strength
  })

  if (!preset) return null
  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}
