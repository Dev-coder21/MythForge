/**
 * Paints the Threshold template's elements and writes them as webp with alpha
 * to public/artkits/threshold/painted/ (shared by every kit of the template).
 *
 *   npm run kit                 # all elements
 *   npm run kit -- torii hill   # just these
 *
 * The painters (painters.js) run in a real browser canvas via the installed
 * Microsoft Edge, and each result is exported with toDataURL('image/webp').
 * kit.json (placement, depth, sway, lights) is hand-authored and not touched,
 * so any generated file can be replaced by real painted art of the same name.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = fileURLToPath(new URL('.', import.meta.url))
// Shared by every Threshold kit; each kit.json references these by relative path.
const outDir = join(here, '../../public/artkits/threshold/painted')
const only = process.argv.slice(2)

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ path: join(here, 'painters.js') })
  const names = await page.evaluate(() => Object.keys(window.ARTKIT))
  for (const name of names) {
    if (only.length && !only.includes(name)) continue
    const t0 = Date.now()
    const { url, w, h } = await page.evaluate((n) => {
      const c = window.ARTKIT[n]()
      return { url: c.toDataURL('image/webp', 0.9), w: c.width, h: c.height }
    }, name)
    const buf = Buffer.from(url.split(',')[1], 'base64')
    writeFileSync(join(outDir, `${name}.webp`), buf)
    console.log(`${name.padEnd(8)} ${w}x${h}  ${(buf.length / 1024).toFixed(0)} KB  ${Date.now() - t0} ms`)
  }
} finally {
  await browser.close()
}
