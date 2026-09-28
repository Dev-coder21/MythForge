/**
 * Headless screenshots of the story at given scroll percentages and widths.
 *
 *   npm run shots                         # defaults below
 *   npm run shots -- --points 0,0.3 --widths 1440 --url http://localhost:5173/
 *
 * Uses the installed Microsoft Edge (Playwright channel "msedge"), so no
 * browser download is needed. Starts the Vite dev server itself if nothing is
 * listening on the URL. PNGs go to .captures/<width>_p<percent>.png.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(root, '.captures')

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]])
    return pairs
  }, []),
)
const url = args.url ?? 'http://localhost:5173/'
const points = (args.points ?? '0,0.15,0.3,0.6').split(',').map(Number)
const widths = (args.widths ?? '390,1440').split(',').map(Number)
const HEIGHTS = { 390: 844, 1440: 900 }
/** Length of the pinned chapter, in viewport heights (useChapterTimeline pinLength 250%). */
const PIN_VH = 2.5

async function reachable() {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

async function ensureServer() {
  if (await reachable()) return null
  console.log(`starting dev server for ${url}`)
  const server = spawn('npm', ['run', 'dev'], { cwd: root, shell: true, stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await reachable()) return server
  }
  server.kill()
  throw new Error(`dev server did not come up at ${url}`)
}

const server = await ensureServer()
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  // Real GPU in headless mode; without these, WebGL falls back to a blank canvas.
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
})

try {
  for (const width of widths) {
    const height = HEIGHTS[width] ?? Math.round(width * 0.625)
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

    await page.goto(url, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForSelector('section canvas')
    await page.waitForTimeout(3500) // intro: letters rise, hero fades in

    for (const p of points) {
      await page.evaluate(
        ([progress, pinVh]) => {
          const y = progress * pinVh * window.innerHeight
          const lenis = window.__lenis
          if (lenis) lenis.scrollTo(y, { immediate: true })
          else window.scrollTo(0, y)
        },
        [p, PIN_VH],
      )
      await page.waitForTimeout(2800) // scrub: 1.2 settles, then a few frames render
      const file = join(outDir, `${width}_p${Math.round(p * 100)}.png`)
      await page.screenshot({ path: file })
      console.log(`saved ${file}`)
    }

    if (errors.length) console.warn(`[${width}px] page errors:\n  ${[...new Set(errors)].join('\n  ')}`)
    await page.close()
  }
} finally {
  await browser.close()
  if (server) server.kill()
}
