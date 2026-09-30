/*
 * Code-painted placeholder elements for the Peak template (generic mountains:
 * any range, summit or volcano; no landmarks, no flags). Same pipeline as the
 * other painters: shaped silhouettes, painterly dabs, then the shared finish()
 * pass. Rock and snow are painted in neutral mid values so the kit's per-time
 * tint and rim grade them to moonlight, alpenglow or clear day.
 * Registers window.ARTKIT.peak.
 */
;(function () {
  const { mulberry32, makeNoise, makeCanvas, hsl, clamp, lerp, dab, finish } = window.ARTKIT_LIB

  const SNOW_RIM = [236, 242, 255]

  /** Ridged noise 0..1: sharp crests where fbm crosses its midline. */
  const ridged = (n, x, y, oct) => 1 - Math.abs(n.fbm(x, y, oct) * 2 - 1)

  /**
   * A mountain silhouette y(u) in pixels: a sum of peaked cones (each [u, height 0..1, width])
   * plus ridged jaggedness, so crests are pointed and shoulders step down.
   */
  function ridgeLine(n, W, H, seed, { peaks, base, jag }) {
    return (u) => {
      let h = 0
      for (const [pu, ph, pw] of peaks) {
        const d = Math.abs(u - pu) / pw
        h = Math.max(h, ph * Math.max(0, 1 - Math.pow(d, 0.85)))
      }
      h += (ridged(n, u * 9, seed, 4) - 0.5) * jag + (n.fbm(u * 40, seed + 5, 2) - 0.5) * jag * 0.35
      return H * (1 - base - clamp(h, 0, 1) * (1 - base))
    }
  }

  /**
   * Paint a range per pixel: rock with strata and ridged gullies, snow above a noisy
   * snowline that runs down the gullies, faces turned left in shadow, then brush texture.
   */
  function paintRange(W, H, seed, opts) {
    const { rock, snow, snowline, gully = 1, faceShade = 0.35, texture = 1 } = opts
    const { c, ctx } = makeCanvas(W, H)
    const n = makeNoise(seed)
    const rand = mulberry32(seed)
    const yAt = ridgeLine(n, W, H, seed, opts)
    const ridge = new Float32Array(W)
    for (let x = 0; x < W; x++) ridge[x] = yAt(x / W)
    // Face orientation from the smoothed ridge slope: rising to the right = face turned left (shade).
    const face = new Float32Array(W)
    const win = Math.max(10, Math.round(W * 0.03))
    for (let x = 0; x < W; x++) {
      const a = ridge[Math.max(0, x - win)]
      const b = ridge[Math.min(W - 1, x + win)]
      face[x] = clamp((a - b) / (win * 0.9), -1, 1) * 0.5 + 0.5 * Math.sign(a - b) * Math.min(1, Math.abs(a - b) / (win * 0.3)) // >0: ridge climbs to the right
    }
    const img = ctx.createImageData(W, H)
    const d = img.data
    const [rh, rs, rl] = rock
    const [sh, ss, sl] = snow
    for (let x = 0; x < W; x++) {
      const top = ridge[x]
      for (let y = Math.max(0, Math.floor(top)); y < H; y++) {
        const i = (y * W + x) * 4
        const alt = 1 - y / H
        const depth = (y - top) / H
        // Gullies: vertical ridged streaks that grow with depth below the crest.
        const g = ridged(n, x / W * 15 + y / H * 2, y / H * 2.4 + seed, 3)
        const gul = Math.pow(g, 6) * gully
        const strata = n.fbm(x / W * 4, y / H * 30 + seed, 2)
        const line = snowline + (n.fbm(x / W * 12, seed + 11, 3) - 0.5) * 0.12 - gul * 0.18 * clamp(depth * 6, 0, 1)
        const isSnow = alt > line && depth < 0.55
        const shade = face[x] > 0 ? face[x] * faceShade * clamp(1 - depth * 1.5, 0.3, 1) : 0
        let h, s, l
        if (isSnow) {
          const edge = clamp((alt - line) * 30, 0, 1) // soft snow margin
          h = lerp(rh, sh, edge)
          s = lerp(rs, ss, edge)
          l = lerp(rl + 8, sl, edge) - shade * 100 * 0.7 - gul * 14
        } else {
          h = rh + (strata - 0.5) * 10
          s = rs
          l = rl + (strata - 0.5) * 12 - gul * 12 - shade * 100 * 0.45 - depth * 10
        }
        const [r, gg, b] = hslToRgb(h, s, clamp(l, 3, 97))
        d[i] = r
        d[i + 1] = gg
        d[i + 2] = b
        // Anti-aliased crest.
        d[i + 3] = y === Math.floor(top) ? Math.round(255 * (1 - (top - Math.floor(top)))) : 255
      }
    }
    ctx.putImageData(img, 0, 0)
    // Painterly texture: slope-following strokes of light snow and dark rock.
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    const strokes = Math.round(W * H * 0.0009 * texture)
    for (let k = 0; k < strokes; k++) {
      const x = rand() * W
      const top = ridge[Math.floor(x)]
      const y = top + Math.pow(rand(), 1.4) * (H - top)
      const alt = 1 - y / H
      const lit = face[Math.floor(x)] <= 0
      const snowy = alt > snowline
      const col = snowy ? hsl(sh, ss, lit ? sl + 2 : sl - 18) : hsl(rh, rs, lit ? rl + 10 : rl - 10)
      const ang = Math.PI / 2 + (face[Math.floor(x)] > 0 ? -0.5 : 0.5) + (rand() - 0.5) * 0.3
      dab(ctx, x, y, 4 + rand() * 16, 1 + rand() * 2, ang, col, 0.18 + rand() * 0.2)
    }
    ctx.restore()
    return { c, ridge }
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360
    s /= 100
    l /= 100
    const k = (n) => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
  }

  /** Far range: pale, low contrast, many peaks, heavy snow (reads as distance through haze). */
  function rangeFar(seed = 401) {
    const W = 2800, H = 760
    const { c } = paintRange(W, H, seed, {
      peaks: [[0.08, 0.55, 0.12], [0.22, 0.72, 0.1], [0.36, 0.5, 0.09], [0.55, 0.62, 0.11], [0.7, 0.8, 0.1], [0.86, 0.58, 0.1], [0.97, 0.66, 0.08]],
      base: 0.08, jag: 0.14, rock: [220, 12, 52], snow: [215, 18, 90], snowline: 0.42, gully: 0.8, faceShade: 0.22, texture: 0.6,
    })
    return finish(c, { seed, rim: 0.5, rimWidth: 3, key: 0.25, mottle: 0.06, rimColor: SNOW_RIM, shadow: 0.1 })
  }

  /** The dominant central summit: one tall pyramidal peak with shoulders and deep snow couloirs. */
  function summit(seed = 411) {
    const W = 2000, H = 1400
    const { c } = paintRange(W, H, seed, {
      peaks: [[0.5, 0.97, 0.36], [0.3, 0.6, 0.18], [0.72, 0.66, 0.2], [0.12, 0.34, 0.14], [0.9, 0.38, 0.14]],
      base: 0.02, jag: 0.1, rock: [215, 14, 40], snow: [212, 16, 92], snowline: 0.45, gully: 1.2, faceShade: 0.42, texture: 1,
    })
    return finish(c, { seed, rim: 1, rimWidth: 5, key: 0.4, mottle: 0.1, rimColor: SNOW_RIM, shadow: 0.25 })
  }

  /** Mid range: darker rock, snow only on the tops, sits in front of the summit's base. */
  function rangeMid(seed = 421) {
    const W = 2800, H = 820
    const { c } = paintRange(W, H, seed, {
      peaks: [[0.06, 0.7, 0.14], [0.24, 0.55, 0.12], [0.42, 0.36, 0.1], [0.62, 0.4, 0.1], [0.8, 0.62, 0.12], [0.95, 0.74, 0.1]],
      base: 0.06, jag: 0.16, rock: [210, 12, 30], snow: [210, 14, 84], snowline: 0.66, gully: 1, faceShade: 0.4, texture: 1,
    })
    return finish(c, { seed, rim: 0.9, rimWidth: 4, key: 0.35, mottle: 0.12, rimColor: SNOW_RIM, shadow: 0.25 })
  }

  /** One pine: layered drooping tiers of needle dabs on a thin trunk, snow on the upper tiers. */
  function pineShape(ctx, cx, baseY, h, rand, { snow = 0.35, dark = 16 } = {}) {
    const w = h * 0.34
    ctx.fillStyle = hsl(25, 30, 14)
    ctx.fillRect(cx - h * 0.012, baseY - h * 0.2, h * 0.024, h * 0.2)
    const tiers = 9 + Math.floor(rand() * 4)
    for (let t = 0; t < tiers; t++) {
      const k = t / (tiers - 1) // 0 bottom .. 1 top
      const ty = baseY - h * (0.1 + 0.88 * k)
      const tw = w * (1 - k * 0.92) * (0.85 + rand() * 0.3)
      const needles = Math.round(40 + tw * 0.8)
      for (let i = 0; i < needles; i++) {
        const side = rand() < 0.5 ? -1 : 1
        const r = Math.pow(rand(), 0.7) * tw
        const x = cx + side * r
        const y = ty + (r / tw) * h * 0.06 + (rand() - 0.5) * h * 0.025 // tips droop
        const lit = side > 0
        dab(ctx, x, y, 3 + rand() * h * 0.018, 1 + rand() * 2, side * (0.25 + rand() * 0.3), hsl(150 + rand() * 20, 28, dark + (lit ? 8 : 0) + rand() * 6), 0.85)
      }
      if (k > 0.25 && rand() < snow + k * 0.3) {
        for (let i = 0; i < tw * 0.5; i++) {
          const x = cx + (rand() - 0.4) * tw * 1.4
          dab(ctx, x, ty - h * 0.006, 3 + rand() * 8, 1.5 + rand() * 1.5, (rand() - 0.5) * 0.3, hsl(210, 20, 82 + rand() * 12), 0.8)
        }
      }
    }
  }

  function pine(seed, snow) {
    const W = 520, H = 1300
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    pineShape(ctx, W / 2, H - 4, H - 20, rand, { snow })
    return finish(c, { seed, rim: 0.8, rimWidth: 3, key: 0.3, mottle: 0.08, rimColor: SNOW_RIM, shadow: 0.2 })
  }

  /** Lower slopes: a rolling hill line thick with small pines, snow patches between them. */
  function slopeForest(seed = 441) {
    const W = 2800, H = 760
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const yAt = (u) => H * (0.42 + 0.22 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2.2 + 1.2)) + (n.fbm(u * 5, seed, 3) - 0.5) * 0.18)
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, yAt(x / W))
    ctx.lineTo(W, H)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, H * 0.3, 0, H)
    g.addColorStop(0, hsl(205, 14, 48))
    g.addColorStop(1, hsl(200, 16, 26))
    ctx.fillStyle = g
    ctx.fill()
    // Pines: small and dense along the hill, back to front so nearer trees overlap.
    const trees = []
    for (let i = 0; i < 520; i++) {
      const u = rand()
      const y = yAt(u) + Math.pow(rand(), 1.6) * (H - yAt(u)) * 0.95
      trees.push([u * W, y])
    }
    trees.sort((a, b) => a[1] - b[1])
    for (const [x, y] of trees) {
      const near = (y - H * 0.3) / (H * 0.7)
      pineShape(ctx, x, y + 6, 40 + near * 120 + rand() * 30, rand, { snow: 0.25, dark: 12 + (1 - near) * 10 })
    }
    return finish(c, { seed, rim: 0.7, rimWidth: 3, key: 0.3, mottle: 0.1, rimColor: SNOW_RIM, shadow: 0.2 })
  }

  /** Foreground: a broken rock ledge rising on the left, snow lying on its flat steps. */
  function ledge(seed = 451) {
    const W = 2200, H = 1000
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    // Stepped profile: high on the left, dropping in ledges to the right.
    const yAt = (u) => {
      const steps = Math.floor(u * 5) / 5
      const base = 0.12 + Math.pow(u, 1.3) * 0.7 + steps * 0.05
      return H * clamp(base + (n.fbm(u * 14, seed, 3) - 0.5) * 0.08, 0.05, 0.98)
    }
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 3) ctx.lineTo(x, yAt(x / W))
    ctx.lineTo(W, H)
    ctx.closePath()
    ctx.fillStyle = hsl(215, 10, 22)
    ctx.fill()
    ctx.save()
    ctx.clip()
    // Blocky facets and cracks.
    for (let i = 0; i < 1800; i++) {
      const u = rand()
      const y = yAt(u) + rand() * (H - yAt(u))
      const lit = rand() < 0.45
      dab(ctx, u * W, y, 20 + rand() * 70, 6 + rand() * 18, (rand() - 0.5) * 0.6, hsl(215, 10, lit ? 30 + rand() * 12 : 12 + rand() * 8), 0.35)
    }
    ctx.strokeStyle = 'rgba(8,10,14,0.55)'
    for (let i = 0; i < 70; i++) {
      const x = rand() * W
      let y = yAt(x / W) + rand() * 60
      ctx.lineWidth = 1 + rand() * 3
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let s = 0; s < 6; s++) {
        y += 20 + rand() * 50
        ctx.lineTo(x + (rand() - 0.5) * 40, y)
      }
      ctx.stroke()
    }
    // Snow resting along the top edge and on the steps.
    for (let x = 0; x < W; x += 2) {
      const y = yAt(x / W)
      const depth = 6 + n.fbm(x / W * 20, seed + 3, 2) * 30
      dab(ctx, x, y + depth * 0.4, 5, depth * 0.5, 0, hsl(212, 18, 86 + rand() * 8), 0.7)
    }
    ctx.restore()
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.35, mottle: 0.16, rimColor: SNOW_RIM, shadow: 0.3 })
  }

  /** A long soft cloud bank (sits between range layers; kit fog adds the drifting mist). */
  function cloudBank(seed = 461) {
    const W = 2800, H = 520
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    for (let i = 0; i < 1400; i++) {
      const u = rand()
      const puff = n.fbm(u * 6, seed, 3)
      if (rand() > puff * 1.4) continue
      const y = H * (0.55 + (rand() - 0.5) * 0.35 * puff)
      dab(ctx, u * W, y, 60 + rand() * 140, 20 + rand() * 50, (rand() - 0.5) * 0.15, hsl(215, 20, 88 + rand() * 8), 0.05 + rand() * 0.06)
    }
    return c
  }

  /** Wind-blown snow sprite sheet: two flakes, two streaks. */
  function snow(seed = 471) {
    const S = 128
    const { c, ctx } = makeCanvas(S * 4, S)
    const rand = mulberry32(seed)
    for (let cell = 0; cell < 4; cell++) {
      const ox = cell * S
      if (cell < 2) {
        for (let i = 0; i < 16; i++) dab(ctx, ox + S / 2 + (rand() - 0.5) * 14, S / 2 + (rand() - 0.5) * 14, 3 + rand() * 6, 3 + rand() * 6, 0, hsl(210, 30, 96), 0.35)
        dab(ctx, ox + S / 2, S / 2, 5, 5, 0, hsl(210, 30, 99), 0.9)
      } else {
        for (let i = 0; i < 40; i++) {
          const t = rand()
          dab(ctx, ox + 12 + t * 104, S / 2 + (rand() - 0.5) * 6, 3 + rand() * 4, 1.2 + rand(), 0, hsl(210, 30, 96), 0.5 * (1 - t) + 0.15)
        }
      }
    }
    return c
  }

  window.ARTKIT = window.ARTKIT || {}
  window.ARTKIT.peak = {
    'range-far': () => rangeFar(401),
    summit: () => summit(411),
    'range-mid': () => rangeMid(421),
    'slope-forest': () => slopeForest(441),
    pine: () => pine(431, 0.4),
    'pine-b': () => pine(437, 0.2),
    ledge: () => ledge(451),
    cloud: () => cloudBank(461),
    snow: () => snow(471),
  }
})()
