import { CanvasTexture, SRGBColorSpace, type Texture } from 'three'

/**
 * Small generated textures the procedural layers need at runtime (the painted
 * scene elements come from the art kit). Cached and disposed with the chapter.
 */
export type PlaceholderKind = 'glow'

const cache = new Map<string, Texture>()

export function getPlaceholder(kind: PlaceholderKind): Texture {
  let tex = cache.get(kind)
  if (!tex) {
    tex = new CanvasTexture(DRAW[kind]())
    tex.colorSpace = SRGBColorSpace
    cache.set(kind, tex)
  }
  return tex
}

export function disposePlaceholders() {
  cache.forEach((t) => t.dispose())
  cache.clear()
}

function drawGlow(): HTMLCanvasElement {
  const S = 256
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.08)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return canvas
}

const DRAW: Record<PlaceholderKind, () => HTMLCanvasElement> = {
  glow: drawGlow,
}
