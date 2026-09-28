/*
 * Procedural "painted" art kit for the Threshold template (torii-night).
 * Plain browser script: runs in a real canvas (headless Edge via generate.mjs)
 * and registers window.ARTKIT. Every painter returns a canvas with alpha.
 *
 * Pipeline per element:
 *   1. silhouette with noise-perturbed edges
 *   2. thousands of translucent brush strokes (colour/value jitter, directional)
 *   3. image-space passes: fbm mottling, broad key light from the upper right,
 *      moonlit rim where the texel toward the light is empty, edge softening
 * Lighting is baked in image space, so a mirrored-geometry variant is still lit
 * from the upper right.
 */
;(function () {
  // ---------------------------------------------------------------- utils
  function mulberry32(seed) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function makeNoise(seed) {
    const rand = mulberry32(seed)
    const size = 256
    const table = new Float32Array(size * size)
    for (let i = 0; i < table.length; i++) table[i] = rand()
    const at = (x, y) => table[(y & 255) * size + (x & 255)]
    const noise = (x, y) => {
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const xf = x - xi
      const yf = y - yi
      const u = xf * xf * (3 - 2 * xf)
      const v = yf * yf * (3 - 2 * yf)
      const a = at(xi, yi)
      const b = at(xi + 1, yi)
      const c = at(xi, yi + 1)
      const d = at(xi + 1, yi + 1)
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
    }
    const fbm = (x, y, oct = 5) => {
      let s = 0
      let amp = 0.5
      let f = 1
      let norm = 0
      for (let o = 0; o < oct; o++) {
        s += amp * noise(x * f, y * f)
        norm += amp
        f *= 2.03
        amp *= 0.5
      }
      return s / norm
    }
    return { noise, fbm }
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return { c, ctx: c.getContext('2d') }
  }

  const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const lerp = (a, b, t) => a + (b - a) * t

  /** One painterly dab: a rotated soft ellipse, optionally with bristle lines. */
  function dab(ctx, x, y, len, w, ang, color, alpha, bristles = 0, rand = Math.random) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(ang)
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(0, 0, len / 2, w / 2, 0, 0, Math.PI * 2)
    ctx.fill()
    if (bristles) {
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(0.6, w / 6)
      for (let i = 0; i < bristles; i++) {
        const off = (rand() - 0.5) * w
        ctx.globalAlpha = alpha * (0.4 + rand() * 0.6)
        ctx.beginPath()
        ctx.moveTo(-len / 2 + rand() * len * 0.2, off)
        ctx.lineTo(len / 2 - rand() * len * 0.2, off + (rand() - 0.5) * 2)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  /** Tapered blade from (x, y) with height h, lean and curl. */
  function blade(ctx, x, y, h, w, lean, color, alpha) {
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    const tx = x + lean
    const ty = y - h
    ctx.beginPath()
    ctx.moveTo(x - w, y)
    ctx.quadraticCurveTo(x - w * 0.4 + lean * 0.35, y - h * 0.55, tx, ty)
    ctx.quadraticCurveTo(x + w * 0.4 + lean * 0.35, y - h * 0.55, x + w, y)
    ctx.closePath()
    ctx.fill()
  }

  /** Closed noisy blob path (for rocks, bushes, clumps). */
  function blobPath(ctx, cx, cy, rx, ry, rough, n, noise, seed, flatBottom = false) {
    ctx.beginPath()
    const steps = 96
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const k = 1 + rough * (n.fbm(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7 + seed, 4) - 0.5) * 2
      let x = cx + Math.cos(a) * rx * k
      let y = cy + Math.sin(a) * ry * k
      if (flatBottom && y > cy) y = cy + (y - cy) * 0.25
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }

  // ------------------------------------------------------ image-space passes
  /**
   * Finishing pass shared by every element:
   *  - fbm mottling (paper/pigment texture)
   *  - key light: brighter toward the upper right of the element's bbox
   *  - rim: texel toward the light (up-right) is transparent → add rim colour
   *  - atmospheric perspective: blend toward haze colour by `haze`
   */
  function finish(c, opts) {
    const {
      seed = 1,
      mottle = 0.18,
      mottleScale = 0.012,
      key = 0.35,
      rim = 0.9,
      rimWidth = 5,
      rimColor = [196, 208, 255],
      haze = 0,
      hazeColor = [40, 48, 78],
      shadow = 0.35,
    } = opts
    const ctx = c.getContext('2d')
    const { width: W, height: H } = c
    const img = ctx.getImageData(0, 0, W, H)
    const d = img.data
    const n = makeNoise(seed * 7 + 3)
    const alphaAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(y * W + x) * 4 + 3] / 255)

    // bbox of painted pixels, for the key-light gradient
    let minX = W, minY = H, maxX = 0, maxY = 0
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x += 2)
        if (d[(y * W + x) * 4 + 3] > 20) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
    const bw = Math.max(1, maxX - minX)
    const bh = Math.max(1, maxY - minY)

    // precompute rim from a copy of the alpha channel
    const A = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) A[i] = d[i * 4 + 3] / 255
    const r = rimWidth

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const a = A[y * W + x]
        if (a <= 0.004) continue
        let R = d[i], G = d[i + 1], B = d[i + 2]

        // mottling: two octaves, one broad and one fine "pigment"
        const m = (n.fbm(x * mottleScale, y * mottleScale, 4) - 0.5) * 2
        const f = (n.noise(x * 0.35, y * 0.35) - 0.5) * 2
        const mm = 1 + mottle * m + mottle * 0.35 * f
        R *= mm; G *= mm; B *= mm

        // key light from upper right, core shadow lower left
        const u = (x - minX) / bw
        const v = (y - minY) / bh
        const lit = clamp(u * 0.6 + (1 - v) * 0.7 - 0.45, -0.6, 0.8)
        const kl = lit > 0 ? 1 + key * lit : 1 + shadow * lit
        R *= kl; G *= kl; B *= kl

        // rim: sample several texels toward the light
        if (rim > 0) {
          let open = 0
          for (let s = 1; s <= r; s++) {
            const sx = x + Math.round(s * 0.8)
            const sy = y - s
            const sa = sx >= W || sy < 0 ? 0 : A[sy * W + sx]
            open = Math.max(open, (1 - sa) * (1 - (s - 1) / r))
          }
          const k = open * rim * a
          R = lerp(R, rimColor[0], k * 0.85)
          G = lerp(G, rimColor[1], k * 0.85)
          B = lerp(B, rimColor[2], k * 0.85)
        }

        if (haze > 0) {
          R = lerp(R, hazeColor[0], haze)
          G = lerp(G, hazeColor[1], haze)
          B = lerp(B, hazeColor[2], haze)
        }

        d[i] = clamp(R, 0, 255)
        d[i + 1] = clamp(G, 0, 255)
        d[i + 2] = clamp(B, 0, 255)
      }
    }
    ctx.putImageData(img, 0, 0)
    void alphaAt
    return c
  }

  // ================================================================ painters

  /** Grassy mound with a ragged, blade-fringed crest. */
  function hill(seed = 11) {
    const W = 2048, H = 768
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const crest = (u) =>
      H * (0.42 - 0.26 * Math.exp(-(((u - 0.52) / 0.3) ** 2)) + 0.05 * (n.fbm(u * 5, 1.3, 5) - 0.5))

    // body
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, crest(x / W))
    ctx.lineTo(W, H)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, H * 0.15, 0, H)
    g.addColorStop(0, hsl(222, 26, 17))
    g.addColorStop(1, hsl(228, 34, 6))
    ctx.fillStyle = g
    ctx.fill()

    // brushwork inside the body
    ctx.save()
    ctx.clip()
    for (let i = 0; i < 16000; i++) {
      const u = rand()
      const x = u * W
      const top = crest(u)
      const y = top + Math.pow(rand(), 1.3) * (H - top)
      const depth = (y - top) / (H - top)
      const l = lerp(20, 5, depth) + (rand() - 0.5) * 6
      dab(ctx, x, y, 14 + rand() * 34, 3 + rand() * 6, -0.25 + rand() * 0.5 - 0.4, hsl(215 + rand() * 20, 22 + rand() * 18, l), 0.18 + rand() * 0.25, rand() < 0.25 ? 3 : 0, rand)
    }
    ctx.restore()

    // grass fringe along the crest
    for (let i = 0; i < 5200; i++) {
      const u = rand()
      const x = u * W
      const base = crest(u) + 6 + rand() * 22
      const h = 18 + Math.pow(rand(), 2) * 70
      blade(ctx, x, base, h, 1.4 + rand() * 2.4, (rand() - 0.5) * h * 0.6, hsl(215 + rand() * 25, 25, 6 + rand() * 16), 0.55 + rand() * 0.45)
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 1, rimWidth: 6, key: 0.4, mottle: 0.16 })
  }

  /** Tall grass tufts with a few pampas plumes (foreground frame). */
  function grass(seed = 23) {
    const W = 2048, H = 640
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    // dense dark base so nothing behind shows through at the bottom
    ctx.fillStyle = hsl(228, 34, 4)
    ctx.fillRect(0, H - 60, W, 60)
    const tufts = 90
    for (let t = 0; t < tufts; t++) {
      const cx = (t / tufts) * W + (rand() - 0.5) * 60
      const tall = 0.35 + rand() * 0.6
      const blades = 50 + Math.floor(rand() * 50)
      for (let b = 0; b < blades; b++) {
        const x = cx + (rand() - 0.5) * 70
        const h = H * tall * (0.4 + rand() * 0.6)
        const lean = (x - cx) * 1.3 + (rand() - 0.5) * h * 0.5
        const l = 3 + rand() * 13
        blade(ctx, x, H + 4, h, 1.6 + rand() * 3.2, lean, hsl(212 + rand() * 30, 24 + rand() * 14, l), 0.7 + rand() * 0.3)
      }
    }
    // pampas plumes: arching stems with feathery heads
    for (let p = 0; p < 9; p++) {
      const x = 80 + rand() * (W - 160)
      const h = H * (0.7 + rand() * 0.28)
      const lean = (rand() - 0.5) * 160
      ctx.strokeStyle = hsl(220, 15, 20)
      ctx.globalAlpha = 0.9
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x, H)
      ctx.quadraticCurveTo(x + lean * 0.3, H - h * 0.6, x + lean, H - h)
      ctx.stroke()
      const hx = x + lean
      const hy = H - h
      for (let f = 0; f < 260; f++) {
        const t = rand()
        const px = hx - lean * 0.12 * t + (rand() - 0.5) * 16 * (1 - t * 0.5)
        const py = hy + t * h * 0.22
        dab(ctx, px, py, 10 + rand() * 18, 1.5 + rand() * 2, 1.2 + (rand() - 0.5) * 0.9, hsl(35, 18, 42 + rand() * 25), 0.25 + rand() * 0.35)
      }
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 1.1, rimWidth: 4, key: 0.3, mottle: 0.12, shadow: 0.25 })
  }

  /** Japanese cedar: straight trunk, drooping tiers of needle masses. */
  function cedar(seed = 31, mirror = false) {
    const W = 640, H = 1600
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    ctx.save()
    if (mirror) {
      ctx.translate(W, 0)
      ctx.scale(-1, 1)
    }
    const cx = W * 0.5
    // trunk
    ctx.fillStyle = hsl(18, 18, 9)
    ctx.beginPath()
    ctx.moveTo(cx - 20, H)
    ctx.lineTo(cx - 7, H * 0.08)
    ctx.lineTo(cx + 7, H * 0.08)
    ctx.lineTo(cx + 22, H)
    ctx.closePath()
    ctx.fill()
    for (let i = 0; i < 500; i++) {
      const y = H * 0.1 + rand() * H * 0.9
      const w = lerp(7, 20, y / H)
      dab(ctx, cx + (rand() - 0.5) * w * 1.6, y, 30 + rand() * 50, 2, Math.PI / 2 + (rand() - 0.5) * 0.08, hsl(20, 15, 5 + rand() * 12), 0.4)
    }
    // tiers, top to bottom
    const tiers = 14
    for (let t = 0; t < tiers; t++) {
      const k = t / (tiers - 1)
      const ty = H * lerp(0.04, 0.78, k) + (rand() - 0.5) * 20
      const spread = W * lerp(0.1, 0.48, Math.pow(k, 0.75)) * (0.85 + rand() * 0.3)
      const droop = lerp(50, 150, k)
      const count = Math.floor(lerp(900, 3400, k))
      for (let i = 0; i < count; i++) {
        const side = rand() < 0.5 ? -1 : 1
        const r = Math.pow(rand(), 0.7)
        const x = cx + side * r * spread
        const y = ty + r * r * droop + (rand() - 0.5) * lerp(40, 110, 1 - r) - (1 - r) * 30
        const ang = side * (0.35 + r * 0.6) + Math.PI / 2 + (rand() - 0.5) * 0.5
        const l = 5 + rand() * 12 + (1 - r) * 3
        dab(ctx, x, y, 14 + rand() * 30, 3 + rand() * 6, ang, hsl(200 + rand() * 30, 22 + rand() * 12, l), 0.35 + rand() * 0.4, rand() < 0.3 ? 3 : 0, rand)
      }
    }
    ctx.restore()
    return finish(c, { seed, rim: 1.1, rimWidth: 5, key: 0.45, mottle: 0.14 })
  }

  /** Cherry blossom branch entering from the left edge (foreground frame). */
  function branch(seed = 41) {
    const W = 1600, H = 900
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const segs = []
    function limb(x, y, ang, len, width, depth) {
      const steps = 14
      let px = x, py = y, a = ang
      for (let s = 0; s < steps; s++) {
        a += (n.noise(px * 0.008, py * 0.008) - 0.5) * 0.6 + (depth === 0 ? 0.012 : 0)
        if (py > H * 0.78) a -= 0.25 // steer up away from the bottom edge
        if (py < H * 0.06) a += 0.25
        a = clamp(a, -0.9, 1.1)
        const nx = px + Math.cos(a) * (len / steps)
        const ny = py + Math.sin(a) * (len / steps)
        const w = width * (1 - s / steps * 0.7)
        if (nx > W * 0.94 || ny > H * 0.95 || ny < 4) break
        segs.push([px, py, nx, ny, w])
        if (depth < 3 && rand() < 0.3 && s > 1) limb(nx, ny, clamp(a + (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.5), -0.9, 1.1), len * (0.3 + rand() * 0.22), w * 0.6, depth + 1)
        px = nx
        py = ny
      }
      return [px, py]
    }
    limb(-20, H * 0.2, 0.08, W * 0.8, 46, 0)
    limb(-20, H * 0.06, 0.36, W * 0.5, 24, 1)
    // bark
    ctx.lineCap = 'round'
    for (const [x0, y0, x1, y1, w] of segs) {
      ctx.strokeStyle = hsl(15, 14, 7)
      ctx.lineWidth = w
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      for (let k = 0; k < 3; k++) {
        const t = rand()
        dab(ctx, lerp(x0, x1, t), lerp(y0, y1, t) + (rand() - 0.5) * w * 0.6, w * 1.2, Math.max(1, w * 0.15), Math.atan2(y1 - y0, x1 - x0), hsl(18, 12, 12 + rand() * 12), 0.5)
      }
    }
    // blossom clusters along thinner limbs
    for (const [x0, y0, x1, y1, w] of segs) {
      if (w > 26 || rand() > 0.7) continue
      const clusters = 1 + Math.floor(rand() * 2)
      for (let q = 0; q < clusters; q++) {
        const t = rand()
        const cx = lerp(x0, x1, t) + (rand() - 0.5) * 20
        const cy = lerp(y0, y1, t) + (rand() - 0.2) * 24
        const flowers = 4 + Math.floor(rand() * 7)
        for (let f = 0; f < flowers; f++) {
          const fx = cx + (rand() - 0.5) * 46
          const fy = cy + (rand() - 0.5) * 34
          const r = 5 + rand() * 7
          const rot = rand() * Math.PI
          const light = 60 + rand() * 20
          for (let p = 0; p < 5; p++) {
            const a = rot + (p / 5) * Math.PI * 2
            dab(ctx, fx + Math.cos(a) * r * 0.7, fy + Math.sin(a) * r * 0.7, r * 1.25, r * 0.95, a, hsl(345 + rand() * 12, 55 + rand() * 20, light), 0.85)
          }
          dab(ctx, fx, fy, r * 0.5, r * 0.5, 0, hsl(340, 60, 38), 0.9)
        }
      }
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 0.9, rimWidth: 4, key: 0.3, mottle: 0.12, rimColor: [255, 214, 222] })
  }

  /** 4-cell sprite sheet: two petals, a small vermilion leaf, a dark leaf. */
  function leaves(seed = 51) {
    const S = 128
    const { c, ctx } = makeCanvas(S * 4, S)
    const rand = mulberry32(seed)
    const petal = (ox, hue, l) => {
      ctx.save()
      ctx.translate(ox + S / 2, S / 2)
      ctx.rotate(-0.4)
      const g = ctx.createRadialGradient(-6, -8, 4, 0, 0, 48)
      g.addColorStop(0, hsl(hue, 70, l + 14))
      g.addColorStop(1, hsl(hue, 55, l - 6))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(0, 44)
      ctx.bezierCurveTo(40, 20, 34, -40, 8, -46)
      ctx.lineTo(0, -36) // notch
      ctx.lineTo(-8, -46)
      ctx.bezierCurveTo(-34, -40, -40, 20, 0, 44)
      ctx.fill()
      ctx.restore()
    }
    const leaf = (ox, hue, s, l) => {
      ctx.save()
      ctx.translate(ox + S / 2, S / 2)
      ctx.rotate(0.6)
      ctx.fillStyle = hsl(hue, s, l)
      ctx.beginPath()
      ctx.moveTo(0, 50)
      ctx.quadraticCurveTo(38, 0, 0, -50)
      ctx.quadraticCurveTo(-38, 0, 0, 50)
      ctx.fill()
      ctx.clip()
      ctx.strokeStyle = hsl(hue, s, l - 12)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, 48)
      ctx.lineTo(0, -46)
      ctx.stroke()
      for (let v = 0; v < 5; v++) {
        const y = -30 + v * 15
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(18 - v, y - 10)
        ctx.moveTo(0, y)
        ctx.lineTo(-18 + v, y - 10)
        ctx.stroke()
      }
      ctx.restore()
    }
    petal(0, 350, 70)
    petal(S, 340, 60)
    leaf(S * 2, 10, 68, 42)
    leaf(S * 3, 28, 45, 30)
    void rand
    return finish(c, { seed, rim: 0.6, rimWidth: 3, key: 0.3, mottle: 0.1, rimColor: [255, 236, 236] })
  }

  /** Rounded garden bush of leaf clumps. */
  function bush(seed = 61) {
    const W = 900, H = 560
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const cx = W / 2
    const clumps = 34
    for (let k = 0; k < clumps; k++) {
      // back-to-front: sample inside a dome, lower clumps drawn later (in front)
      const a = Math.PI + rand() * Math.PI
      const rr = Math.sqrt((k + 1) / clumps) * (0.6 + rand() * 0.4)
      const x = cx + Math.cos(a) * W * 0.34 * rr
      const y = H * 0.95 + Math.sin(a) * H * 0.66 * (1 - rr * 0.55)
      const r = 70 + rand() * 80
      blobPath(ctx, x, y, r, r * 0.8, 0.35, n, k * 3.1)
      ctx.fillStyle = hsl(210, 26, 8)
      ctx.globalAlpha = 1
      ctx.fill()
      for (let i = 0; i < 520; i++) {
        const t = rand() * Math.PI * 2
        const d = Math.sqrt(rand()) * r
        const px = x + Math.cos(t) * d
        const py = y + Math.sin(t) * d * 0.8
        dab(ctx, px, py, 8 + rand() * 12, 4 + rand() * 5, rand() * Math.PI, hsl(195 + rand() * 30, 22 + rand() * 14, 5 + rand() * 13 + (py < y ? 4 : 0)), 0.5 + rand() * 0.4)
      }
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 1, rimWidth: 5, key: 0.45, mottle: 0.14 })
  }

  /** Stone lantern (tōrō) with a lit fire-box window. */
  function lantern(seed = 71) {
    const W = 420, H = 820
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const cx = W / 2
    const stone = (l) => hsl(222, 8 + rand() * 6, l)
    const box = (x, y, w, h, l) => {
      ctx.fillStyle = stone(l)
      ctx.globalAlpha = 1
      ctx.fillRect(x - w / 2, y, w, h)
      for (let i = 0; i < w * h * 0.02; i++) {
        dab(ctx, x - w / 2 + rand() * w, y + rand() * h, 6 + rand() * 12, 2 + rand() * 3, (rand() - 0.5) * 0.5, stone(l - 8 + rand() * 18), 0.35)
      }
    }
    // base, pole, platform
    box(cx, H - 70, 230, 70, 22)
    box(cx, H - 110, 170, 40, 25)
    box(cx, H - 390, 70, 280, 24)
    box(cx, H - 450, 200, 60, 26)
    // fire box with windows
    box(cx, H - 590, 150, 140, 27)
    const wy = H - 565
    const g = ctx.createRadialGradient(cx, wy + 45, 4, cx, wy + 45, 70)
    g.addColorStop(0, hsl(44, 100, 82))
    g.addColorStop(0.5, hsl(34, 95, 58))
    g.addColorStop(1, hsl(22, 90, 30))
    ctx.fillStyle = g
    ctx.fillRect(cx - 42, wy, 84, 90)
    ctx.fillStyle = stone(18)
    ctx.fillRect(cx - 3, wy, 6, 90) // lattice
    ctx.fillRect(cx - 42, wy + 42, 84, 5)
    // roof: wide, curved, upturned corners
    ctx.fillStyle = stone(20)
    ctx.beginPath()
    ctx.moveTo(cx - 200, H - 598)
    ctx.quadraticCurveTo(cx - 120, H - 612, cx - 30, H - 690)
    ctx.lineTo(cx + 30, H - 690)
    ctx.quadraticCurveTo(cx + 120, H - 612, cx + 200, H - 598)
    ctx.quadraticCurveTo(cx + 150, H - 588, cx, H - 584)
    ctx.quadraticCurveTo(cx - 150, H - 588, cx - 200, H - 598)
    ctx.fill()
    for (let i = 0; i < 600; i++) {
      const u = rand() * 2 - 1
      dab(ctx, cx + u * 180, H - 600 - (1 - Math.abs(u)) * 80 * rand(), 10 + rand() * 20, 2 + rand() * 3, -u * 0.5, stone(14 + rand() * 20), 0.35)
    }
    // finial
    ctx.fillStyle = stone(24)
    ctx.beginPath()
    ctx.arc(cx, H - 715, 26, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(cx, H - 770)
    ctx.quadraticCurveTo(cx + 22, H - 735, cx, H - 725)
    ctx.quadraticCurveTo(cx - 22, H - 735, cx, H - 770)
    ctx.fill()
    // moss specks on top surfaces
    for (let i = 0; i < 400; i++) {
      const tops = [H - 70, H - 110, H - 450, H - 600]
      const y = tops[Math.floor(rand() * tops.length)] + rand() * 8
      dab(ctx, cx + (rand() - 0.5) * 200, y, 4 + rand() * 6, 2 + rand() * 3, 0, hsl(150, 22, 14 + rand() * 10), 0.6)
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.45, mottle: 0.2 })
  }

  /** Cluster of mossy boulders. */
  function rocks(seed = 81) {
    const W = 1200, H = 440
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const specs = [
      [0.26, 190, 150],
      [0.58, 260, 190],
      [0.82, 150, 110],
      [0.44, 110, 80],
    ]
    for (const [u, rx, ry] of specs) {
      const cx = u * W
      const cy = H - 10
      blobPath(ctx, cx, cy, rx, ry, 0.18, n, u * 17, true)
      ctx.save()
      ctx.clip()
      ctx.fillStyle = hsl(224, 10, 15)
      ctx.fillRect(cx - rx * 1.4, cy - ry * 1.4, rx * 2.8, ry * 2.8)
      // facets: angled strokes, lighter toward the upper right
      for (let i = 0; i < rx * ry * 0.06; i++) {
        const px = cx + (rand() - 0.5) * rx * 2.2
        const py = cy - rand() * ry * 1.2
        const lit = (px - cx) / rx * 0.5 + (cy - py) / ry * 0.6
        dab(ctx, px, py, 14 + rand() * 30, 4 + rand() * 8, -0.6 + rand() * 0.4, hsl(222, 8 + rand() * 6, 12 + lit * 12 + rand() * 6), 0.35, rand() < 0.3 ? 3 : 0, rand)
      }
      // moss cap
      for (let i = 0; i < rx * 3; i++) {
        const t = rand() * Math.PI
        const px = cx - Math.cos(t) * rx * 0.9 * rand()
        const py = cy - Math.sin(t) * ry * (0.75 + rand() * 0.25)
        dab(ctx, px, py, 6 + rand() * 12, 3 + rand() * 5, rand() * Math.PI, hsl(150 + rand() * 30, 25, 10 + rand() * 12), 0.55)
      }
      ctx.restore()
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 1.1, rimWidth: 5, key: 0.5, mottle: 0.2 })
  }

  /** Temple wall segment (tsuiji): plaster body under a tiled roof. */
  function wall(seed = 91) {
    const W = 1600, H = 520
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const roofY = 130
    // plaster
    ctx.fillStyle = hsl(225, 12, 22)
    ctx.fillRect(0, roofY + 30, W, H - roofY - 30)
    for (let i = 0; i < 5000; i++) {
      dab(ctx, rand() * W, roofY + 30 + rand() * (H - roofY - 30), 20 + rand() * 40, 4 + rand() * 8, (rand() - 0.5) * 0.3, hsl(225, 10, 16 + rand() * 14), 0.2)
    }
    // posts
    for (let x = 60; x < W; x += 380) {
      ctx.fillStyle = hsl(18, 20, 8)
      ctx.globalAlpha = 1
      ctx.fillRect(x, roofY + 30, 26, H - roofY - 30)
    }
    // eave shadow
    const sg = ctx.createLinearGradient(0, roofY + 30, 0, roofY + 110)
    sg.addColorStop(0, 'rgba(0,0,0,0.65)')
    sg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = sg
    ctx.fillRect(0, roofY + 30, W, 80)
    // roof: ridge + rows of round tiles
    ctx.fillStyle = hsl(225, 16, 8)
    ctx.beginPath()
    ctx.moveTo(0, roofY + 40)
    ctx.lineTo(0, roofY - 30)
    ctx.lineTo(W, roofY - 30)
    ctx.lineTo(W, roofY + 40)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(0, roofY - 70, W, 34) // ridge
    for (let x = 0; x < W; x += 22) {
      const l = 10 + rand() * 8
      ctx.fillStyle = hsl(222, 12, l)
      ctx.beginPath()
      ctx.roundRect(x + 2, roofY - 32, 16, 72, 8)
      ctx.fill()
      ctx.fillStyle = hsl(222, 12, l + 10)
      ctx.beginPath()
      ctx.arc(x + 10, roofY + 38, 8, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.3, mottle: 0.18 })
  }

  /** Vermilion torii with black kasagi and bases. */
  function torii(seed = 101) {
    const W = 1600, H = 1100
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const cx = W / 2
    const red = (l) => hsl(6 + rand() * 6, 68 + rand() * 12, l)
    const woodRect = (x, y, w, h, colorFn, l, vertical) => {
      ctx.globalAlpha = 1
      ctx.fillStyle = colorFn(l)
      ctx.fillRect(x, y, w, h)
      const count = w * h * 0.012
      for (let i = 0; i < count; i++) {
        const px = x + rand() * w
        const py = y + rand() * h
        dab(ctx, px, py, vertical ? 6 : 30 + rand() * 40, vertical ? 30 + rand() * 50 : 3, 0, colorFn(l - 6 + rand() * 12), 0.3)
      }
    }
    const pillarX = 360
    const pw = 70
    const top = 150
    // pillars (slight taper) + black nemaki bases
    for (const s of [-1, 1]) {
      const x = cx + s * pillarX - pw / 2
      woodRect(x, top + 60, pw, H - top - 60, red, 34, true)
      woodRect(x - 10, H - 110, pw + 20, 110, (l) => hsl(220, 8, l), 10, true)
      // side shading: left edge dark, right edge light
      const g = ctx.createLinearGradient(x, 0, x + pw, 0)
      g.addColorStop(0, 'rgba(0,0,0,0.45)')
      g.addColorStop(0.6, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(255,200,180,0.12)')
      ctx.fillStyle = g
      ctx.fillRect(x, top + 60, pw, H - top - 60)
    }
    // nuki (tie beam)
    woodRect(cx - 520, top + 250, 1040, 56, red, 32, false)
    // gakuzuka (central strut) + plaque
    woodRect(cx - 22, top + 110, 44, 150, red, 30, true)
    woodRect(cx - 55, top + 150, 110, 80, (l) => hsl(220, 10, l), 9, true)
    // shimaki
    woodRect(cx - 560, top + 60, 1120, 50, red, 36, false)
    // kasagi: black, upswept ends
    ctx.fillStyle = hsl(222, 12, 7)
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.moveTo(cx - 720, top - 40)
    ctx.quadraticCurveTo(cx, top + 30, cx + 720, top - 40)
    ctx.lineTo(cx + 690, top + 30)
    ctx.quadraticCurveTo(cx, top + 80, cx - 690, top + 30)
    ctx.closePath()
    ctx.fill()
    for (let i = 0; i < 1600; i++) {
      const u = rand() * 2 - 1
      const y = top + 20 - u * u * 60 + rand() * 40
      dab(ctx, cx + u * 700, y, 30 + rand() * 40, 3, u * 0.12, hsl(222, 10, 5 + rand() * 12), 0.35)
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 1, rimWidth: 5, key: 0.4, mottle: 0.16, rimColor: [255, 196, 184] })
  }


  /** Flat stepping stones receding along a path (perspective ellipses). */
  function stones(seed = 111) {
    const W = 1400, H = 460
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    // Far stones first (small, high), near stones last (large, low).
    const specs = [
      [0.52, 0.2, 70, 18], [0.47, 0.32, 95, 24], [0.54, 0.46, 125, 32], [0.45, 0.62, 165, 42], [0.53, 0.82, 215, 56],
    ]
    for (const [u, v, rx, ry] of specs) {
      const cx = u * W
      const cy = v * H
      // side (thickness) then top face
      blobPath(ctx, cx, cy + ry * 0.35, rx, ry, 0.12, n, u * 31)
      ctx.fillStyle = hsl(224, 12, 7)
      ctx.globalAlpha = 1
      ctx.fill()
      blobPath(ctx, cx, cy, rx, ry, 0.12, n, u * 31)
      ctx.save()
      ctx.clip()
      ctx.fillStyle = hsl(222, 9, 20)
      ctx.fillRect(cx - rx * 1.3, cy - ry * 1.3, rx * 2.6, ry * 2.6)
      for (let i = 0; i < rx * ry * 0.08; i++) {
        const px = cx + (rand() - 0.5) * rx * 2
        const py = cy + (rand() - 0.5) * ry * 2
        const lit = ((px - cx) / rx) * 0.4 - ((py - cy) / ry) * 0.5
        dab(ctx, px, py, 8 + rand() * 18, 2 + rand() * 4, (rand() - 0.5) * 0.4, hsl(222, 8, 16 + lit * 10 + rand() * 8), 0.35)
      }
      for (let i = 0; i < rx * 0.8; i++) {
        const a = rand() * Math.PI * 2
        dab(ctx, cx + Math.cos(a) * rx * 0.92, cy + Math.sin(a) * ry * 0.92, 5 + rand() * 8, 2 + rand() * 3, a, hsl(150, 24, 11 + rand() * 10), 0.6)
      }
      ctx.restore()
    }
    // grass tufts between stones
    for (let i = 0; i < 900; i++) {
      const x = rand() * W
      const y = H * (0.18 + rand() * 0.8)
      const h = 6 + (y / H) * 30 * rand()
      blade(ctx, x, y, h, 1 + rand() * 1.5, (rand() - 0.5) * h * 0.6, hsl(215 + rand() * 25, 22, 6 + rand() * 10), 0.7)
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 0.9, rimWidth: 4, key: 0.4, mottle: 0.18 })
  }

  /** Small garden pond: dark water with sky reflection, ripples, stone rim and reeds. */
  function pond(seed = 121) {
    const W = 1600, H = 560
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const cx = W / 2
    const cy = H * 0.58
    const rx = W * 0.44
    const ry = H * 0.3
    blobPath(ctx, cx, cy, rx, ry, 0.08, n, 3.3)
    ctx.save()
    ctx.clip()
    const g = ctx.createLinearGradient(0, cy - ry, 0, cy + ry)
    g.addColorStop(0, hsl(228, 30, 6))
    g.addColorStop(0.45, hsl(20, 35, 22)) // warm sky reflection band
    g.addColorStop(0.62, hsl(235, 25, 10))
    g.addColorStop(1, hsl(230, 30, 4))
    ctx.fillStyle = g
    ctx.fillRect(cx - rx * 1.2, cy - ry * 1.2, rx * 2.4, ry * 2.4)
    // ripple streaks, brighter in the reflection band
    for (let i = 0; i < 1400; i++) {
      const y = cy - ry + rand() * ry * 2
      const band = Math.exp(-(((y - (cy - ry * 0.1)) / (ry * 0.25)) ** 2))
      dab(ctx, cx + (rand() - 0.5) * rx * 2, y, 20 + rand() * 60, 1 + rand() * 1.5, (rand() - 0.5) * 0.05, hsl(28, 50, 30 + band * 35), 0.08 + band * 0.25)
    }
    // lily pads
    for (let i = 0; i < 7; i++) {
      const px = cx + (rand() - 0.5) * rx * 1.4
      const py = cy + (rand() - 0.2) * ry * 1.2
      const r = 14 + rand() * 18
      ctx.globalAlpha = 0.95
      ctx.fillStyle = hsl(160, 25, 13 + rand() * 6)
      ctx.beginPath()
      ctx.ellipse(px, py, r, r * 0.38, 0, 0.3, Math.PI * 2 - 0.1)
      ctx.lineTo(px, py)
      ctx.fill()
    }
    ctx.restore()
    // stone rim
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + rand() * 0.05
      const k = 1 + (n.fbm(Math.cos(a) + 3.3, Math.sin(a) + 3.3, 4) - 0.5) * 0.16
      const px = cx + Math.cos(a) * rx * k
      const py = cy + Math.sin(a) * ry * k
      const r = 16 + rand() * 22
      blobPath(ctx, px, py, r, r * 0.6, 0.25, n, i * 1.7)
      ctx.globalAlpha = 1
      ctx.fillStyle = hsl(222, 9, 12 + rand() * 12 + (Math.sin(a) < 0 ? 0 : -4))
      ctx.fill()
    }
    // reeds on the left
    for (let i = 0; i < 160; i++) {
      const x = cx - rx * (0.75 + rand() * 0.3)
      const y = cy + ry * (0.1 + rand() * 0.6)
      const h = 60 + rand() * 140
      blade(ctx, x, y, h, 1.5 + rand() * 2, (rand() - 0.3) * 30, hsl(80 + rand() * 60, 20, 8 + rand() * 12), 0.85)
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 0.8, rimWidth: 3, key: 0.3, mottle: 0.1 })
  }

  /** Japanese maple: curving trunk, spreading limbs, clumps of red-orange leaves. */
  function maple(seed = 131) {
    const W = 1200, H = 1300
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const tips = []
    function limb(x, y, ang, len, width, depth) {
      const steps = 10
      let px = x, py = y, a = ang
      ctx.lineCap = 'round'
      for (let s = 0; s < steps; s++) {
        a += (n.noise(px * 0.01, py * 0.01) - 0.5) * 0.5
        const nx = px + Math.cos(a) * (len / steps)
        const ny = py + Math.sin(a) * (len / steps)
        if (nx < 20 || nx > W - 20 || ny < 20) break
        ctx.strokeStyle = hsl(15, 16, 8)
        ctx.globalAlpha = 1
        ctx.lineWidth = width * (1 - (s / steps) * 0.6)
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(nx, ny)
        ctx.stroke()
        if (depth < 4 && rand() < 0.28 && s > 2) limb(nx, ny, a + (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.5), len * 0.55, width * 0.6, depth + 1)
        px = nx
        py = ny
      }
      tips.push([px, py, depth])
    }
    limb(W * 0.5, H, -Math.PI / 2 + 0.08, H * 0.42, 48, 0)
    limb(W * 0.5, H * 0.72, -Math.PI / 2 - 0.9, H * 0.34, 26, 1)
    limb(W * 0.52, H * 0.64, -Math.PI / 2 + 0.95, H * 0.34, 24, 1)
    // leaf clumps around every tip (canopy), darker underneath
    for (const [tx, ty, depth] of tips) {
      const r = 60 + rand() * 80 - depth * 6
      for (let i = 0; i < 420; i++) {
        const t = rand() * Math.PI * 2
        const d = Math.sqrt(rand()) * r
        const px = tx + Math.cos(t) * d
        const py = ty + Math.sin(t) * d * 0.7
        const under = py > ty ? 1 : 0
        dab(ctx, px, py, 7 + rand() * 10, 5 + rand() * 6, rand() * Math.PI, hsl(4 + rand() * 24, 62 + rand() * 20, 22 + rand() * 20 - under * 10), 0.55 + rand() * 0.4)
      }
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 1, rimWidth: 5, key: 0.45, mottle: 0.14, rimColor: [255, 200, 160] })
  }

  window.ARTKIT = {
    hill: () => hill(11),
    grass: () => grass(23),
    'cedar-a': () => cedar(31, false),
    'cedar-b': () => cedar(37, true),
    branch: () => branch(41),
    leaves: () => leaves(51),
    bush: () => bush(61),
    lantern: () => lantern(71),
    rocks: () => rocks(81),
    wall: () => wall(91),
    torii: () => torii(101),
    stones: () => stones(111),
    pond: () => pond(121),
    maple: () => maple(131),
  }
})()
