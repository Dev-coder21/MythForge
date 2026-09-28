/**
 * Headless scroll frame-rate check (installed Edge, real GPU). Needs the dev
 * server running. Warms up twice so PerformanceMonitor settles the DPR, then
 * scrolls the whole chapter in 6s and reports average fps, p95 frame time,
 * frames over 20ms and the final canvas size.
 *
 *   npm run fps
 */
import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto('http://localhost:5173/', { waitUntil: 'load' })
  await p.waitForFunction(() => window.__lenis)
  await p.waitForTimeout(3500)
  for (let warm = 0; warm < 2; warm++) await p.evaluate(async () => { window.__lenis.scrollTo(2.5 * innerHeight, { duration: 3 }); await new Promise((r) => setTimeout(r, 3200)); window.__lenis.scrollTo(0, { duration: 3 }); await new Promise((r) => setTimeout(r, 3200)) })
  const r = await p.evaluate(async () => {
    const frames = []; let last = performance.now(), run = true
    const tick = (t) => { frames.push(t - last); last = t; if (run) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    window.__lenis.scrollTo(2.5 * innerHeight, { duration: 6 })
    await new Promise((res) => setTimeout(res, 6300)); run = false
    frames.shift()
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length
    const s = [...frames].sort((a, b) => a - b)
    const c = document.querySelector('section canvas')
    return { fps: +(1000 / avg).toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), over20: frames.filter((f) => f > 20).length, n: frames.length, canvas: [c.width, c.height] }
  })
  console.log(`${w}x${h}`, JSON.stringify(r))
  await p.close()
}
await b.close()
