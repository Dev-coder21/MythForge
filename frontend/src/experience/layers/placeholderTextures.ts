import { CanvasTexture, SRGBColorSpace, type Texture } from 'three'

/**
 * Generated stand-ins for the painted art kits (EXPERIENCE_SPEC §2). Every
 * texture is greyscale + alpha so the layer tint drives the palette, exactly
 * like tintable kit layers will. Swap for real .webp layers later — DepthLayer
 * only ever receives a Texture.
 */
export type PlaceholderKind = 'range' | 'structure' | 'foliage' | 'grass' | 'glow'

const cache = new Map<string, Texture>()

export function getPlaceholder(kind: PlaceholderKind, variant = 'default'): Texture {
  const key = `${kind}:${variant}`
  let tex = cache.get(key)
  if (!tex) {
    tex = toTexture(DRAW[kind](variant))
    cache.set(key, tex)
  }
  return tex
}

export function disposePlaceholders() {
  cache.forEach((t) => t.dispose())
  cache.clear()
}

// ---------------------------------------------------------------------------

function toTexture(canvas: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  return { canvas, ctx }
}

/** Deterministic PRNG so placeholders look identical on every load. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeFbm1D(seed: number) {
  const rand = mulberry32(seed)
  const table = Array.from({ length: 512 }, rand)
  const noise = (x: number) => {
    const i = Math.floor(x)
    const f = x - i
    const u = f * f * (3 - 2 * f)
    const a = table[i & 511] ?? 0
    const b = table[(i + 1) & 511] ?? 0
    return a + (b - a) * u
  }
  return (x: number) => {
    let v = 0
    let amp = 0.5
    let freq = 1
    for (let o = 0; o < 5; o++) {
      v += amp * noise(x * freq)
      freq *= 2.1
      amp *= 0.5
    }
    return v / 0.97
  }
}

const grey = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`

// ---------------------------------------------------------------------------

function drawRange(): HTMLCanvasElement {
  const W = 2048
  const H = 1024
  const { canvas, ctx } = makeCanvas(W, H)
  const ridges = [
    { seed: 11, base: 0.6, amp: 0.3, freq: 3.2, top: 235, bottom: 190 },
    { seed: 23, base: 0.4, amp: 0.2, freq: 5.5, top: 205, bottom: 160 },
  ]
  for (const r of ridges) {
    const fbm = makeFbm1D(r.seed)
    let peak = H
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 4) {
      const n = fbm((x / W) * r.freq)
      const y = H - (r.base + r.amp * (n - 0.5) * 2) * H
      peak = Math.min(peak, y)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(W, H)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, peak, 0, H)
    g.addColorStop(0, grey(r.top))
    g.addColorStop(1, grey(r.bottom))
    ctx.fillStyle = g
    ctx.fill()
  }
  return canvas
}

function drawStructure(variant: string): HTMLCanvasElement {
  const W = 2048
  const H = 683
  const { canvas, ctx } = makeCanvas(W, H)
  const rand = mulberry32(variant.length * 97 + 5)
  const fbm = makeFbm1D(41)
  const hillY = (u: number) => H * (1 - (0.2 + 0.11 * Math.exp(-(((u - 0.5) / 0.3) ** 2)) + 0.03 * (fbm(u * 6) - 0.5)))

  // Cedars on the hill shoulders (drawn first, behind the hill edge).
  ctx.fillStyle = grey(95)
  for (let i = 0; i < 26; i++) {
    const side = i % 2 === 0 ? 0 : 1
    const u = side === 0 ? 0.04 + rand() * 0.3 : 0.66 + rand() * 0.3
    const x = u * W
    const base = hillY(u) + 10
    const h = H * (0.28 + rand() * 0.34)
    const w = h * (0.28 + rand() * 0.08)
    for (let tier = 0; tier < 5; tier++) {
      const t0 = tier / 5
      const tw = w * (1 - t0 * 0.75)
      const ty = base - h * t0 * 0.85
      ctx.beginPath()
      ctx.moveTo(x - tw / 2, ty)
      ctx.lineTo(x + tw / 2, ty)
      ctx.lineTo(x, ty - h * 0.38)
      ctx.closePath()
      ctx.fill()
    }
  }

  // Hill.
  ctx.fillStyle = grey(110)
  ctx.beginPath()
  ctx.moveTo(0, H)
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, hillY(x / W))
  ctx.lineTo(W, H)
  ctx.closePath()
  ctx.fill()

  if (variant === 'gate') drawTorii(ctx, W * 0.5, hillY(0.5) + 6, H * 0.64)
  return canvas
}

function drawTorii(ctx: CanvasRenderingContext2D, cx: number, groundY: number, height: number) {
  const w = height * 1.05
  const pillarX = w * 0.34
  const pillarW = height * 0.07
  const topY = groundY - height
  ctx.fillStyle = grey(255)

  // Pillars, slightly wider at the base.
  for (const dir of [-1, 1]) {
    const x = cx + dir * pillarX
    ctx.beginPath()
    ctx.moveTo(x - pillarW * 0.62, groundY)
    ctx.lineTo(x + pillarW * 0.62, groundY)
    ctx.lineTo(x + pillarW * 0.48, topY + height * 0.08)
    ctx.lineTo(x - pillarW * 0.48, topY + height * 0.08)
    ctx.closePath()
    ctx.fill()
  }

  // Kasagi: top beam with upswept ends.
  const beamH = height * 0.075
  const half = w * 0.62
  ctx.beginPath()
  ctx.moveTo(cx - half, topY - beamH * 0.9)
  ctx.quadraticCurveTo(cx, topY + beamH * 0.5, cx + half, topY - beamH * 0.9)
  ctx.lineTo(cx + half * 0.94, topY + beamH * 0.35)
  ctx.quadraticCurveTo(cx, topY + beamH * 1.6, cx - half * 0.94, topY + beamH * 0.35)
  ctx.closePath()
  ctx.fill()

  // Shimaki (second top beam).
  ctx.fillRect(cx - w * 0.5, topY + beamH * 1.05, w, beamH * 0.7)

  // Nuki (tie beam) + gakuzuka (centre strut).
  const nukiY = topY + height * 0.26
  ctx.fillRect(cx - w * 0.47, nukiY, w * 0.94, beamH * 0.8)
  ctx.fillRect(cx - pillarW * 0.35, topY + beamH * 1.7, pillarW * 0.7, nukiY - topY - beamH * 1.7)
}

function drawFoliage(): HTMLCanvasElement {
  const W = 2048
  const H = 1024
  const { canvas, ctx } = makeCanvas(W, H)
  const rand = mulberry32(77)

  // Side clumps: dense at the edges, thinning toward the centre.
  for (const side of [0, 1]) {
    for (let i = 0; i < 1400; i++) {
      const d = rand() ** 1.7 * 0.32 // distance from the edge, 0..0.32 of width
      const x = side === 0 ? d * W : W - d * W
      const maxY = H * (0.78 - d * 2.1)
      const y = H - rand() * Math.max(maxY, H * 0.06)
      const r = 8 + rand() * 30 * (1 - d)
      ctx.fillStyle = grey(55 + rand() * 60)
      ctx.beginPath()
      ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Overhanging branch from the top-left corner.
  ctx.strokeStyle = grey(60)
  ctx.lineCap = 'round'
  ctx.lineWidth = 16
  ctx.beginPath()
  ctx.moveTo(-20, H * 0.04)
  ctx.quadraticCurveTo(W * 0.22, H * 0.02, W * 0.42, H * 0.16)
  ctx.stroke()
  for (let i = 0; i < 520; i++) {
    const t = rand()
    const bx = (1 - t) * (1 - t) * -20 + 2 * (1 - t) * t * W * 0.22 + t * t * W * 0.42
    const by = (1 - t) * (1 - t) * H * 0.04 + 2 * (1 - t) * t * H * 0.02 + t * t * H * 0.16
    const x = bx + (rand() - 0.5) * 120 * (1 - t * 0.5)
    const y = by + rand() * 150 * (1 - t * 0.4)
    const r = 6 + rand() * 16
    ctx.fillStyle = grey(60 + rand() * 50)
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * 0.55, rand() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvas
}

function drawGrass(): HTMLCanvasElement {
  const W = 2048
  const H = 1024
  const { canvas, ctx } = makeCanvas(W, H)
  const rand = mulberry32(131)
  const fbm = makeFbm1D(7)
  const groundTop = (u: number) => H * (1 - 0.3 - 0.05 * (fbm(u * 4) - 0.5))

  // Solid ground so risen letters are fully hidden before they emerge.
  ctx.fillStyle = grey(38)
  ctx.beginPath()
  ctx.moveTo(0, H)
  for (let x = 0; x <= W; x += 8) ctx.lineTo(x, groundTop(x / W))
  ctx.lineTo(W, H)
  ctx.closePath()
  ctx.fill()

  // Rocks.
  for (const [u, s] of [
    [0.1, 1],
    [0.88, 0.8],
    [0.3, 0.45],
  ] as const) {
    const cx = u * W
    const cy = groundTop(u) + 20
    const rx = 190 * s
    const ry = 130 * s
    ctx.fillStyle = grey(58)
    ctx.beginPath()
    for (let a = 0; a <= Math.PI; a += 0.12) {
      const k = 1 + (rand() - 0.5) * 0.12
      ctx.lineTo(cx + Math.cos(a) * rx * k, cy - Math.sin(a) * ry * k)
    }
    ctx.closePath()
    ctx.fill()
  }

  // Blades, with a tall hump in the middle that cuts across the title.
  for (let i = 0; i < 3400; i++) {
    const u = rand()
    const x = u * W
    const base = groundTop(u) + 12
    const hump = 0.36 * Math.exp(-(((u - 0.5) / 0.17) ** 2))
    const h = H * (0.1 + rand() * 0.14 + hump * (0.7 + rand() * 0.3))
    const w = 3 + rand() * 5
    const lean = (rand() - 0.5) * h * 0.35
    ctx.fillStyle = grey(28 + rand() * 50)
    ctx.beginPath()
    ctx.moveTo(x - w, base)
    ctx.quadraticCurveTo(x - w * 0.3 + lean * 0.4, base - h * 0.6, x + lean, base - h)
    ctx.quadraticCurveTo(x + w * 0.3 + lean * 0.4, base - h * 0.6, x + w, base)
    ctx.closePath()
    ctx.fill()
  }
  return canvas
}

function drawGlow(): HTMLCanvasElement {
  const S = 256
  const { canvas, ctx } = makeCanvas(S, S)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.08)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return canvas
}

const DRAW: Record<PlaceholderKind, (variant: string) => HTMLCanvasElement> = {
  range: drawRange,
  structure: drawStructure,
  foliage: drawFoliage,
  grass: drawGrass,
  glow: drawGlow,
}
