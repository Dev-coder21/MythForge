/**
 * Headless screenshots of the story at given scroll percentages and widths.
 *
 *   npm run shots                                  # every chapter + both transitions
 *   npm run shots -- --points 1:0,2:0.3 --widths 1440 --url http://localhost:5173/
 *
 * A point is chapter:progress (chapter is 1-based, progress 0–1 through its
 * scroll segment; 0.93 lands mid-transition into the next chapter). A bare
 * number means chapter 1.
 *
 * Uses the installed Microsoft Edge (Playwright channel "msedge"), so no
 * browser download is needed. Starts the Vite dev server itself if nothing is
 * listening on the URL. PNGs go to .captures/<width>_c<chapter>_p<percent>.png.
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
const DEFAULT_POINTS = '1:0,1:0.3,1:0.6,1:0.93,2:0.03,2:0.3,2:0.6,2:0.93,3:0.03,3:0.3,3:0.6'
const points = (args.points ?? DEFAULT_POINTS).split(',').map((p) => {
  const [c, v] = p.includes(':') ? p.split(':') : ['1', p]
  return { chapter: Number(c), p: Number(v) }
})
const widths = (args.widths ?? '390,1440').split(',').map(Number)
const HEIGHTS = { 390: 844, 1440: 900 }
/** Length of one chapter's scroll segment, in viewport heights (StoryExperience CHAPTER_VH). */
const SEGMENT_VH = 2.5

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

const overlaps = []
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
    await page.waitForSelector('canvas')
    await page.waitForTimeout(3500) // intro: letters rise, hero fades in

    for (const { chapter, p } of points) {
      await page.evaluate(
        ([progress, segVh]) => {
          const y = progress * segVh * window.innerHeight
          const lenis = window.__lenis
          if (lenis) lenis.scrollTo(y, { immediate: true })
          else window.scrollTo(0, y)
        },
        [chapter - 1 + p, SEGMENT_VH],
      )
      await page.waitForTimeout(3200) // scrub settles, the next chapter finishes loading, a few frames render
      const tag = `c${chapter}_p${Math.round(p * 100)}`
      // Copy-state check: the hero and the chapter copy must never be visible together.
      const vis = await page.evaluate(() => {
        const effective = (el) => {
          if (!el) return 0
          let op = 1
          for (let n = el; n && n !== document.body; n = n.parentElement) {
            const cs = getComputedStyle(n)
            if (cs.visibility === 'hidden' || cs.display === 'none') return 0
            op *= Number(cs.opacity)
          }
          return op
        }
        const max = (sel) => Math.max(0, ...[...document.querySelectorAll(sel)].map(effective))
        return {
          hero: max('[data-hero] > *'),
          chapter: max('[data-reveal="label"], [data-reveal="heading"] > * > *, [data-reveal="body-mobile"]'),
        }
      })
      const clash = vis.hero > 0.05 && vis.chapter > 0.05
      console.log(`  ${width}px @ ${tag}  hero ${vis.hero.toFixed(2)}  chapter ${vis.chapter.toFixed(2)}${clash ? '  <-- BOTH VISIBLE' : ''}`)
      if (clash) overlaps.push(`${width}px @ ${tag}`)

      const file = join(outDir, `${width}_${tag}.png`)
      await page.screenshot({ path: file })
      console.log(`saved ${file}`)
    }

    if (errors.length) console.warn(`[${width}px] page errors:\n  ${[...new Set(errors)].join('\n  ')}`)
    await page.close()
  }
} finally {
  if (overlaps.length) {
    console.warn(`copy overlap at: ${overlaps.join(', ')}`)
    process.exitCode = 1
  }
  await browser.close()
  if (server) server.kill()
}
