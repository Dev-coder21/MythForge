import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, type Texture } from 'three'
import type { Rect } from '../camera/paths'
import { chapterState } from '../store'
import { createLayerMaterial } from './layerMaterial'

export interface DepthLayerProps {
  texture: Texture
  z: number
  /** Visible rect at this depth for the widest camera pose. */
  rect: Rect
  /** Plane height as a fraction of the visible height. */
  heightFrac: number
  /** Where texture row `anchorUv` sits, as a fraction of visible height from the bottom. */
  bottomFrac: number
  /** Texture row (0 = bottom) pinned to `bottomFrac`, e.g. the ground line of a structure. */
  anchorUv?: number
  /** Extra width beyond the visible rect so camera moves never reveal an edge. */
  overscan?: number
  /** Keep the texture's aspect ratio instead of stretching to cover the width. */
  keepAspect?: boolean
  /** With keepAspect: cap plane width at this multiple of visible width (portrait screens). */
  maxWidthFrac?: number
  tint: string
  fogColor?: string
  fogMix?: number
  /** 0 = rigid, 1 = full sway. Multiplied by `wind`. */
  sway?: number
  wind?: number
  rim?: number
  rimColor?: string
  /** Subdivisions along x for smooth sway. */
  segments?: number
}

/** A painted, textured plane at a real Z depth, sized to cover the frame on any aspect. */
export function DepthLayer({
  texture,
  z,
  rect,
  heightFrac,
  bottomFrac,
  anchorUv = 0,
  overscan = 1.3,
  keepAspect = false,
  maxWidthFrac = Infinity,
  tint,
  fogColor = '#000000',
  fogMix = 0,
  sway = 0,
  wind = 0,
  rim = 0,
  rimColor = '#ffffff',
  segments = 1,
}: DepthLayerProps) {
  const material = useMemo(() => createLayerMaterial(texture), [texture])
  useEffect(() => () => material.dispose(), [material])

  const image = texture.image as { width: number; height: number }
  const texAspect = image.width / image.height
  const h = keepAspect
    ? Math.min(rect.h * heightFrac, (rect.w * maxWidthFrac) / texAspect)
    : rect.h * heightFrac
  const w = keepAspect ? h * texAspect : Math.max(rect.w * overscan, h * texAspect)
  const y = rect.minY + rect.h * bottomFrac - h * anchorUv + h / 2
  const x = (rect.minX + rect.maxX) / 2

  const u = material.uniforms
  u.uTint!.value.set(tint)
  u.uFogColor!.value.set(fogColor)
  u.uFogMix!.value = fogMix
  u.uSway!.value = sway
  u.uWind!.value = wind
  u.uRim!.value = rim
  ;(u.uRimColor!.value as Color).set(rimColor)
  u.uRimTexel!.value = 3 / image.height

  useFrame(({ clock, camera }) => {
    if (sway > 0) u.uTime!.value = clock.elapsedTime
    // Circle of confusion ∝ |d - f| / d, applied as a mip LOD bias.
    const { focus } = chapterState
    const d = Math.max(0.1, Math.abs(camera.position.z - z))
    const f = Math.abs(camera.position.z - focus.z)
    u.uBlur!.value = focus.strength * (Math.abs(d - f) / d) * (d < f ? focus.front : 1)
  })

  return (
    <mesh position={[x, y, z]} scale={[w, h, 1]} material={material}>
      <planeGeometry args={[1, 1, sway > 0 ? segments : 1, 1]} />
    </mesh>
  )
}
