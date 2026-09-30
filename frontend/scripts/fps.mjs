/**
 * Headless scroll frame-rate check (installed Edge, real GPU). Needs the dev
 * server running. Warms up twice so PerformanceMonitor settles the DPR, then
 * scrolls the whole story (6s per chapter, through every transition) and reports
 * GPU texture counts before/after (art is released behind you) plus average fps, p95 frame time,
 * frames over 20ms and the final canvas size.
 *
 *   npm run fps
 *   npm run fps -- --story giza
 */
import { chromium } from 'playwright'

const storyArg = process.argv.indexOf('--story')
const story = storyArg > 0 ? process.argv[storyArg + 1] : undefined
const url = `http://localhost:5173/story/${story ?? 'kyoto'}`
const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto(url, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__lenis)
  await p.waitForTimeout(3500)
  for (let warm = 0; warm < 2; warm++) await p.evaluate(async () => { window.__lenis.scrollTo(2.2 * innerHeight, { duration: 3 }); await new Promise((r) => setTimeout(r, 3200)); window.__lenis.scrollTo(0, { duration: 3 }); await new Promise((r) => setTimeout(r, 3200)) })
  const r = await p.evaluate(async () => {
    const CH = window.__story.chapterStates.length
    const STORY = CH * 2.5
    const mem0 = { ...window.__gl.info.memory }
    const frames = []; let last = performance.now(), run = true
    const tick = (t) => { frames.push(t - last); last = t; if (run) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    window.__lenis.scrollTo(STORY * innerHeight, { duration: 6 * CH })
    await new Promise((res) => setTimeout(res, 6000 * CH + 300)); run = false
    frames.shift()
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length
    const s = [...frames].sort((a, b) => a - b)
    const c = document.querySelector('canvas')
    const mem1 = { ...window.__gl.info.memory }
    return { chapters: CH, texBefore: mem0.textures, texAfter: mem1.textures, geoAfter: mem1.geometries, fps: +(1000 / avg).toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), over20: frames.filter((f) => f > 20).length, n: frames.length, canvas: [c.width, c.height] }
  })
  console.log(`${w}x${h}`, JSON.stringify(r))
  await p.close()
}
await b.close()
