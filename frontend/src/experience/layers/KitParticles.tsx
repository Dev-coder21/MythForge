import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  type Texture,
} from 'three'
import { storyState, useChapter } from '../store'

interface KitParticlesProps {
  texture: Texture
  /** Sprite-sheet cells, laid out horizontally. */
  cells: number
  count: number
  min: [number, number, number]
  max: [number, number, number]
  size: number
  speed: number
  /** Fall speed, world units per second. */
  fall: number
  opacity: number
  /** Multiplies the sprite colour (night grade). */
  tint: string
  /** Sideways wind, world units per second (blown sand). */
  windX?: number
}

const MAX = 600

/**
 * Falling petals/leaves from the kit's sprite sheet: instanced quads that fall,
 * drift on a wind curve, spin and tumble (x-scale by cos for a fake 3D flip).
 * Out-of-focus sprites grow and fade (bokeh). One draw call per layer.
 */
export function KitParticles({ texture, cells, count, min, max, size, speed, fall, opacity, tint, windX = 0 }: KitParticlesProps) {
  const chapter = useChapter()
  const geometry = useMemo(() => {
    const quad = new PlaneGeometry(1, 1)
    const geo = new InstancedBufferGeometry()
    geo.index = quad.index
    geo.setAttribute('position', quad.getAttribute('position'))
    geo.setAttribute('uv', quad.getAttribute('uv'))
    // Deterministic per-instance seeds (stable across reloads and screenshots).
    let s = 1234567
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const base = new Float32Array(MAX * 3)
    const seed = new Float32Array(MAX * 4)
    for (let i = 0; i < MAX; i++) {
      base[i * 3] = rnd()
      base[i * 3 + 1] = rnd()
      base[i * 3 + 2] = rnd()
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd()
    }
    geo.setAttribute('aBase', new InstancedBufferAttribute(base, 3))
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 4))
    return geo
  }, [])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uMap: { value: texture },
          uCells: { value: 4 },
          uTime: { value: 0 },
          uMin: { value: [0, 0, 0] },
          uSize3: { value: [1, 1, 1] },
          uSize: { value: 0.1 },
          uSpeed: { value: 1 },
          uFall: { value: 0.5 },
          uWindX: { value: 0 },
          uOpacity: { value: 1 },
          uTint: { value: new Color() },
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
          uniform float uFall;
          uniform float uWindX;
          uniform float uCells;
          uniform float uFocusDist;
          uniform float uDof;
          varying vec2 vUv;
          varying float vAlpha;

          void main() {
            float t = uTime * uSpeed;
            vec3 p = uMin + aBase * uSize3;
            // Fall + wind drift (leaves travel left→right, bobbing).
            p.y -= uTime * uFall * (0.6 + aSeed.y * 0.8);
            p.y = uMin.y + mod(p.y - uMin.y, uSize3.y);
            p.x += sin(t * 0.6 + aSeed.x * 6.283) * 0.8 + uTime * (0.12 + uWindX) * (0.5 + aSeed.z);
            p.x = uMin.x + mod(p.x - uMin.x, uSize3.x);
            p.z += cos(t * 0.4 + aSeed.w * 6.283) * 0.4;

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float depth = max(0.1, -mv.z);
            float coc = uDof * abs(depth - uFocusDist) / depth;

            // Spin in-plane, tumble by squashing x.
            float spin = t * (1.0 + aSeed.x * 2.0) + aSeed.w * 6.283;
            float tumble = 0.25 + 0.75 * abs(cos(t * (0.8 + aSeed.z) + aSeed.y * 6.283));
            vec2 q = position.xy * vec2(tumble, 1.0);
            q = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * q;
            mv.xy += q * uSize * (0.6 + aSeed.y * 0.8) * (1.0 + coc * 1.5);
            gl_Position = projectionMatrix * mv;

            float cell = floor(aSeed.z * uCells);
            vUv = vec2((uv.x + cell) / uCells, uv.y);
            float yn = (p.y - uMin.y) / uSize3.y;
            vAlpha = smoothstep(0.0, 0.08, yn) * smoothstep(1.0, 0.9, yn) / (1.0 + coc * 2.5);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform float uOpacity;
          uniform vec3 uTint;
          varying vec2 vUv;
          varying float vAlpha;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            float a = t.a * vAlpha * uOpacity;
            if (a < 0.01) discard;
            gl_FragColor = vec4(t.rgb * uTint, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
      }),
    [texture],
  )

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  geometry.instanceCount = Math.min(count, MAX)
  const u = material.uniforms
  u.uCells!.value = cells
  u.uMin!.value = min
  u.uSize3!.value = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  u.uSize!.value = size
  u.uSpeed!.value = speed
  u.uFall!.value = fall
  u.uWindX!.value = windX
  u.uOpacity!.value = opacity
  u.uTint!.value.set(tint)

  useFrame(({ clock, camera }) => {
    u.uTime!.value = clock.elapsedTime * (storyState.reducedMotion ? 0.35 : 1)
    u.uFocusDist!.value = Math.abs(camera.position.z - chapter.focusZ)
    u.uDof!.value = storyState.dof.strength
  })

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}
