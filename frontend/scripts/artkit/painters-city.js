/*
 * Code-painted placeholder elements for three generic templates:
 *   skyline (Old city): rooftops, chimneys, distant domes and spires, a paved plaza, lamp posts, birds
 *   ruin (Ancient ruins): hills, colonnades, a ruined arch, broken columns, fallen blocks, dry grass, dust
 *   harbor (Harbor): a low far skyline, moored boats, a ferry, a stone seawall promenade, gulls
 * No specific real building is depicted. Neutral mid tones; each kit's per-time sky grades them.
 * Registers window.ARTKIT.skyline, window.ARTKIT.ruin and window.ARTKIT.harbor.
 */
;(function () {
  const { mulberry32, makeNoise, makeCanvas, hsl, clamp, lerp, dab, finish } = window.ARTKIT_LIB

  const STONE_RIM = [250, 236, 214]

  // ------------------------------------------------------------------ shared shapes

  function rect(ctx, x, y, w, h, color, alpha = 1) {
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.fillRect(x, y, w, h)
    ctx.globalAlpha = 1
  }

  function poly(ctx, pts, color, alpha = 1) {
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
  }

  /** Painterly texture over whatever is already painted (source-atop keeps the silhouette). */
  function texture(ctx, W, H, rand, count, hue, sat, lMin, lMax, len = 14) {
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    for (let i = 0; i < count; i++) {
      dab(ctx, rand() * W, rand() * H, 3 + rand() * len, 1 + rand() * 2.5, (rand() - 0.5) * 0.4, hsl(hue + (rand() - 0.5) * 8, sat, lMin + rand() * (lMax - lMin)), 0.16 + rand() * 0.14)
    }
    ctx.restore()
  }

  /** Windows in a wall: a grid of small dark (or faintly lit) openings. */
  function windows(ctx, x, y, w, h, rand, size, litChance = 0.08) {
    const cols = Math.max(1, Math.floor(w / (size * 2.4)))
    const rows = Math.max(1, Math.floor(h / (size * 2.8)))
    const gx = w / cols
    const gy = h / rows
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rand() < 0.12) continue
        const lit = rand() < litChance
        rect(ctx, x + c * gx + gx * 0.3, y + r * gy + gy * 0.25, gx * 0.4, gy * 0.5, lit ? hsl(38, 70, 62) : hsl(215, 18, 16), lit ? 0.9 : 0.75)
      }
    }
  }

  function dome(ctx, cx, baseY, r, color, drumH = 0) {
    if (drumH) rect(ctx, cx - r * 0.8, baseY - drumH, r * 1.6, drumH, color)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(cx, baseY - drumH, r, r * 1.05, 0, Math.PI, 0)
    ctx.fill()
    rect(ctx, cx - r * 0.06, baseY - drumH - r * 1.35, r * 0.12, r * 0.35, color) // lantern + finial
  }

  function spire(ctx, cx, baseY, w, h, color) {
    rect(ctx, cx - w / 2, baseY - h * 0.55, w, h * 0.55, color)
    poly(ctx, [[cx - w * 0.6, baseY - h * 0.55], [cx, baseY - h], [cx + w * 0.6, baseY - h * 0.55]], color)
  }

  // ------------------------------------------------------------------ Old city (skyline)

  /** Distant skyline: blocks, generic domes and spires, very low contrast (reads through haze). */
  function cityFar(seed = 501) {
    const W = 2800, H = 700
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const base = H
    const col = hsl(222, 10, 58)
    let x = 0
    while (x < W) {
      const w = 60 + rand() * 140
      const h = 120 + rand() * 180
      rect(ctx, x, base - h, w + 2, h, col)
      if (rand() < 0.4) poly(ctx, [[x, base - h], [x + w / 2, base - h - 30 - rand() * 40], [x + w, base - h]], col)
      x += w
    }
    for (const [u, r] of [[0.18, 70], [0.52, 110], [0.81, 60]]) dome(ctx, u * W, base - 250, r, col, 40)
    for (const u of [0.1, 0.33, 0.44, 0.66, 0.92]) spire(ctx, u * W, base - 200, 22, 260 + rand() * 120, col)
    texture(ctx, W, H, rand, 2600, 222, 10, 50, 66)
    return finish(c, { seed, rim: 0.4, rimWidth: 3, key: 0.2, mottle: 0.06, rimColor: STONE_RIM, shadow: 0.1 })
  }

  /** A row of old houses: pitched roofs, chimneys, dormers and windows; `scale` sets how close. */
  function rooftops(seed, { W, H, scale, light, dark, lit }) {
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    let x = -20
    while (x < W) {
      const w = (140 + rand() * 160) * scale
      const wallH = (170 + rand() * 170) * scale
      const top = H - wallH
      const roofH = (70 + rand() * 90) * scale
      const wall = hsl(28 + rand() * 20, 16 + rand() * 12, light - rand() * 12)
      const roof = hsl(14 + rand() * 12, 30, dark + rand() * 10)
      rect(ctx, x, top, w + 1, wallH, wall)
      windows(ctx, x + w * 0.08, top + wallH * 0.12, w * 0.84, wallH * 0.8, rand, 12 * scale, lit)
      const ridge = rand() < 0.6
      if (ridge) poly(ctx, [[x - 8 * scale, top + 2], [x + w / 2, top - roofH], [x + w + 8 * scale, top + 2]], roof)
      else poly(ctx, [[x - 6 * scale, top + 2], [x + w * 0.15, top - roofH * 0.7], [x + w * 0.85, top - roofH * 0.7], [x + w + 6 * scale, top + 2]], roof)
      // chimneys
      const chim = 1 + Math.floor(rand() * 2)
      for (let k = 0; k < chim; k++) {
        const cx = x + w * (0.2 + rand() * 0.6)
        const ch = (40 + rand() * 50) * scale
        rect(ctx, cx, top - roofH * 0.55 - ch, 16 * scale, ch + roofH * 0.3, hsl(18, 18, dark + 8))
        rect(ctx, cx - 3 * scale, top - roofH * 0.55 - ch, 22 * scale, 6 * scale, hsl(18, 14, dark))
      }
      // roof tile strokes
      ctx.save()
      ctx.globalAlpha = 0.25
      ctx.strokeStyle = hsl(14, 20, dark - 8)
      for (let yy = top - roofH; yy < top; yy += 7 * scale) {
        ctx.beginPath()
        ctx.moveTo(x, yy + n.noise(x * 0.01, yy * 0.01) * 2)
        ctx.lineTo(x + w, yy)
        ctx.stroke()
      }
      ctx.restore()
      x += w - 4 * scale
    }
    texture(ctx, W, H, rand, Math.round(W * H * 0.0006), 24, 18, dark, light)
    return finish(c, { seed, rim: 0.8, rimWidth: 4, key: 0.35, mottle: 0.12, rimColor: STONE_RIM, shadow: 0.25 })
  }

  /** Foreground street: paving in perspective, curbs, a low wall on each side. */
  function plaza(seed = 531) {
    const W = 2800, H = 700
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, hsl(30, 10, 52))
    g.addColorStop(1, hsl(28, 12, 34))
    ctx.fillStyle = g
    ctx.fillRect(0, 60, W, H - 60)
    // setts in perspective: rows get taller toward the viewer
    let y = 60
    let row = 0
    while (y < H) {
      const rh = 8 + row * 3.2
      const cw = rh * 2.2
      const off = (row % 2) * cw * 0.5
      for (let x = -cw + off; x < W; x += cw) {
        const l = 38 + rand() * 16 + (y / H) * -6
        ctx.globalAlpha = 0.85
        ctx.fillStyle = hsl(28 + rand() * 10, 10, l)
        ctx.beginPath()
        ctx.roundRect(x + 1.5, y + 1.5, cw - 3, rh - 3, rh * 0.25)
        ctx.fill()
      }
      y += rh
      row++
    }
    ctx.globalAlpha = 1
    rect(ctx, 0, 40, W, 26, hsl(30, 8, 60)) // far curb catching light
    texture(ctx, W, H, rand, 3000, 28, 10, 30, 56, 18)
    return finish(c, { seed, rim: 0.5, rimWidth: 3, key: 0.3, mottle: 0.14, rimColor: STONE_RIM, shadow: 0.2 })
  }

  /** Cast-iron street lamp; the glass head is left bright for the kit's light glow. */
  function lamp(seed = 541) {
    const W = 360, H = 1400
    const { c, ctx } = makeCanvas(W, H)
    const iron = hsl(210, 12, 18)
    rect(ctx, W / 2 - 9, 220, 18, H - 300, iron) // post
    rect(ctx, W / 2 - 30, H - 90, 60, 90, iron) // base
    rect(ctx, W / 2 - 22, H - 130, 44, 44, iron)
    poly(ctx, [[W / 2 - 70, 150], [W / 2 + 70, 150], [W / 2 + 46, 60], [W / 2 - 46, 60]], iron) // cap
    poly(ctx, [[W / 2 - 52, 150], [W / 2 + 52, 150], [W / 2 + 40, 250], [W / 2 - 40, 250]], hsl(40, 70, 72)) // glass
    rect(ctx, W / 2 - 5, 150, 10, 100, iron)
    rect(ctx, W / 2 - 60, 250, 120, 14, iron)
    poly(ctx, [[W / 2 - 14, 60], [W / 2, 20], [W / 2 + 14, 60]], iron)
    return finish(c, { seed, rim: 0.7, rimWidth: 2, key: 0.3, mottle: 0.05, rimColor: STONE_RIM, shadow: 0.1 })
  }

  /** Bird sprite sheet: four wing poses (flapping flock seen from afar). */
  function birds(seed = 551) {
    const S = 128
    const { c, ctx } = makeCanvas(S * 4, S)
    ctx.strokeStyle = hsl(215, 14, 18)
    ctx.lineCap = 'round'
    for (let cell = 0; cell < 4; cell++) {
      const ox = cell * S + S / 2
      const lift = [-18, -8, 4, -12][cell]
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(ox - 34, S / 2 + lift)
      ctx.quadraticCurveTo(ox - 14, S / 2 - 6 + lift * 0.3, ox, S / 2 + 4)
      ctx.quadraticCurveTo(ox + 14, S / 2 - 6 + lift * 0.3, ox + 34, S / 2 + lift)
      ctx.stroke()
    }
    return c
  }

  // ------------------------------------------------------------------ Ancient ruins (ruin)

  function hillsFar(seed = 601) {
    const W = 2800, H = 600
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    for (const [amp, base, l] of [[0.35, 0.35, 62], [0.25, 0.55, 54]]) {
      ctx.beginPath()
      ctx.moveTo(0, H)
      for (let x = 0; x <= W; x += 6) ctx.lineTo(x, H * (base + (1 - n.fbm(x / W * 3 + base * 10, seed, 4)) * amp - amp * 0.5))
      ctx.lineTo(W, H)
      ctx.closePath()
      ctx.fillStyle = hsl(80, 10, l)
      ctx.fill()
    }
    texture(ctx, W, H, rand, 2400, 70, 12, 46, 64, 20)
    return finish(c, { seed, rim: 0.4, rimWidth: 3, key: 0.25, mottle: 0.1, rimColor: STONE_RIM, shadow: 0.1 })
  }

  /** One fluted column, optionally broken off at `broken` (0..1 of its height) with a jagged top. */
  function column(ctx, cx, baseY, w, h, rand, stone, broken = 0) {
    const topY = baseY - h * (broken || 1)
    rect(ctx, cx - w * 0.65, baseY - w * 0.35, w * 1.3, w * 0.35, stone) // base
    const shaft = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0)
    shaft.addColorStop(0, hsl(36, 14, 44))
    shaft.addColorStop(0.55, stone)
    shaft.addColorStop(1, hsl(36, 10, 34))
    ctx.fillStyle = shaft
    ctx.beginPath()
    ctx.moveTo(cx - w / 2, baseY - w * 0.35)
    if (broken) {
      ctx.lineTo(cx - w / 2, topY + rand() * w * 0.4)
      for (let k = 1; k <= 5; k++) ctx.lineTo(cx - w / 2 + (w * k) / 5, topY + rand() * w * 0.6)
    } else {
      ctx.lineTo(cx - w * 0.46, topY + w * 0.5)
      ctx.lineTo(cx + w * 0.46, topY + w * 0.5)
    }
    ctx.lineTo(cx + w / 2, baseY - w * 0.35)
    ctx.closePath()
    ctx.fill()
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.strokeStyle = hsl(30, 10, 26)
    ctx.lineWidth = Math.max(1, w * 0.04)
    for (let f = 1; f < 6; f++) {
      const fx = cx - w / 2 + (w * f) / 6
      ctx.beginPath()
      ctx.moveTo(fx, baseY - w * 0.4)
      ctx.lineTo(fx, topY + w * 0.7)
      ctx.stroke()
    }
    ctx.restore()
    if (!broken) {
      rect(ctx, cx - w * 0.72, topY + w * 0.2, w * 1.44, w * 0.32, stone) // capital
      rect(ctx, cx - w * 0.6, topY + w * 0.5, w * 1.2, w * 0.12, hsl(36, 12, 38))
    }
    // drum joints
    for (let j = baseY - h * 0.22; j > topY + w; j -= h * 0.22) rect(ctx, cx - w / 2, j, w, 2, hsl(30, 10, 30), 0.4)
  }

  function ruinsFar(seed = 611) {
    const W = 2800, H = 700
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const stone = hsl(38, 10, 60)
    let x = 80
    while (x < W - 60) {
      const h = 260 + rand() * 260
      const broken = rand() < 0.45 ? 0.4 + rand() * 0.5 : 0
      column(ctx, x, H - 10, 34, h, rand, stone, broken)
      if (!broken && rand() < 0.5) rect(ctx, x - 30, H - 10 - h, 170 + rand() * 60, 34, stone) // architrave fragment
      x += 80 + rand() * 160
    }
    texture(ctx, W, H, rand, 2400, 38, 10, 52, 68)
    return finish(c, { seed, rim: 0.5, rimWidth: 3, key: 0.25, mottle: 0.08, rimColor: STONE_RIM, shadow: 0.1 })
  }

  function colonnade(seed = 621) {
    const W = 2800, H = 1000
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const stone = hsl(38, 14, 52)
    const cols = [0.07, 0.19, 0.31, 0.69, 0.81, 0.93]
    for (const [i, u] of cols.entries()) {
      const broken = i === 2 || i === 4 ? 0.55 + rand() * 0.2 : 0
      column(ctx, u * W, H - 12, 70, 820, rand, stone, broken)
    }
    // entablature fragments resting on intact neighbours
    rect(ctx, 0.07 * W - 70, H - 12 - 820 - 30, 0.12 * W + 140, 70, stone)
    rect(ctx, 0.81 * W - 70, H - 12 - 820 - 30, 0.12 * W + 140, 70, stone)
    texture(ctx, W, H, rand, 5200, 36, 14, 38, 60)
    return finish(c, { seed, rim: 0.9, rimWidth: 4, key: 0.4, mottle: 0.14, rimColor: STONE_RIM, shadow: 0.25 })
  }

  function arch(seed = 631) {
    const W = 1200, H = 1200
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const stone = hsl(34, 16, 48)
    rect(ctx, 150, 380, 220, 820, stone)
    rect(ctx, 830, 520, 220, 680, stone) // right pier shorter, broken top
    ctx.fillStyle = stone
    ctx.beginPath()
    ctx.arc(600, 440, 450, Math.PI, Math.PI * 1.72)
    ctx.arc(600, 440, 230, Math.PI * 1.72, Math.PI, true)
    ctx.closePath()
    ctx.fill()
    // voussoir joints
    ctx.strokeStyle = hsl(30, 12, 28)
    ctx.globalAlpha = 0.4
    ctx.lineWidth = 4
    for (let a = Math.PI; a < Math.PI * 1.72; a += 0.14) {
      ctx.beginPath()
      ctx.moveTo(600 + Math.cos(a) * 230, 440 + Math.sin(a) * 230)
      ctx.lineTo(600 + Math.cos(a) * 450, 440 + Math.sin(a) * 450)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    for (let y = 400; y < 1200; y += 70) {
      rect(ctx, 150, y, 220, 3, hsl(30, 12, 30), 0.45)
      if (y > 540) rect(ctx, 830, y, 220, 3, hsl(30, 12, 30), 0.45)
    }
    texture(ctx, W, H, rand, 3000, 34, 16, 34, 58)
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.4, mottle: 0.16, rimColor: STONE_RIM, shadow: 0.3 })
  }

  function brokenColumn(seed = 641) {
    const W = 500, H = 1400
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    column(ctx, W / 2, H - 10, 170, 1300, rand, hsl(38, 14, 50), 0.62)
    texture(ctx, W, H, rand, 1400, 36, 14, 36, 58)
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.4, mottle: 0.14, rimColor: STONE_RIM, shadow: 0.3 })
  }

  function blocks(seed = 651) {
    const W = 1600, H = 600
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    for (let i = 0; i < 9; i++) {
      const w = 140 + rand() * 260
      const h = 80 + rand() * 140
      const x = rand() * (W - w)
      const y = H - h - rand() * 60
      const top = hsl(38, 14, 56 + rand() * 8)
      const side = hsl(34, 14, 36 + rand() * 6)
      rect(ctx, x, y, w, h, side)
      poly(ctx, [[x, y], [x + 30, y - 26], [x + w + 30, y - 26], [x + w, y]], top)
      if (rand() < 0.4) {
        // a fallen drum: ellipse face
        ctx.fillStyle = hsl(38, 14, 52)
        ctx.beginPath()
        ctx.ellipse(x + w, y + h / 2, h * 0.25, h / 2, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    texture(ctx, W, H, rand, 2400, 36, 14, 34, 60)
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.4, mottle: 0.16, rimColor: STONE_RIM, shadow: 0.3 })
  }

  function grassFore(seed = 661) {
    const W = 2800, H = 600
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    for (let i = 0; i < 5200; i++) {
      const x = rand() * W
      const h = 60 + Math.pow(rand(), 0.6) * 420
      const lean = (rand() - 0.4) * h * 0.25
      ctx.globalAlpha = 0.8
      ctx.strokeStyle = hsl(42 + rand() * 14, 34 + rand() * 12, 36 + rand() * 22)
      ctx.lineWidth = 2 + rand() * 3
      ctx.beginPath()
      ctx.moveTo(x, H)
      ctx.quadraticCurveTo(x + lean * 0.3, H - h * 0.6, x + lean, H - h)
      ctx.stroke()
    }
    // wildflowers: small warm and pale dots on stalk tips
    for (let i = 0; i < 260; i++) {
      const x = rand() * W
      const y = H - 120 - rand() * 300
      const warm = rand() < 0.6
      ctx.globalAlpha = 0.9
      ctx.fillStyle = warm ? hsl(12 + rand() * 30, 60, 56) : hsl(50, 40, 82)
      ctx.beginPath()
      ctx.arc(x, y, 4 + rand() * 5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 0.8, rimWidth: 3, key: 0.3, mottle: 0.08, rimColor: STONE_RIM, shadow: 0.15 })
  }

  function dust(seed = 671) {
    const S = 128
    const { c, ctx } = makeCanvas(S * 4, S)
    const rand = mulberry32(seed)
    for (let cell = 0; cell < 4; cell++) {
      const ox = cell * S + S / 2
      for (let i = 0; i < 18; i++) dab(ctx, ox + (rand() - 0.5) * 10, S / 2 + (rand() - 0.5) * 10, 3 + rand() * 7, 3 + rand() * 7, 0, hsl(40, 40, 88), 0.3)
      dab(ctx, ox, S / 2, 4, 4, 0, hsl(40, 50, 96), 0.9)
    }
    return c
  }

  // ------------------------------------------------------------------ Harbor

  function skylineLow(seed = 701) {
    const W = 2800, H = 400
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const col = hsl(215, 10, 60)
    let x = 0
    while (x < W) {
      const w = 40 + rand() * 120
      const h = 50 + rand() * (rand() < 0.1 ? 280 : 130)
      rect(ctx, x, H - h, w + 1, h, col)
      if (rand() < 0.12) spire(ctx, x + w / 2, H - h, 12, 90, col)
      x += w
    }
    for (const u of [0.24, 0.63]) dome(ctx, u * W, H - 150, 48, col, 20)
    texture(ctx, W, H, rand, 1600, 215, 10, 52, 66)
    return finish(c, { seed, rim: 0.4, rimWidth: 2, key: 0.2, mottle: 0.06, rimColor: STONE_RIM, shadow: 0.1 })
  }

  function hull(ctx, x, waterY, len, h, color) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(x, waterY - h)
    ctx.lineTo(x + len, waterY - h * 1.15)
    ctx.quadraticCurveTo(x + len * 0.96, waterY, x + len * 0.82, waterY)
    ctx.lineTo(x + len * 0.08, waterY)
    ctx.closePath()
    ctx.fill()
  }

  function boats(seed = 711) {
    const W = 1800, H = 700
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const waterY = H - 10
    const specs = [[40, 360], [470, 300], [860, 420], [1340, 330]]
    for (const [x, len] of specs) {
      const white = rand() < 0.5
      hull(ctx, x, waterY, len, 70 + rand() * 20, white ? hsl(210, 10, 78) : hsl(8 + rand() * 200, 30, 38))
      rect(ctx, x + len * 0.08, waterY - 80, len * 0.84, 8, hsl(30, 20, 30)) // gunwale
      rect(ctx, x + len * 0.45, waterY - 80 - 360 - rand() * 120, 7, 380, hsl(30, 12, 24)) // mast
      if (rand() < 0.6) rect(ctx, x + len * 0.28, waterY - 130, len * 0.3, 50, hsl(30, 10, 70)) // cabin
    }
    texture(ctx, W, H, rand, 1800, 210, 10, 30, 80, 10)
    return finish(c, { seed, rim: 0.8, rimWidth: 3, key: 0.35, mottle: 0.08, rimColor: STONE_RIM, shadow: 0.2 })
  }

  function ferry(seed = 721) {
    const W = 1400, H = 700
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const waterY = H - 10
    hull(ctx, 20, waterY, 1340, 170, hsl(210, 20, 30))
    rect(ctx, 140, waterY - 300, 1000, 140, hsl(40, 12, 80)) // deck house
    rect(ctx, 260, waterY - 390, 700, 90, hsl(40, 10, 84))
    windows(ctx, 160, waterY - 290, 960, 110, rand, 16, 0.3)
    windows(ctx, 280, waterY - 385, 660, 70, rand, 14, 0.3)
    rect(ctx, 700, waterY - 500, 90, 120, hsl(8, 40, 40)) // funnel
    rect(ctx, 700, waterY - 510, 90, 16, hsl(0, 0, 18))
    texture(ctx, W, H, rand, 1600, 210, 12, 30, 84, 10)
    return finish(c, { seed, rim: 0.8, rimWidth: 3, key: 0.35, mottle: 0.08, rimColor: STONE_RIM, shadow: 0.2 })
  }

  function seawall(seed = 731) {
    const W = 2800, H = 700
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    // promenade deck (top) and ashlar wall face dropping to the water
    rect(ctx, 0, 250, W, H - 250, hsl(34, 12, 42))
    const g = ctx.createLinearGradient(0, 120, 0, 250)
    g.addColorStop(0, hsl(34, 10, 58))
    g.addColorStop(1, hsl(34, 10, 50))
    ctx.fillStyle = g
    ctx.fillRect(0, 120, W, 130)
    for (let y = 270; y < H; y += 60) {
      const off = ((y / 60) % 2) * 60
      for (let x = -off; x < W; x += 120) rect(ctx, x, y, 118, 57, hsl(34, 12, 36 + rand() * 10), 0.9)
    }
    // railing with posts and bollards along the edge
    rect(ctx, 0, 60, W, 8, hsl(210, 12, 20))
    rect(ctx, 0, 95, W, 5, hsl(210, 12, 20))
    for (let x = 20; x < W; x += 110) rect(ctx, x, 60, 8, 64, hsl(210, 12, 20))
    for (let x = 200; x < W; x += 560) {
      rect(ctx, x, 150, 44, 70, hsl(210, 12, 18))
      rect(ctx, x - 6, 150, 56, 14, hsl(210, 12, 22))
    }
    texture(ctx, W, H, rand, 3600, 34, 12, 30, 58, 18)
    return finish(c, { seed, rim: 0.7, rimWidth: 3, key: 0.35, mottle: 0.14, rimColor: STONE_RIM, shadow: 0.25 })
  }

  function gulls(seed = 741) {
    const S = 128
    const { c, ctx } = makeCanvas(S * 4, S)
    ctx.lineCap = 'round'
    for (let cell = 0; cell < 4; cell++) {
      const ox = cell * S + S / 2
      const lift = [-22, -10, 6, -16][cell]
      ctx.strokeStyle = hsl(210, 10, 92)
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(ox - 40, S / 2 + lift)
      ctx.quadraticCurveTo(ox - 16, S / 2 - 10 + lift * 0.2, ox, S / 2 + 4)
      ctx.quadraticCurveTo(ox + 16, S / 2 - 10 + lift * 0.2, ox + 40, S / 2 + lift)
      ctx.stroke()
      ctx.strokeStyle = hsl(210, 10, 30)
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(ox - 40, S / 2 + lift)
      ctx.lineTo(ox - 30, S / 2 + lift * 0.8)
      ctx.moveTo(ox + 40, S / 2 + lift)
      ctx.lineTo(ox + 30, S / 2 + lift * 0.8)
      ctx.stroke()
    }
    return c
  }

  window.ARTKIT = window.ARTKIT || {}
  window.ARTKIT.skyline = {
    'city-far': () => cityFar(501),
    'rooftops-mid': () => rooftops(511, { W: 2800, H: 800, scale: 0.8, light: 58, dark: 34, lit: 0.1 }),
    'rooftops-near': () => rooftops(521, { W: 2800, H: 900, scale: 1.3, light: 52, dark: 28, lit: 0.12 }),
    plaza: () => plaza(531),
    lamp: () => lamp(541),
    birds: () => birds(551),
  }
  window.ARTKIT.ruin = {
    'hills-far': () => hillsFar(601),
    'ruins-far': () => ruinsFar(611),
    colonnade: () => colonnade(621),
    arch: () => arch(631),
    'column-broken': () => brokenColumn(641),
    blocks: () => blocks(651),
    'grass-fore': () => grassFore(661),
    dust: () => dust(671),
  }
  window.ARTKIT.harbor = {
    'skyline-low': () => skylineLow(701),
    boats: () => boats(711),
    ferry: () => ferry(721),
    seawall: () => seawall(731),
    gulls: () => gulls(741),
  }
})()
