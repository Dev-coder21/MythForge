import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three'
import type { Rect } from '../camera/paths'
import { NOISE_GLSL } from './glsl'

interface AbstractFieldProps {
  rectAt: (z: number) => Rect
  /** Chapter palette: dark base, glow accent, and the sky top for depth. */
  base: string
  accent: string
  deep: string
  /** "ink" (soft washes, rising ink) or "cosmos" (nebula, stars); the kit picks. */
  style: 'ink' | 'cosmos'
  ribbons: number
  shapes: number
  particles: number
  reducedMotion: boolean
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

/**
 * Abstract template, code only (no art files): for people, music, history and ideas with no place.
 * - field: a domain-warped flow (painterly nebula or ink wash) in the chapter's colours
 * - ribbons: soft light ribbons that wave across the frame at different depths
 * - shapes: a few floating translucent rings and discs drifting slowly
 * - particles: drifting motes that follow a curl-like flow
 */
export function AbstractField({ rectAt, base, accent, deep, style, ribbons, shapes, particles, reducedMotion }: AbstractFieldProps) {
  const field = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uBase: { value: new Color() }, uAccent: { value: new Color() }, uDeep: { value: new Color() },
          uTime: { value: 0 }, uInk: { value: 0 }, uAspect: { value: 1 },
        },
        vertexShader: VERT,
        fragmentShader: /* glsl */ `
          uniform vec3 uBase; uniform vec3 uAccent; uniform vec3 uDeep; uniform float uTime; uniform float uInk; uniform float uAspect;
          varying vec2 vUv;
          ${NOISE_GLSL}
          void main() {
            vec2 p = vUv * vec2(uAspect, 1.0) * 2.2;
            float t = uTime * 0.025;
            vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t)));
            vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t), fbm(p + 3.0 * q + vec2(8.3, 2.8) - t));
            float f = fbm(p + 2.5 * r);
            // Nebula: deep sky to base, accent in the folds. Ink: paper-dark wash with pooled pigment edges.
            // Lift the palette so dark chapter colours still read as a nebula, not a flat field.
            vec3 lifted = uBase * 1.8 + uAccent * 0.08;
            vec3 nebula = mix(uDeep, lifted, smoothstep(0.15, 0.85, f));
            nebula = mix(nebula, uAccent, pow(smoothstep(0.35, 0.9, f * length(q)), 1.6) * 0.75);
            float pool = smoothstep(0.48, 0.52, f) - smoothstep(0.52, 0.6, f);
            vec3 ink = mix(uBase * 1.1, uDeep, smoothstep(0.3, 0.9, f)) + uAccent * pool * 0.35;
            vec3 col = mix(nebula, ink, uInk);
            float stars = step(0.997, hash21(floor(vUv * vec2(uAspect, 1.0) * 420.0))) * (1.0 - uInk);
            col += stars * 0.8;
            float vig = smoothstep(1.2, 0.3, length((vUv - 0.5) * vec2(uAspect * 0.8, 1.0)));
            gl_FragColor = vec4(col * (0.55 + 0.45 * vig), 1.0);
          }
        `,
        // Transparent so it sorts back-to-front with the sky plane (z -60) and draws in front of it.
        transparent: true,
        depthWrite: false,
      }),
    [],
  )

  const ribbon = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color() }, uTime: { value: 0 }, uSeed: { value: 0 }, uOpacity: { value: 0.5 } },
        vertexShader: VERT,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uTime; uniform float uSeed; uniform float uOpacity;
          varying vec2 vUv;
          void main() {
            float t = uTime * 0.12 + uSeed;
            float y = 0.5 + 0.22 * sin(vUv.x * 3.1 + t) + 0.1 * sin(vUv.x * 7.3 - t * 1.3 + uSeed);
            float w = 0.025 + 0.02 * sin(vUv.x * 2.0 + t * 0.7);
            float d = abs(vUv.y - y) / w;
            float core = exp(-d * d);
            float glow = exp(-d * 0.6) * 0.25;
            float ends = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
            gl_FragColor = vec4(uColor, (core + glow) * ends * uOpacity);
          }
        `,
        transparent: true, depthWrite: false, blending: AdditiveBlending,
      }),
    [],
  )

  const shape = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color() }, uRing: { value: 0 }, uOpacity: { value: 0.3 } },
        vertexShader: VERT,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uRing; uniform float uOpacity;
          varying vec2 vUv;
          void main() {
            float r = length(vUv - 0.5) * 2.0;
            float disc = smoothstep(1.0, 0.7, r);
            float ring = smoothstep(0.08, 0.0, abs(r - 0.82)) ;
            float a = mix(disc * 0.5, ring, uRing);
            gl_FragColor = vec4(uColor, a * uOpacity);
          }
        `,
        transparent: true, depthWrite: false, blending: AdditiveBlending,
      }),
    [],
  )

  const motes = useMemo(() => {
    const n = Math.max(0, Math.round(particles))
    const geo = new BufferGeometry()
    const pos = new Float32Array(n * 3)
    const seed = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * 2 - 1
      pos[i * 3 + 1] = Math.random() * 2 - 1
      pos[i * 3 + 2] = -6 - Math.random() * 30
      seed[i] = Math.random() * 100
    }
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new BufferAttribute(seed, 1))
    const mat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color() }, uTime: { value: 0 }, uHalf: { value: [10, 6] } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform vec2 uHalf;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * 0.05 + aSeed;
          float scale = -p.z * 0.45;
          p.x = (fract(p.x * 0.5 + 0.5 + t * 0.04) * 2.0 - 1.0) * uHalf.x * scale / 6.0 + sin(t * 1.7) * 0.4;
          p.y = p.y * uHalf.y * scale / 6.0 + sin(t + p.x * 0.3) * 0.6;
          vA = 0.4 + 0.6 * sin(aSeed + uTime * 0.8) * 0.5 + 0.3;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 90.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vA);
        }
      `,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    })
    return { geo, mat }
  }, [particles])

  useEffect(() => () => {
    field.dispose()
    ribbon.dispose()
    shape.dispose()
    motes.geo.dispose()
    motes.mat.dispose()
  }, [field, ribbon, shape, motes])

  field.uniforms.uBase!.value.set(base)
  field.uniforms.uAccent!.value.set(accent)
  field.uniforms.uDeep!.value.set(deep)
  field.uniforms.uInk!.value = style === 'ink' ? 1 : 0
  ribbon.uniforms.uColor!.value.set(accent)
  shape.uniforms.uColor!.value.set(accent)
  motes.mat.uniforms.uColor!.value.set(accent)

  useFrame(({ clock }) => {
    const t = reducedMotion ? 0 : clock.elapsedTime
    field.uniforms.uTime!.value = t
    ribbon.uniforms.uTime!.value = t
    motes.mat.uniforms.uTime!.value = t
  })

  const back = rectAt(-58)
  field.uniforms.uAspect!.value = back.w / back.h
  const ribbonDepths = useMemo(() => [-44, -30, -20, -12].slice(0, ribbons), [ribbons])
  const shapeSpecs = useMemo(
    () => Array.from({ length: shapes }, (_, i) => ({ z: -40 + i * 6, u: ((i * 0.37) % 1) - 0.5, v: ((i * 0.61) % 0.6) + 0.2, s: 0.08 + ((i * 0.23) % 0.12), ring: i % 2 })),
    [shapes],
  )
  // Per-instance materials share the time and colour uniforms of their template material.
  const ribbonMats = useMemo(
    () =>
      ribbonDepths.map((_, i) => {
        const m = ribbon.clone()
        m.uniforms.uSeed = { value: i * 2.3 }
        m.uniforms.uOpacity = { value: 0.55 - i * 0.08 }
        m.uniforms.uTime = ribbon.uniforms.uTime!
        m.uniforms.uColor = ribbon.uniforms.uColor!
        return m
      }),
    [ribbon, ribbonDepths],
  )
  const shapeMats = useMemo(
    () =>
      shapeSpecs.map((sp) => {
        const m = shape.clone()
        m.uniforms.uRing = { value: sp.ring }
        m.uniforms.uOpacity = { value: 0.22 }
        m.uniforms.uColor = shape.uniforms.uColor!
        return m
      }),
    [shape, shapeSpecs],
  )
  useEffect(() => () => [...ribbonMats, ...shapeMats].forEach((m) => m.dispose()), [ribbonMats, shapeMats])

  return (
    <>
      <mesh position={[(back.minX + back.maxX) / 2, (back.minY + back.maxY) / 2, -58]} scale={[back.w * 1.3, back.h * 1.3, 1]} material={field}>
        <planeGeometry />
      </mesh>
      {ribbonDepths.map((z, i) => {
        const r = rectAt(z)
        return (
          <mesh key={z} position={[(r.minX + r.maxX) / 2, r.minY + r.h * (0.35 + i * 0.1), z]} scale={[r.w * 1.2, r.h * 0.5, 1]} material={ribbonMats[i]}>
            <planeGeometry />
          </mesh>
        )
      })}
      {shapeSpecs.map((sp, i) => {
        const r = rectAt(sp.z)
        const size = r.h * sp.s * 2
        return (
          <mesh key={i} position={[(r.minX + r.maxX) / 2 + r.w * sp.u * 0.8, r.minY + r.h * sp.v, sp.z]} scale={[size, size, 1]} material={shapeMats[i]}>
            <planeGeometry />
          </mesh>
        )
      })}
      <points geometry={motes.geo} material={motes.mat} />
    </>
  )
}
