import { useTexture } from '@react-three/drei'
import { useLoader } from '@react-three/fiber'
import { useLayoutEffect, useMemo } from 'react'
import { FileLoader, SRGBColorSpace, type Texture } from 'three'
import type { Rect } from '../camera/paths'
import { DepthLayer, placeInRect } from '../layers/DepthLayer'
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

/** Load every texture a kit references (suspends), keyed by texture id. */
export function useKitTextures(template: string, name: string, kit: Kit): Record<string, Texture> {
  const urls = useMemo(
    () => Object.fromEntries(Object.entries(kit.textures).map(([id, file]) => [id, kitUrl(template, name, file)])),
    [kit, template, name],
  )
  const textures = useTexture(urls) as Record<string, Texture>
  useLayoutEffect(() => {
    for (const t of Object.values(textures)) {
      t.colorSpace = SRGBColorSpace
      t.anisotropy = 4
      t.needsUpdate = true
    }
  }, [textures])
  return textures
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
  /** Only layers with z in [minZ, maxZ) (lets the title sit between groups). */
  minZ?: number
  maxZ?: number
}

/** Renders a kit's layers at their authored depths, placed in the opening frame. */
export function KitLayers({ kit, textures, rectAt, portrait, look, minZ = -Infinity, maxZ = Infinity }: KitLayersProps) {
  return (
    <>
      {kit.layers
        .filter((l) => l.z >= minZ && l.z < maxZ)
        .map((layer) => {
          const texture = textures[layer.texture]
          if (!texture) return null
          const img = texture.image as { width: number; height: number }
          const box = placeInRect(rectAt(layer.z), layerPlacement(layer, portrait), img.width / img.height)
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
