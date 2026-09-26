import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, ShaderMaterial } from 'three'
import type { Rect } from '../camera/paths'

interface SkyLayerProps {
  z: number
  rect: Rect
  top: string
  mid: string
  horizon: string
  /** Where the mid stop sits, 0 (bottom) – 1 (top). */
  midPosition: number
  stars: number
}

/** SkyGradient: 3-stop vertical gradient + hashed twinkling stars. */
export function SkyLayer({ z, rect, top, mid, horizon, midPosition, stars }: SkyLayerProps) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTop: { value: new Color() },
          uMid: { value: new Color() },
          uHorizon: { value: new Color() },
          uMidPos: { value: 0.45 },
          uStars: { value: 1 },
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
          uniform vec3 uTop;
          uniform vec3 uMid;
          uniform vec3 uHorizon;
          uniform float uMidPos;
          uniform float uStars;
          uniform float uAspect;
          uniform float uTime;
          varying vec2 vUv;

          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

          void main() {
            float y = vUv.y;
            vec3 col = mix(uHorizon, uMid, smoothstep(0.0, uMidPos, y));
            col = mix(col, uTop, smoothstep(uMidPos, 1.0, y));

            vec2 g = vUv * vec2(uAspect, 1.0) * 140.0;
            vec2 id = floor(g);
            vec2 f = fract(g) - 0.5;
            float h = hash(id);
            vec2 jitter = vec2(hash(id + 1.7), hash(id + 9.3)) - 0.5;
            float star = step(0.975, h) * smoothstep(0.12, 0.0, length(f - jitter * 0.6));
            float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + h * 2.5) + h * 60.0);
            col += star * twinkle * uStars * smoothstep(0.35, 0.95, y) * (0.4 + h);

            // Dither to hide gradient banding.
            col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  const u = material.uniforms
  u.uTop!.value.set(top)
  u.uMid!.value.set(mid)
  u.uHorizon!.value.set(horizon)
  u.uMidPos!.value = midPosition
  u.uStars!.value = stars

  const w = rect.w * 1.5
  const h = rect.h * 1.5
  u.uAspect!.value = w / h

  useFrame(({ clock }) => {
    u.uTime!.value = clock.elapsedTime
  })

  return (
    <mesh position={[(rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2, z]} scale={[w, h, 1]} material={material}>
      <planeGeometry />
    </mesh>
  )
}
