import { useFrame } from '@react-three/fiber'
import { forwardRef, useEffect, useMemo } from 'react'
import type { Mesh, Texture } from 'three'
import type { Rect } from '../camera/paths'
import type { KitPlacement } from '../scenes/kit'
import { storyState, useChapter } from '../store'
import { createLayerMaterial } from './layerMaterial'

export interface LayerBox {
  x: number
  y: number
  w: number
  h: number
}

/** World-space box of a kit element placed in `rect` (the visible frame at its depth). */
export function placeInRect(rect: Rect, p: KitPlacement, texAspect: number): LayerBox {
  let h = rect.h * p.height
  let w = h * texAspect
  if (p.stretch) w = Math.max(rect.w * 1.3, w)
  if (p.maxWidth && w > rect.w * p.maxWidth && !p.stretch) {
    const k = (rect.w * p.maxWidth) / w
    w *= k
    h *= k
  }
  const ax = p.anchorX ?? 0.5
  const x = (rect.minX + rect.maxX) / 2 + rect.w * p.x + w * (0.5 - ax)
  const y = rect.minY + rect.h * p.bottom - h * (p.anchorY ?? 0) + h / 2
  return { x, y, w, h }
}

export interface DepthLayerProps {
  texture: Texture
  z: number
  box: LayerBox
  flip?: boolean
  tint: string
  fogColor: string
  fogMix: number
  /** 0 = rigid, 1 = full sway. Multiplied by `wind`. */
  sway?: number
  wind?: number
  rim?: number
  rimColor?: string
  lightGain?: number
}

/** A painted, textured plane at a real Z depth (one kit element). */
export const DepthLayer = forwardRef<Mesh, DepthLayerProps>(function DepthLayer(
  { texture, z, box, flip = false, tint, fogColor, fogMix, sway = 0, wind = 0, rim = 0, rimColor = '#ffffff', lightGain = 1 },
  ref,
) {
  const chapter = useChapter()
  const material = useMemo(() => createLayerMaterial(texture, chapter.lights), [texture, chapter])
  useEffect(() => () => material.dispose(), [material])

  const image = texture.image as { width: number; height: number }
  const u = material.uniforms
  u.uTint!.value.set(tint)
  u.uFogColor!.value.set(fogColor)
  u.uFogMix!.value = fogMix
  u.uSway!.value = sway
  u.uWind!.value = wind
  u.uFlip!.value = flip ? 1 : 0
  u.uRim!.value = rim
  u.uRimColor!.value.set(rimColor)
  u.uRimTexel!.value.set(3 / image.width, 3 / image.height)
  u.uLightGain!.value = lightGain

  useFrame(({ clock, camera }) => {
    if (sway > 0) u.uTime!.value = clock.elapsedTime
    // Circle of confusion ∝ |d - f| / d, applied as a mip LOD bias.
    const { dof } = storyState
    const d = Math.max(0.1, Math.abs(camera.position.z - z))
    const f = Math.abs(camera.position.z - chapter.focusZ)
    u.uBlur!.value = dof.strength * (Math.abs(d - f) / d) * (d < f ? dof.front : 1)
  })

  // Sway needs vertices to bend; a column per ~2% of width is plenty.
  const segments = sway > 0 ? 48 : 1
  return (
    <mesh ref={ref} position={[box.x, box.y, z]} scale={[box.w, box.h, 1]} material={material}>
      <planeGeometry args={[1, 1, segments, sway > 0 ? 4 : 1]} />
    </mesh>
  )
})
