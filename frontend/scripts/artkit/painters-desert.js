/*
 * Code-painted placeholder elements for the Dune (Giza) and Tide (Nile)
 * templates. Same pipeline as painters.js: noise-edged silhouettes, translucent
 * brush dabs, then the shared finish() pass (mottling, upper-right key light,
 * rim). Colours are local (sand, limestone, palm green) in mid values so each
 * kit's tint, fog and rim can grade them to sunset, night or dawn.
 * Registers window.ARTKIT.dune and window.ARTKIT.tide.
 */
;(function () {
  const { mulberry32, makeNoise, makeCanvas, hsl, clamp, lerp, dab, blade, blobPath, finish } = window.ARTKIT_LIB

  const SAND_RIM = [255, 226, 180]

  /**
   * Dune ridge height 0..1: two layered swell trains with pointed crests, phase-warped
   * so each ridge rises gently on the windward side and drops steeply on the slip face.
   */
  function duneProfile(n, u, seed, amp, freq) {
    const swell = (f, ph) => {
      const t = u * f + ph
      const warped = t + 0.18 * Math.sin(t * Math.PI * 2) // asymmetry
      return Math.pow(0.5 + 0.5 * Math.sin(warped * Math.PI * 2), 2.2)
    }
    const h = 0.65 * swell(freq, seed * 0.13) + 0.35 * swell(freq * 2.3, seed * 0.29) + (n.fbm(u * 6, seed, 3) - 0.5) * 0.12
    return clamp(h, 0, 1) * amp
  }

  /**
   * One dune layer: body filled with a crest-to-trough gradient, lit windward
   * face (right of each crest) and shadowed slip face, fine wind ripples.
   */
  function duneLayer(W, H, seed, { top, amp, freq, light, shadow, ripples, pebbles = 0 }) {
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const yAt = (u) => H * (top + (1 - duneProfile(n, u, seed, amp, freq)) * (1 - top) * 0.7)
    // body
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, yAt(x / W))
    ctx.lineTo(W, H)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, H * top, 0, H)
    g.addColorStop(0, hsl(light[0], light[1], light[2]))
    g.addColorStop(1, hsl(shadow[0], shadow[1], shadow[2]))
    ctx.fillStyle = g
    ctx.fill()
    ctx.save()
    ctx.clip()
    // Slip-face shadows: where the ridge is descending to the right, shade below it.
    for (let x = 0; x < W; x += 3) {
      const u = x / W
      // Slope over a wide window, so the shade follows the ridge instead of striping.
      const slope = (yAt(u + 0.012) - yAt(u - 0.012)) / 2
      if (slope <= 0) continue
      const y = yAt(u)
      const k = clamp(slope * 0.06, 0, 1) * 0.7
      const sg = ctx.createLinearGradient(0, y, 0, y + H * 0.45)
      sg.addColorStop(0, `rgba(40,20,10,${0.35 * k})`)
      sg.addColorStop(1, 'rgba(40,20,10,0)')
      ctx.fillStyle = sg
      ctx.fillRect(x, y, 3, H * 0.45)
    }
    // Wind ripples: long thin arcs following the surface.
    for (let i = 0; i < ripples; i++) {
      const u = rand()
      const y0 = yAt(u)
      const y = y0 + Math.pow(rand(), 0.8) * (H - y0)
      const depth = (y - y0) / Math.max(1, H - y0)
      const l = lerp(light[2] + 6, shadow[2], depth) + (rand() - 0.5) * 8
      dab(ctx, u * W, y, 30 + rand() * 90, 1 + rand() * 2.2, (rand() - 0.5) * 0.08, hsl(light[0] + (rand() - 0.5) * 6, light[1], l), 0.18 + rand() * 0.2)
    }
    for (let i = 0; i < pebbles; i++) {
      const u = rand()
      const y = yAt(u) + rand() * (H - yAt(u))
      const r = 2 + rand() * 6
      dab(ctx, u * W, y, r * 1.6, r, 0, hsl(28, 25, 20 + rand() * 20), 0.7)
    }
    ctx.restore()
    return finish(c, { seed, rim: 0.7, rimWidth: 5, key: 0.35, mottle: 0.1, mottleScale: 0.006, rimColor: SAND_RIM, shadow: 0.2 })
  }

  function duneFar() {
    return duneLayer(2048, 480, 211, { top: 0.35, amp: 0.55, freq: 2.2, light: [34, 38, 68], shadow: [26, 32, 52], ripples: 900 })
  }
  function duneMid() {
    return duneLayer(2048, 640, 223, { top: 0.22, amp: 0.8, freq: 1.6, light: [33, 45, 64], shadow: [22, 38, 40], ripples: 2600 })
  }
  function duneNear() {
    return duneLayer(2048, 720, 237, { top: 0.12, amp: 0.9, freq: 1.2, light: [32, 48, 60], shadow: [20, 40, 30], ripples: 5200, pebbles: 260 })
  }

  /** One pyramid: lit right face, shadowed left face, masonry courses, optional casing cap. */
  function pyramid(ctx, rand, cx, baseY, w, h, cap) {
    const apex = [cx + w * 0.04, baseY - h]
    const L = [cx - w / 2, baseY]
    const R = [cx + w / 2, baseY]
    const M = [cx + w * 0.12, baseY] // visible edge splits the two faces
    // shadow face
    ctx.globalAlpha = 1
    ctx.fillStyle = hsl(28, 30, 30)
    ctx.beginPath()
    ctx.moveTo(L[0], L[1])
    ctx.lineTo(apex[0], apex[1])
    ctx.lineTo(M[0], M[1])
    ctx.closePath()
    ctx.fill()
    // lit face
    ctx.fillStyle = hsl(36, 42, 62)
    ctx.beginPath()
    ctx.moveTo(M[0], M[1])
    ctx.lineTo(apex[0], apex[1])
    ctx.lineTo(R[0], R[1])
    ctx.closePath()
    ctx.fill()
    // courses: horizontal lines, jittered, clipped to the pyramid
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(L[0], L[1])
    ctx.lineTo(apex[0], apex[1])
    ctx.lineTo(R[0], R[1])
    ctx.closePath()
    ctx.clip()
    const courses = Math.floor(h / 7)
    for (let i = 0; i < courses; i++) {
      const y = baseY - (i / courses) * h
      ctx.strokeStyle = `rgba(40,25,15,${0.18 + rand() * 0.12})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(L[0], y + (rand() - 0.5))
      ctx.lineTo(R[0], y + (rand() - 0.5))
      ctx.stroke()
    }
    // weathering dabs
    for (let i = 0; i < w * h * 0.004; i++) {
      const px = L[0] + rand() * w
      const py = baseY - rand() * h
      const lit = px > M[0] + (apex[0] - M[0]) * (1 - (baseY - py) / h)
      dab(ctx, px, py, 6 + rand() * 18, 2 + rand() * 3, (rand() - 0.5) * 0.3, lit ? hsl(34, 40, 52 + rand() * 18) : hsl(26, 28, 22 + rand() * 14), 0.25)
    }
    if (cap) {
      // Surviving smooth casing near the apex (Khafre's pyramid).
      ctx.fillStyle = 'rgba(240,222,190,0.55)'
      ctx.beginPath()
      ctx.moveTo(apex[0], apex[1])
      ctx.lineTo(apex[0] - w * 0.1, apex[1] + h * 0.2)
      ctx.lineTo(apex[0] + w * 0.12, apex[1] + h * 0.2)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  /** The three Giza pyramids with queens' pyramids, seen from the south-west. */
  function pyramids(seed = 241) {
    const W = 1800, H = 760
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const base = H - 40
    // Draw back to front: Khufu (largest, right-back), Khafre (centre, on higher ground), Menkaure (left-front, small).
    pyramid(ctx, rand, W * 0.7, base - 10, 760, 470, false)
    pyramid(ctx, rand, W * 0.42, base, 700, 520, true)
    pyramid(ctx, rand, W * 0.16, base + 8, 330, 220, false)
    // queens' pyramids
    for (const [x, s] of [[0.06, 90], [0.1, 80], [0.135, 70]]) pyramid(ctx, rand, W * x, base + 14, s, s * 0.62, false)
    // sand drifted at the bases
    ctx.fillStyle = hsl(34, 40, 48)
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, base + 6 + Math.sin(x * 0.01) * 6 + rand() * 4)
    ctx.lineTo(W, H)
    ctx.closePath()
    ctx.fill()
    return finish(c, { seed, rim: 0.9, rimWidth: 4, key: 0.3, mottle: 0.12, rimColor: SAND_RIM, shadow: 0.2 })
  }

  /** The Great Sphinx in profile facing right: reclining lion body, nemes headdress. */
  function sphinx(seed = 251) {
    const W = 1500, H = 720
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const stone = (l) => hsl(33, 34, l)
    ctx.globalAlpha = 1
    // enclosure floor / bedrock
    ctx.fillStyle = stone(34)
    ctx.fillRect(0, H - 60, W, 60)
    // body: haunch at left, long back, chest at right
    ctx.fillStyle = stone(44)
    ctx.beginPath()
    ctx.moveTo(40, H - 60)
    ctx.quadraticCurveTo(40, H - 300, 200, H - 330)
    ctx.quadraticCurveTo(600, H - 360, 1000, H - 350)
    ctx.quadraticCurveTo(1110, H - 345, 1130, H - 250)
    ctx.lineTo(1130, H - 120)
    ctx.lineTo(W - 40, H - 120)
    ctx.lineTo(W - 30, H - 60)
    ctx.closePath()
    ctx.fill()
    // forepaws
    ctx.fillStyle = stone(48)
    ctx.fillRect(1040, H - 140, W - 1080, 80)
    // head block with nemes headdress (flaps fall to the shoulders)
    ctx.fillStyle = stone(42)
    ctx.beginPath()
    ctx.moveTo(980, H - 340)
    ctx.lineTo(985, H - 470)
    ctx.quadraticCurveTo(1040, H - 520, 1110, H - 490)
    ctx.lineTo(1120, H - 440)
    ctx.lineTo(1145, H - 425) // brow and nose
    ctx.lineTo(1140, H - 385)
    ctx.lineTo(1120, H - 372) // chin
    ctx.lineTo(1100, H - 300) // nemes lappet down to the chest
    ctx.lineTo(1030, H - 320)
    ctx.closePath()
    ctx.fill()
    // nemes stripes
    ctx.save()
    ctx.clip()
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(60,40,25,0.22)' : 'rgba(255,240,210,0.08)'
      ctx.fillRect(975, H - 520 + i * 16, 150, 8)
    }
    ctx.restore()
    // weathering: horizontal erosion bands of softer limestone layers
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    for (let y = H - 360; y < H - 60; y += 14) {
      const k = n.fbm(0.3, y * 0.02, 3)
      ctx.fillStyle = `rgba(40,25,15,${0.08 + k * 0.18})`
      ctx.fillRect(0, y, W, 5 + rand() * 4)
    }
    for (let i = 0; i < 5000; i++) {
      dab(ctx, rand() * W, H - 60 - rand() * 560, 6 + rand() * 20, 2 + rand() * 4, (rand() - 0.5) * 0.4, stone(28 + rand() * 30), 0.2)
    }
    ctx.restore()
    return finish(c, { seed, rim: 1, rimWidth: 5, key: 0.4, mottle: 0.16, rimColor: SAND_RIM })
  }

  /** Sandstone outcrop: stacked strata, wind-scoured, warm ochre-red. */
  function rocksSandstone(seed = 261) {
    const W = 1200, H = 460
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    for (const [u, rx, ry] of [[0.3, 260, 200], [0.62, 220, 150], [0.85, 140, 100]]) {
      blobPath(ctx, u * W, H - 10, rx, ry, 0.12, n, u * 13, true)
      ctx.save()
      ctx.clip()
      ctx.fillStyle = hsl(20, 42, 36)
      ctx.fillRect(0, 0, W, H)
      for (let y = H; y > H - ry * 1.2; y -= 10 + rand() * 12) {
        ctx.fillStyle = hsl(18 + rand() * 12, 40, 28 + rand() * 20)
        ctx.globalAlpha = 0.8
        ctx.fillRect(u * W - rx * 1.2, y, rx * 2.4, 6 + rand() * 8)
      }
      for (let i = 0; i < rx * ry * 0.03; i++) {
        dab(ctx, u * W + (rand() - 0.5) * rx * 2, H - rand() * ry * 1.1, 10 + rand() * 30, 3 + rand() * 5, (rand() - 0.5) * 0.2, hsl(22, 38, 26 + rand() * 26), 0.3)
      }
      ctx.restore()
    }
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 1, rimWidth: 5, key: 0.45, mottle: 0.18, rimColor: SAND_RIM })
  }

  /** Date palm: leaning ringed trunk, crown of arching fronds, date clusters. */
  function palm(seed = 271, lean = 0.12) {
    const W = 760, H = 1500
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const topX = W * (0.5 + lean)
    const topY = H * 0.24
    // trunk: quadratic curve, ring scars
    const trunkAt = (t) => {
      const x = lerp(W * 0.5, topX, t) + Math.sin(t * Math.PI) * W * 0.05
      const y = lerp(H, topY, t)
      return [x, y]
    }
    for (let i = 0; i < 90; i++) {
      const t = i / 90
      const [x, y] = trunkAt(t)
      const w = lerp(34, 20, t)
      dab(ctx, x, y, w * 1.6, 16, 0, hsl(28, 24, 22 + (i % 2) * 6 + rand() * 6), 0.95, 3, rand)
    }
    // fronds: long arcs with leaflets
    const fronds = 16
    for (let f = 0; f < fronds; f++) {
      const a = -Math.PI / 2 + ((f / (fronds - 1)) - 0.5) * Math.PI * 1.7 + (rand() - 0.5) * 0.2
      const len = 260 + rand() * 120
      const droop = 0.5 + Math.abs(Math.cos(a)) * 0.8
      let px = topX, py = topY
      for (let s = 0; s < 22; s++) {
        const t = s / 22
        const ang = a + t * droop * Math.sign(Math.cos(a) || 1)
        const nx = px + Math.cos(ang) * (len / 22)
        const ny = py + Math.sin(ang) * (len / 22) + t * 6
        ctx.strokeStyle = hsl(90, 22, 18)
        ctx.lineWidth = lerp(5, 1.5, t)
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(nx, ny)
        ctx.stroke()
        for (const side of [-1, 1]) {
          const la = ang + side * (1.2 + rand() * 0.3)
          const ll = lerp(46, 14, t) * (0.8 + rand() * 0.4)
          dab(ctx, nx + Math.cos(la) * ll * 0.5, ny + Math.sin(la) * ll * 0.5 + 6, ll, 4, la, hsl(80 + rand() * 30, 26 + rand() * 12, 16 + rand() * 16), 0.85)
        }
        px = nx
        py = ny
      }
    }
    // date clusters under the crown
    for (let i = 0; i < 90; i++) {
      dab(ctx, topX + (rand() - 0.5) * 70, topY + 30 + rand() * 50, 8, 8, 0, hsl(20 + rand() * 12, 60, 30 + rand() * 12), 0.9)
    }
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.4, mottle: 0.12, rimColor: SAND_RIM })
  }

  /** Wind-blown sand sprite sheet: 4 cells of soft grain streaks and dust wisps. */
  function sand(seed = 281) {
    const S = 128
    const { c, ctx } = makeCanvas(S * 4, S)
    const rand = mulberry32(seed)
    for (let cell = 0; cell < 4; cell++) {
      const ox = cell * S
      if (cell < 2) {
        // streak of grains
        for (let i = 0; i < 120; i++) {
          const t = rand()
          dab(ctx, ox + 14 + t * 100, S / 2 + (rand() - 0.5) * 18 * (1 - t), 2 + rand() * 3, 1.5 + rand() * 1.5, 0, hsl(36, 40, 70 + rand() * 20), 0.5 * (1 - t) + 0.2)
        }
      } else {
        // soft dust wisp
        for (let i = 0; i < 60; i++) {
          dab(ctx, ox + S / 2 + (rand() - 0.5) * 70, S / 2 + (rand() - 0.5) * 30, 20 + rand() * 30, 8 + rand() * 12, (rand() - 0.5) * 0.3, hsl(34, 36, 72), 0.06)
        }
      }
    }
    return c
  }

  // ------------------------------------------------------------------- Tide

  /** Distant far bank: low line of scrub and palm silhouettes, mudbrick houses. */
  function bankFar(seed = 311) {
    const W = 2048, H = 420
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const ground = H * 0.78
    ctx.fillStyle = hsl(40, 20, 26)
    ctx.fillRect(0, ground, W, H - ground)
    // scrub band
    for (let i = 0; i < 2600; i++) {
      const x = rand() * W
      const h = 10 + n.fbm(x * 0.004, 1, 3) * 60 * rand()
      dab(ctx, x, ground - h * 0.4, 6 + rand() * 12, 4 + h * 0.3, rand() * Math.PI, hsl(95 + rand() * 30, 18, 18 + rand() * 10), 0.6)
    }
    // palm silhouettes
    for (let i = 0; i < 26; i++) {
      const x = rand() * W
      const h = 70 + rand() * 120
      ctx.strokeStyle = hsl(40, 15, 16)
      ctx.lineWidth = 3
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.moveTo(x, ground)
      ctx.quadraticCurveTo(x + 8, ground - h * 0.6, x + (rand() - 0.5) * 20, ground - h)
      ctx.stroke()
      for (let f = 0; f < 9; f++) {
        const a = -Math.PI / 2 + (f / 8 - 0.5) * 3
        dab(ctx, x + Math.cos(a) * 20, ground - h + Math.sin(a) * 12 + 8, 40, 5, a, hsl(90, 18, 16), 0.8)
      }
    }
    // mudbrick houses
    for (let i = 0; i < 8; i++) {
      const x = rand() * W
      const w = 30 + rand() * 50
      const h = 18 + rand() * 20
      ctx.fillStyle = hsl(30, 28, 38 + rand() * 10)
      ctx.globalAlpha = 1
      ctx.fillRect(x, ground - h, w, h)
    }
    return finish(c, { seed, rim: 0.6, rimWidth: 3, key: 0.25, mottle: 0.1, rimColor: SAND_RIM })
  }

  /** Near riverbank: dark mud edge, grasses, a few stones at the waterline. */
  function bankNear(seed = 321) {
    const W = 2048, H = 520
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const n = makeNoise(seed)
    const edge = (u) => H * (0.35 + 0.18 * n.fbm(u * 3, 2, 4))
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 6) ctx.lineTo(x, edge(x / W))
    ctx.lineTo(W, H)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, H * 0.3, 0, H)
    g.addColorStop(0, hsl(30, 22, 22))
    g.addColorStop(1, hsl(25, 20, 10))
    ctx.fillStyle = g
    ctx.fill()
    for (let i = 0; i < 1600; i++) {
      const u = rand()
      blade(ctx, u * W, edge(u) + 6 + rand() * 30, 14 + rand() * 50, 1.5 + rand() * 2, (rand() - 0.5) * 20, hsl(80 + rand() * 30, 22, 14 + rand() * 14), 0.8)
    }
    for (let i = 0; i < 40; i++) {
      const u = rand()
      blobPath(ctx, u * W, edge(u) + 10, 14 + rand() * 20, 8 + rand() * 10, 0.2, n, i)
      ctx.fillStyle = hsl(30, 12, 24 + rand() * 14)
      ctx.globalAlpha = 1
      ctx.fill()
    }
    return finish(c, { seed, rim: 0.8, rimWidth: 4, key: 0.3, mottle: 0.14, rimColor: SAND_RIM })
  }

  /** Foreground reed strip: tall thin blades with feathery seed heads. */
  function reeds(seed = 331) {
    const W = 2048, H = 640
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    ctx.fillStyle = hsl(40, 20, 8)
    ctx.fillRect(0, H - 40, W, 40)
    for (let i = 0; i < 2200; i++) {
      const x = rand() * W
      const h = H * (0.35 + rand() * 0.6)
      const lean = (rand() - 0.5) * 60
      blade(ctx, x, H + 4, h, 1.4 + rand() * 1.8, lean, hsl(60 + rand() * 40, 24, 10 + rand() * 16), 0.9)
      if (rand() < 0.12) {
        for (let k = 0; k < 18; k++) dab(ctx, x + lean + (rand() - 0.5) * 8, H + 4 - h + rand() * 40, 6, 2, 1.4, hsl(38, 30, 45 + rand() * 20), 0.5)
      }
    }
    return finish(c, { seed, rim: 1, rimWidth: 4, key: 0.3, mottle: 0.1, rimColor: SAND_RIM, shadow: 0.25 })
  }

  /** Papyrus clump: tall triangular stems topped with umbrella sprays. */
  function papyrus(seed = 341) {
    const W = 820, H = 1000
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const stems = 22
    for (let i = 0; i < stems; i++) {
      const x0 = W * 0.5 + (rand() - 0.5) * 120
      const h = H * (0.5 + rand() * 0.42)
      const tx = x0 + (x0 - W * 0.5) * 1.6 + (rand() - 0.5) * 60
      const ty = H - h
      ctx.strokeStyle = hsl(85, 30, 20 + rand() * 10)
      ctx.lineWidth = 3
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.moveTo(x0, H)
      ctx.quadraticCurveTo((x0 + tx) / 2, H - h * 0.5, tx, ty)
      ctx.stroke()
      // umbrella spray: fine rays fanning out and drooping
      for (let r = 0; r < 70; r++) {
        const a = -Math.PI / 2 + (rand() - 0.5) * 2.6
        const len = 40 + rand() * 50
        const ex = tx + Math.cos(a) * len
        const ey = ty + Math.sin(a) * len * 0.6 + len * 0.3
        ctx.strokeStyle = hsl(75 + rand() * 20, 30, 24 + rand() * 20)
        ctx.lineWidth = 1
        ctx.globalAlpha = 0.8
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.quadraticCurveTo((tx + ex) / 2, ty + Math.sin(a) * len * 0.3 - 6, ex, ey)
        ctx.stroke()
      }
    }
    // base leaves
    for (let i = 0; i < 80; i++) blade(ctx, W * 0.5 + (rand() - 0.5) * 160, H + 4, 60 + rand() * 90, 4, (rand() - 0.5) * 80, hsl(80, 24, 14 + rand() * 10), 0.9)
    ctx.globalAlpha = 1
    return finish(c, { seed, rim: 1, rimWidth: 3, key: 0.35, mottle: 0.1, rimColor: SAND_RIM })
  }

  /** Ancient Nile cargo boat: crescent wooden hull, mast with a tall square linen sail, steering oar, limestone blocks. */
  function boat(seed = 351) {
    const W = 1400, H = 1100
    const { c, ctx } = makeCanvas(W, H)
    const rand = mulberry32(seed)
    const deckY = H - 220
    // hull: crescent with raised prow (right) and stern (left)
    ctx.fillStyle = hsl(24, 34, 24)
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.moveTo(90, deckY - 150)
    ctx.quadraticCurveTo(200, deckY + 10, 420, deckY + 20)
    ctx.lineTo(1000, deckY + 20)
    ctx.quadraticCurveTo(1220, deckY + 10, 1330, deckY - 170)
    ctx.quadraticCurveTo(1250, deckY + 150, 1000, deckY + 150)
    ctx.lineTo(420, deckY + 150)
    ctx.quadraticCurveTo(170, deckY + 150, 90, deckY - 150)
    ctx.closePath()
    ctx.fill()
    // planks
    ctx.save()
    ctx.clip()
    for (let y = deckY; y < deckY + 160; y += 16) {
      ctx.strokeStyle = 'rgba(15,8,4,0.45)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, y + (rand() - 0.5) * 3)
      ctx.quadraticCurveTo(W / 2, y + 26, W, y - 30)
      ctx.stroke()
    }
    for (let i = 0; i < 1600; i++) dab(ctx, rand() * W, deckY - 150 + rand() * 300, 20 + rand() * 40, 2, 0.05, hsl(26, 30, 18 + rand() * 18), 0.25)
    ctx.restore()
    // cargo: limestone blocks on deck
    for (let i = 0; i < 5; i++) {
      const bx = 470 + i * 105 + rand() * 10
      const bw = 90 + rand() * 10
      const bh = 60 + rand() * 20
      ctx.fillStyle = hsl(40, 22, 70 + rand() * 8)
      ctx.fillRect(bx, deckY + 18 - bh, bw, bh)
      ctx.fillStyle = 'rgba(60,45,30,0.3)'
      ctx.fillRect(bx, deckY + 18 - bh, 10, bh)
    }
    // mast + yard + boom
    ctx.strokeStyle = hsl(26, 30, 18)
    ctx.lineWidth = 16
    ctx.beginPath()
    ctx.moveTo(700, deckY + 10)
    ctx.lineTo(700, 80)
    ctx.stroke()
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.moveTo(420, 130)
    ctx.lineTo(980, 120)
    ctx.moveTo(430, deckY - 80)
    ctx.lineTo(970, deckY - 90)
    ctx.stroke()
    // square linen sail, billowing slightly
    const sg = ctx.createLinearGradient(420, 0, 980, 0)
    sg.addColorStop(0, hsl(38, 30, 62))
    sg.addColorStop(0.6, hsl(40, 36, 78))
    sg.addColorStop(1, hsl(36, 28, 58))
    ctx.fillStyle = sg
    ctx.beginPath()
    ctx.moveTo(425, 135)
    ctx.quadraticCurveTo(700, 150, 975, 125)
    ctx.quadraticCurveTo(1010, (135 + deckY - 90) / 2, 965, deckY - 95)
    ctx.quadraticCurveTo(700, deckY - 70, 435, deckY - 85)
    ctx.quadraticCurveTo(470, (135 + deckY - 85) / 2, 425, 135)
    ctx.closePath()
    ctx.fill()
    ctx.save()
    ctx.clip()
    for (let i = 0; i < 2200; i++) dab(ctx, 420 + rand() * 560, 130 + rand() * (deckY - 220), 18 + rand() * 30, 2, Math.PI / 2 + (rand() - 0.5) * 0.1, hsl(38, 26, 55 + rand() * 25), 0.18)
    for (let x = 460; x < 960; x += 70) {
      ctx.strokeStyle = 'rgba(90,70,45,0.25)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x, 140)
      ctx.lineTo(x + 6, deckY - 90)
      ctx.stroke()
    }
    ctx.restore()
    // rigging
    ctx.strokeStyle = 'rgba(40,28,18,0.8)'
    ctx.lineWidth = 2
    for (const [x1, y1, x2, y2] of [[700, 80, 110, deckY - 140], [700, 80, 1320, deckY - 160], [420, 130, 300, deckY], [980, 120, 1100, deckY]]) {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    // steering oar at the stern
    ctx.strokeStyle = hsl(26, 28, 20)
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.moveTo(210, deckY - 170)
    ctx.lineTo(80, deckY + 190)
    ctx.stroke()
    ctx.fillStyle = hsl(26, 28, 20)
    ctx.beginPath()
    ctx.ellipse(90, deckY + 170, 22, 60, 0.35, 0, Math.PI * 2)
    ctx.fill()
    return finish(c, { seed, rim: 0.9, rimWidth: 4, key: 0.4, mottle: 0.14, rimColor: SAND_RIM })
  }

  window.ARTKIT = window.ARTKIT || {}
  window.ARTKIT.dune = {
    'dune-far': duneFar,
    'dune-mid': duneMid,
    'dune-near': duneNear,
    pyramids: () => pyramids(241),
    sphinx: () => sphinx(251),
    'rocks-sandstone': () => rocksSandstone(261),
    palm: () => palm(271, 0.12),
    'palm-b': () => palm(277, -0.1),
    sand: () => sand(281),
  }
  window.ARTKIT.tide = {
    'bank-far': () => bankFar(311),
    'bank-near': () => bankNear(321),
    reeds: () => reeds(331),
    papyrus: () => papyrus(341),
    boat: () => boat(351),
  }
})()
