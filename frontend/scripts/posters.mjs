/**
 * Featured gallery posters: opens each built-in story with ?capture-poster (dev only),
 * lets the renderer take its first-chapter frame, and copies it to public/posters/<slug>.jpg.
 *
 *   npm run posters            # kyoto and giza
 *   npm run posters -- kyoto   # one story
 *
 * Needs the dev server (npm run dev at the project root). Uses installed Microsoft Edge, like shots.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ['kyoto', 'giza']
const base = process.env.MF_URL ?? 'http://localhost:5173'
const out = join(root, 'public', 'posters')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
})
try {
  for (const slug of slugs) {
    const captured = join(root, '.captures', `poster-${slug}.jpg`)
    rmSync(captured, { force: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await page.goto(`${base}/story/${slug}?capture-poster`, { waitUntil: 'load' })
    for (let i = 0; i < 60 && !existsSync(captured); i++) await page.waitForTimeout(500)
    await page.close()
    if (!existsSync(captured)) throw new Error(`no poster captured for ${slug}`)
    copyFileSync(captured, join(out, `${slug}.jpg`))
    console.log(`public/posters/${slug}.jpg`)
  }
} finally {
  await browser.close()
}
