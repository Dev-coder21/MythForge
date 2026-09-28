import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, Color, ShaderMaterial } from 'three'
import { storyState, useChapter } from '../store'
import { NOISE_GLSL } from './glsl'

interface LightShaftsProps {
  /** World position the beams fan out from (the moon, projected to this depth). */
  origin: [number, number, number]
  /** Direction the fan points, radians (0 = +x, -π/2 = straight down). */
  angle: number
  count: number
  /** Beam length in world units. */
  length: number
  /** Total fan spread, radians. */
  spread: number
  /** Beam width at the far end, world units. */
  width: number
  color: string
  opacity: number
}

/**
 * Soft god-ray beams from the moon: additive, tapered quads with scrolling
 * noise so the light breathes. Rendered at a mid depth with depth testing, so
 * the torii and cedars in front cut into them.
 */
export function LightShafts({ origin, angle, count, length, spread, width, color, opacity }: LightShaftsProps) {
  const chapter = useChapter()
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color() },
          uOpacity: { value: 0.1 },
          uTime: { value: 0 },
          uSeed: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            // Taper: narrow at the source (uv.y = 1), wide at the far end.
            vec3 p = position;
            p.x *= mix(1.0, 0.12, uv.y);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uTime;
          uniform float uSeed;
          varying vec2 vUv;
          ${NOISE_GLSL}
          void main() {
            float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float soft = smoothstep(0.0, 0.8, across);
            float along = smoothstep(0.0, 0.55, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
            float n = fbm(vec2(vUv.x * 3.0 + uSeed, vUv.y * 1.5 - uTime * 0.05));
            float a = soft * along * (0.45 + 0.9 * n) * uOpacity;
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

  // One material per beam would be wasteful; beams share it and differ by transform.
  material.uniforms.uColor!.value.set(color)

  useFrame(({ clock }) => {
    material.uniforms.uTime!.value = storyState.reducedMotion ? 0 : clock.elapsedTime
    // Light intensifies in beat 3; shafts fade a little behind the reading copy.
    material.uniforms.uOpacity!.value = opacity * (1 + chapter.intensity * 0.6) * (1 - chapter.dim * 0.35)
  })

  const beams = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const t = count === 1 ? 0.5 : i / (count - 1)
        const jitter = Math.sin(i * 12.9898) * 0.5
        return {
          rot: angle + (t - 0.5) * spread + jitter * spread * 0.12,
          len: length * (0.75 + 0.35 * Math.abs(Math.sin(i * 4.1))),
          w: width * (0.6 + 0.6 * Math.abs(Math.cos(i * 2.3))),
        }
      }),
    [count, angle, spread, length, width],
  )

  return (
    <group position={origin}>
      {beams.map((b, i) => (
        // Quad's top edge (uv.y = 1) sits at the origin; it extends along the beam direction.
        <group key={i} rotation={[0, 0, b.rot + Math.PI / 2]}>
          <mesh position={[0, -b.len / 2, -i * 0.01]} scale={[b.w, b.len, 1]} material={material}>
            <planeGeometry />
          </mesh>
        </group>
      ))}
    </group>
  )
}
