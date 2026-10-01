/*
 * Code-painted placeholder elements for three generic templates:
 *   grove (Forest / jungle): misty far canopy, a row of tall trunks, a near trunk, hanging vines, ferns, fireflies
 *   beach (Beach / island): low far islands, a sand beach with a wet edge, leaning palms, shore rocks
 *   polar (Ice / polar): a far glacier range, an ice cliff with crevasses, an iceberg, floes and a near snowfield
 * Neutral mid tones; each kit's per-time sky grades them. Registers window.ARTKIT.grove/beach/polar.
 */
;(function () {
  const { mulberry32, makeNoise, makeCanvas, hsl, clamp, dab, finish } = window.ARTKIT_LIB
  const RIM = [240, 244, 236]

  function texture(ctx, W, H, rand, count, hue, sat, lMin, lMax, len = 14, ang = 0.4) {
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    for (let i = 0; i < count; i++) {
      dab(ctx, rand() * W, rand() * H, 3 + rand() * len, 1 + rand() * 2.5, (rand() - 0.5) * ang, hsl(hue + (rand() - 0.5) * 10, sat, lMin + rand() * (lMax - lMin)), 0.16 + rand() * 0.14)
    }
    ctx.restore()
  }

  function ridge(ctx, W, H, n, seed, base, amp, freq, color) {
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, H * (base - n.fbm((x / W) * freq, seed, 4) * amp))
    ctx.lineTo(W, H)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }

  /** A canopy blob made of many leaf dabs (used for crowns at every depth). */
  function crown(ctx, cx, cy, r, rand, hue, l) {
    for (let i = 0; i < r * 2.2; i++) {
      const a = rand() * Math.PI * 2
      const d = Math.pow(rand(), 0.6) * r
      dab(ctx, cx + Math.cos(a) * d * 1.3, cy + Math.sin(a) * d * 0.7, 6 + rand() * r * 0.18, 3 + rand() * 5, rand() * Math.PI, hsl(hue + (rand() - 0.5) * 16, 30, l + (rand() - 0.5) * 12 + (Math.sin(a) < 0 ? 6 : -4)), 0.75)
    }
  }

  // ------------------------------------------------------------------ Forest / jungle (grove)

  function canopyFar(seed = 801) {
    const W = 2800, H = 700
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    ridge(ctx, W, H, n, seed, 0.62, 0.32, 9, hsl(140, 14, 52))
    for (let i = 0; i < 160; i++) crown(ctx, rand() * W, H * (0.3 + rand() * 0.3), 40 + rand() * 60, rand, 140, 54)
    texture(ctx, W, H, rand, 2400, 140, 14, 46, 62)
    return finish(c, { seed, rim: 0.4, rimWidth: 3, key: 0.2, mottle: 0.08, rimColor: RIM, shadow: 0.1 })
  }

  function trunk(ctx, x, w, H, rand, l, lean = 0) {
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0)
    g.addColorStop(0, hsl(28, 16, l - 10))
    g.addColorStop(0.6, hsl(30, 14, l + 6))
    g.addColorStop(1, hsl(28, 16, l - 14))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(x - w * 0.5 + lean, 0)
    ctx.lineTo(x + w * 0.5 + lean, 0)
    ctx.lineTo(x + w * 0.62, H)
    ctx.lineTo(x - w * 0.62, H)
    ctx.closePath()
    ctx.fill()
    // bark strokes and buttress roots
    for (let i = 0; i < w * 3; i++) dab(ctx, x + (rand() - 0.5) * w, rand() * H, 10 + rand() * 40, 1.5, Math.PI / 2, hsl(28, 14, l - 16 + rand() * 20), 0.35)
    for (const side of [-1, 1]) {
      ctx.fillStyle = hsl(28, 16, l - 8)
      ctx.beginPath()
      ctx.moveTo(x + side * w * 0.4, H * 0.82)
      ctx.quadraticCurveTo(x + side * w * 0.9, H * 0.94, x + side * w * 1.4, H)
      ctx.lineTo(x + side * w * 0.3, H)
      ctx.closePath()
      ctx.fill()
    }
  }

  function trunksMid(seed = 811) {
    const W = 2800, H = 1200
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    for (const u of [0.04, 0.17, 0.3, 0.71, 0.84, 0.96]) trunk(ctx, u * W, 60 + rand() * 50, H, rand, 36 + rand() * 8, (rand() - 0.5) * 30)
    for (let i = 0; i < 40; i++) crown(ctx, rand() * W, rand() * H * 0.2, 80 + rand() * 80, rand, 130, 34)
    texture(ctx, W, H, rand, 3000, 30, 14, 28, 46, 18, 0.1)
    return finish(c, { seed, rim: 0.8, rimWidth: 4, key: 0.35, mottle: 0.12, rimColor: RIM, shadow: 0.25 })
  }

  function trunkNear(seed = 821) {
    const W = 700, H = 1600
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    trunk(ctx, W / 2, 260, H, rand, 26)
    // moss patches
    for (let i = 0; i < 400; i++) dab(ctx, W / 2 + (rand() - 0.5) * 240, rand() * H, 6 + rand() * 16, 3 + rand() * 6, rand(), hsl(100, 30, 30 + rand() * 12), 0.5)
    return finish(c, { seed, rim: 0.9, rimWidth: 4, key: 0.35, mottle: 0.12, rimColor: RIM, shadow: 0.3 })
  }

  function vines(seed = 831) {
    const W = 2800, H = 700
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    for (let i = 0; i < 46; i++) {
      const x = rand() * W
      const len = H * (0.3 + rand() * 0.7)
      ctx.strokeStyle = hsl(95, 26, 26 + rand() * 10)
      ctx.lineWidth = 3 + rand() * 3
      ctx.beginPath()
      ctx.moveTo(x, 0)
      const sway = (rand() - 0.5) * 60
      ctx.quadraticCurveTo(x + sway, len * 0.5, x + sway * 0.4, len)
      ctx.stroke()
      for (let k = 0; k < len / 18; k++) {
        const t = k / (len / 18)
        dab(ctx, x + sway * t * (1 - t) * 2 + (rand() - 0.5) * 10, t * len, 8 + rand() * 10, 4 + rand() * 4, rand() * Math.PI, hsl(110, 30, 30 + rand() * 14), 0.8)
      }
    }
    for (let i = 0; i < 80; i++) crown(ctx, rand() * W, rand() * 60, 60 + rand() * 80, rand, 125, 28) // canopy edge at the top
    return finish(c, { seed, rim: 0.7, rimWidth: 3, key: 0.3, mottle: 0.1, rimColor: RIM, shadow: 0.2 })
  }

  function ferns(seed = 841) {
    const W = 2800, H = 600
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    for (let f = 0; f < 70; f++) {
      const bx = rand() * W
      const fronds = 5 + Math.floor(rand() * 5)
      for (let k = 0; k < fronds; k++) {
        const ang = -Math.PI / 2 + (k / (fronds - 1) - 0.5) * 2.2
        const len = 160 + rand() * 260
        for (let t = 0; t < 1; t += 0.04) {
          const x = bx + Math.cos(ang) * len * t
          const y = H - Math.sin(-ang) * len * t + t * t * len * 0.35
          dab(ctx, x, y, 14 * (1 - t) + 4, 3, ang + Math.PI / 2, hsl(110 + rand() * 20, 34, 30 + rand() * 14), 0.8)
          dab(ctx, x, y, 14 * (1 - t) + 4, 3, ang - Math.PI / 2, hsl(110 + rand() * 20, 34, 26 + rand() * 14), 0.8)
        }
      }
    }
    return finish(c, { seed, rim: 0.8, rimWidth: 3, key: 0.3, mottle: 0.08, rimColor: RIM, shadow: 0.2 })
  }

  function fireflies(seed = 851) {
    const S = 128
    const { c, ctx } = makeCanvas(S * 4, S)
    const rand = mulberry32(seed)
    for (let cell = 0; cell < 4; cell++) {
      const ox = cell * S + S / 2
      for (let i = 0; i < 20; i++) dab(ctx, ox + (rand() - 0.5) * 16, S / 2 + (rand() - 0.5) * 16, 4 + rand() * 8, 4 + rand() * 8, 0, hsl(70, 80, 80), 0.18)
      dab(ctx, ox, S / 2, 5, 5, 0, hsl(65, 90, 92), 0.95)
    }
    return c
  }

  // ------------------------------------------------------------------ Beach / island

  function islandsFar(seed = 901) {
    const W = 2800, H = 320
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    for (const [u, w, h] of [[0.12, 520, 160], [0.46, 300, 90], [0.8, 640, 210]]) {
      ctx.fillStyle = hsl(160, 12, 54)
      ctx.beginPath()
      ctx.ellipse(u * W, H, w / 2, h, 0, Math.PI, 0)
      ctx.fill()
      for (let i = 0; i < w / 14; i++) crown(ctx, u * W + (rand() - 0.5) * w * 0.8, H - h * (0.6 + rand() * 0.4), 14 + rand() * 18, rand, 150, 50)
    }
    texture(ctx, W, H, rand, 1200, 160, 12, 48, 62)
    return finish(c, { seed, rim: 0.4, rimWidth: 2, key: 0.2, mottle: 0.06, rimColor: RIM, shadow: 0.1 })
  }

  function sand(seed = 911) {
    const W = 2800, H = 600
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, H * (0.18 + n.fbm((x / W) * 3, seed, 3) * 0.12))
    ctx.lineTo(W, H)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, H * 0.15, 0, H)
    g.addColorStop(0, hsl(40, 24, 58)) // wet edge, darker
    g.addColorStop(0.12, hsl(42, 30, 72))
    g.addColorStop(1, hsl(38, 28, 62))
    ctx.fillStyle = g
    ctx.fill()
    ctx.save()
    ctx.clip()
    for (let i = 0; i < 2600; i++) dab(ctx, rand() * W, H * (0.2 + rand() * 0.8), 10 + rand() * 40, 1.5, (rand() - 0.5) * 0.1, hsl(40, 26, 60 + rand() * 18), 0.2)
    // foam line along the wet edge
    for (let x = 0; x < W; x += 6) dab(ctx, x, H * (0.18 + n.fbm((x / W) * 3, seed, 3) * 0.12) + 3, 12, 2, 0, hsl(190, 20, 94), 0.6)
    ctx.restore()
    return finish(c, { seed, rim: 0.5, rimWidth: 3, key: 0.3, mottle: 0.1, rimColor: RIM, shadow: 0.15 })
  }

  function palm(seed, lean) {
    const W = 900, H = 1500
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const topX = W / 2 + lean * W, topY = 260
    // curved ringed trunk
    for (let t = 0; t <= 1; t += 0.006) {
      const x = W / 2 + lean * W * Math.pow(t, 1.6)
      const y = H - t * (H - topY)
      const w = 34 - t * 12
      dab(ctx, x, y, w, 7, 0, hsl(32, 20, t % 0.05 < 0.025 ? 38 : 46), 0.95)
    }
    // fronds
    for (let k = 0; k < 11; k++) {
      const ang = (k / 11) * Math.PI * 2 + rand() * 0.3
      const len = 300 + rand() * 120
      for (let t = 0; t < 1; t += 0.03) {
        const x = topX + Math.cos(ang) * len * t
        const y = topY + Math.sin(ang) * len * t * 0.5 + t * t * len * 0.55
        for (const side of [-1, 1]) dab(ctx, x, y, 26 * (1 - t) + 6, 3, ang + side * 1.2, hsl(115 + rand() * 20, 32, 30 + rand() * 12), 0.85)
      }
    }
    return finish(c, { seed, rim: 0.9, rimWidth: 3, key: 0.35, mottle: 0.08, rimColor: RIM, shadow: 0.2 })
  }

  function rocksShore(seed = 931) {
    const W = 1400, H = 500
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    for (let i = 0; i < 7; i++) {
      const cx = 120 + rand() * (W - 240), rx = 80 + rand() * 160, ry = 60 + rand() * 120
      ctx.fillStyle = hsl(210, 8, 30 + rand() * 10)
      ctx.beginPath()
      ctx.ellipse(cx, H - ry * 0.4, rx, ry, (rand() - 0.5) * 0.3, Math.PI, 0)
      ctx.fill()
    }
    texture(ctx, W, H, rand, 1600, 210, 8, 22, 46)
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.4, mottle: 0.14, rimColor: RIM, shadow: 0.3 })
  }

  // ------------------------------------------------------------------ Ice / polar

  function iceFar(seed = 1001) {
    const W = 2800, H = 600
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    ridge(ctx, W, H, n, seed, 0.7, 0.55, 5, hsl(205, 22, 78))
    texture(ctx, W, H, rand, 1800, 205, 20, 70, 90, 18, 1)
    return finish(c, { seed, rim: 0.5, rimWidth: 3, key: 0.25, mottle: 0.06, rimColor: RIM, shadow: 0.1 })
  }

  function iceCliff(seed = 1011) {
    const W = 2800, H = 900
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    // a flat-topped shelf with a vertical face
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 6) ctx.lineTo(x, H * (0.18 + n.fbm((x / W) * 4, seed, 3) * 0.12))
    ctx.lineTo(W, H)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, hsl(200, 30, 90))
    g.addColorStop(0.35, hsl(198, 40, 74))
    g.addColorStop(1, hsl(200, 46, 50))
    ctx.fillStyle = g
    ctx.fill()
    ctx.save()
    ctx.clip()
    // vertical crevasses and blue shadows
    for (let i = 0; i < 160; i++) {
      const x = rand() * W
      ctx.strokeStyle = hsl(205, 50, 40 + rand() * 20)
      ctx.globalAlpha = 0.35
      ctx.lineWidth = 2 + rand() * 8
      ctx.beginPath()
      ctx.moveTo(x, H * 0.3 + rand() * 40)
      ctx.lineTo(x + (rand() - 0.5) * 30, H)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    texture(ctx, W, H, rand, 3000, 200, 30, 56, 92, 18, 0.2)
    ctx.restore()
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.4, mottle: 0.1, rimColor: RIM, shadow: 0.25 })
  }

  function iceberg(seed = 1021) {
    const W = 1200, H = 700
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    ctx.fillStyle = hsl(198, 34, 82)
    ctx.beginPath()
    ctx.moveTo(60, H)
    ctx.lineTo(220, 280)
    ctx.lineTo(420, 160)
    ctx.lineTo(560, 300)
    ctx.lineTo(760, 120)
    ctx.lineTo(980, 360)
    ctx.lineTo(1140, H)
    ctx.closePath()
    ctx.fill()
    ctx.save()
    ctx.clip()
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = hsl(205, 44, 56 + rand() * 20)
      ctx.globalAlpha = 0.4
      ctx.beginPath()
      const x = rand() * W
      ctx.moveTo(x, 140 + rand() * 200)
      ctx.lineTo(x + 40 + rand() * 80, H)
      ctx.lineTo(x - 20, H)
      ctx.closePath()
      ctx.fill()
    }
    ctx.globalAlpha = 1
    texture(ctx, W, H, rand, 1400, 200, 30, 60, 92)
    ctx.restore()
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.4, mottle: 0.1, rimColor: RIM, shadow: 0.25 })
  }

  function snowfield(seed = 1031) {
    const W = 2800, H = 600
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, H * (0.22 + n.fbm((x / W) * 2.5, seed, 4) * 0.2))
    ctx.lineTo(W, H)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, H * 0.2, 0, H)
    g.addColorStop(0, hsl(205, 20, 92))
    g.addColorStop(1, hsl(210, 24, 76))
    ctx.fillStyle = g
    ctx.fill()
    ctx.save()
    ctx.clip()
    for (let i = 0; i < 2200; i++) dab(ctx, rand() * W, H * (0.25 + rand() * 0.75), 20 + rand() * 60, 2, (rand() - 0.5) * 0.08, hsl(205, 24, 78 + rand() * 16), 0.25) // wind ripples
    ctx.restore()
    return finish(c, { seed, rim: 0.6, rimWidth: 3, key: 0.3, mottle: 0.06, rimColor: RIM, shadow: 0.15 })
  }

  window.ARTKIT = window.ARTKIT || {}
  window.ARTKIT.grove = {
    'canopy-far': () => canopyFar(801),
    'trunks-mid': () => trunksMid(811),
    'trunk-near': () => trunkNear(821),
    vines: () => vines(831),
    ferns: () => ferns(841),
    fireflies: () => fireflies(851),
  }
  window.ARTKIT.beach = {
    'islands-far': () => islandsFar(901),
    sand: () => sand(911),
    palm: () => palm(921, 0.22),
    'palm-b': () => palm(927, -0.18),
    'rocks-shore': () => rocksShore(931),
  }
  window.ARTKIT.polar = {
    'ice-far': () => iceFar(1001),
    'ice-cliff': () => iceCliff(1011),
    iceberg: () => iceberg(1021),
    snowfield: () => snowfield(1031),
  }
})()
