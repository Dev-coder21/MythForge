import { useTexture } from '@react-three/drei'
import { useFrame, useLoader } from '@react-three/fiber'
import { createRef, useEffect, useLayoutEffect, useMemo, type RefObject } from 'react'
import { AdditiveBlending, Color, FileLoader, MeshBasicMaterial, SRGBColorSpace, type Mesh, type Texture } from 'three'
import type { Rect } from '../camera/paths'
import { DepthLayer, placeInRect, type LayerBox } from '../layers/DepthLayer'

import { getPlaceholder } from '../layers/placeholderTextures'
import { MAX_LIGHTS, storyState, useChapter } from '../store'
import { kitUrl, type Kit, type KitLayer } from './kit'

export interface KitLook {
  tint: string
  fogColor: string
  rimColor: string
  rim: number
  wind: number
  lightGain: number
  /** Extra fog blend added to every layer (0 = as authored). */
  fogBoost: number
}

/** Fetch and parse a kit manifest (suspends). */
export function useKit(template: string, name: string): Kit {
  const raw = useLoader(FileLoader, kitUrl(template, name)) as string
  return useMemo(() => JSON.parse(raw) as Kit, [raw])
}

/**
 * Kits share painted elements (same URL, same cached Texture), so GPU memory is
 * released by reference count: when the last mounted chapter using a texture
 * unmounts, it is disposed. three re-uploads it automatically if a chapter
 * that needs it mounts again (e.g. scrolling back).
 */
const textureUsers = new Map<Texture, number>()

/** Load every texture a kit references (suspends), keyed by texture id. */
export function useKitTextures(template: string, name: string, kit: Kit): Record<string, Texture> {
  const urls = useMemo(
    () => Object.fromEntries(Object.entries(kit.textures).map(([id, file]) => [id, kitUrl(template, name, file)])),
    [kit, template, name],
  )
  const textures = useTexture(urls) as Record<string, Texture>
  useLayoutEffect(() => {
    const list = Object.values(textures)
    for (const t of list) {
      t.colorSpace = SRGBColorSpace
      t.anisotropy = 4
      t.needsUpdate = true
      textureUsers.set(t, (textureUsers.get(t) ?? 0) + 1)
    }
    return () => {
      for (const t of list) {
        const n = (textureUsers.get(t) ?? 1) - 1
        if (n > 0) textureUsers.set(t, n)
        else {
          textureUsers.delete(t)
          t.dispose()
        }
      }
    }
  }, [textures])
  return textures
}

/** One ref per lit layer, for the glow sprites (passed to SelectiveBloom). */
export function useKitGlowRefs(kit: Kit): Record<string, RefObject<Mesh | null>> {
  return useMemo(
    () => Object.fromEntries(kit.layers.filter((l) => l.light).map((l) => [l.id, createRef<Mesh>()])),
    [kit],
  )
}

export function layerPlacement(layer: KitLayer, portrait: boolean) {
  return portrait && layer.portrait ? { ...layer, ...layer.portrait } : layer
}

interface KitLayersProps {
  kit: Kit
  textures: Record<string, Texture>
  rectAt: (z: number) => Rect
  portrait: boolean
  look: KitLook
  glowRefs: Record<string, RefObject<Mesh | null>>
}

interface PlacedLight {
  id: string
  x: number
  y: number
  z: number
  radius: number
  color: Color
  intensity: number
  flicker: number
  glowSize: number
  seed: number
}

/** Renders a kit's layers at their authored depths, plus lantern lights and glows. */
export function KitLayers({ kit, textures, rectAt, portrait, look, glowRefs }: KitLayersProps) {
  const placed = kit.layers.map((layer) => {
    const texture = textures[layer.texture]
    const placement = layerPlacement(layer, portrait)
    if (!texture || placement.hidden) return null
    const img = texture.image as { width: number; height: number }
    const box = placeInRect(rectAt(layer.z), placement, img.width / img.height)
    return { layer, texture, box }
  })

  const lights: PlacedLight[] = placed.flatMap((p, i) => {
    if (!p?.layer.light) return []
    return [placeLight(p.layer, p.box, i)]
  })

  return (
    <>
      {placed.map((p) => {
        if (!p) return null
        const { layer, texture, box } = p
        const tintAmount = layer.tint ?? 0
        return (
          <DepthLayer
            key={layer.id}
            texture={texture}
            z={layer.z}
            box={box}
            flip={layer.flip}
            tint={shadeHex(tintAmount > 0 ? mixHex('#ffffff', look.tint, tintAmount) : '#ffffff', layer.shade ?? 1)}
            fogColor={look.fogColor}
            fogMix={Math.min(1, (layer.fog ?? 0) + look.fogBoost * (layer.fog ?? 0))}
            sway={layer.sway ?? 0}
            wind={look.wind}
            rim={(layer.rim ?? 0) * look.rim}
            rimColor={look.rimColor}
            lightGain={look.lightGain}
          />
        )
      })}
      <LanternLights lights={lights} gain={look.lightGain} glowRefs={glowRefs} />
    </>
  )
}

function placeLight(layer: KitLayer, box: LayerBox, seed: number): PlacedLight {
  const l = layer.light!
  const dir = layer.flip ? -1 : 1
  return {
    id: layer.id,
    x: box.x + (l.u - 0.5) * box.w * dir,
    y: box.y + (l.v - 0.5) * box.h,
    z: layer.z + 0.3,
    radius: l.radius * box.h,
    color: new Color(l.color),
    intensity: l.intensity,
    flicker: l.flicker ?? 0,
    glowSize: (l.glow ?? 0.25) * box.h,
    seed: seed * 17.3,
  }
}

/**
 * Feeds the kit's lights into the shared layer-material uniforms every frame
 * (with candle flicker) and draws an additive glow sprite at each source.
 */
function LanternLights({
  lights,
  gain,
  glowRefs,
}: {
  lights: PlacedLight[]
  gain: number
  glowRefs: Record<string, RefObject<Mesh | null>>
}) {
  const chapter = useChapter()
  const materials = useMemo(
    () =>
      lights.map(
        (l) =>
          new MeshBasicMaterial({
            map: getPlaceholder('glow'),
            color: l.color.clone().multiplyScalar(2.2),
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            toneMapped: false,
          }),
      ),
    // Recreate only when the set of lights changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lights.map((l) => l.id + l.color.getHexString()).join()],
  )
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  useEffect(
    () => () => {
      chapter.lights.uLightCount.value = 0
    },
    [],
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const reduced = storyState.reducedMotion
    const n = Math.min(lights.length, MAX_LIGHTS)
    chapter.lights.uLightCount.value = n
    for (let i = 0; i < n; i++) {
      const l = lights[i]!
      // Layered sines ≈ candle flicker; gentler under reduced motion.
      const f = l.flicker * (reduced ? 0.3 : 1)
      const wobble =
        0.55 * Math.sin(t * 7.3 + l.seed) + 0.3 * Math.sin(t * 13.1 + l.seed * 2.1) + 0.15 * Math.sin(t * 23.7 + l.seed * 0.7)
      const k = l.intensity * gain * (1 - f * 0.5 + f * 0.5 * wobble) * (1 + chapter.intensity * 0.25)
      chapter.lights.uLightPos.value[i]!.set(l.x, l.y, l.z, l.radius)
      chapter.lights.uLightCol.value[i]!.set(l.color.r * k, l.color.g * k, l.color.b * k)
      const m = materials[i]
      if (m) m.opacity = Math.min(1, 0.55 + 0.45 * (k / Math.max(0.001, l.intensity * gain)))
    }
  })

  return (
    <>
      {lights.map((l, i) => (
        <mesh key={l.id} ref={glowRefs[l.id]} position={[l.x, l.y, l.z + 0.05]} scale={l.glowSize} material={materials[i]}>
          <planeGeometry />
        </mesh>
      ))}
    </>
  )
}

function shadeHex(hex: string, k: number) {
  return k === 1 ? hex : mixHex('#000000', hex, k)
}

function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}
