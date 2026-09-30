/**
 * Paints a template's elements and writes them as webp with alpha to
 * public/artkits/<template>/painted/ (shared by every kit of that template).
 *
 *   npm run kit                                  # threshold, all elements
 *   npm run kit -- --template dune               # all dune elements
 *   npm run kit -- --template tide boat reeds    # just these
 *
 * The painters run in a real browser canvas via the installed Microsoft Edge
 * (painters.js holds the shared helpers + Threshold; painters-*.js add other
 * templates), and each result is exported with toDataURL('image/webp').
 * kit.json files are hand-authored and not touched, so any generated file can be
 * replaced by real painted art of the same name.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = fileURLToPath(new URL('.', import.meta.url))
const argv = process.argv.slice(2)
const ti = argv.indexOf('--template')
const template = ti >= 0 ? argv[ti + 1] : 'threshold'
const only = ti >= 0 ? argv.filter((_, i) => i !== ti && i !== ti + 1) : argv
const outDir = join(here, `../../public/artkits/${template}/painted`)

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ path: join(here, 'painters.js') })
  for (const f of readdirSync(here).filter((f) => /^painters-.+.js$/.test(f))) {
    await page.addScriptTag({ path: join(here, f) })
  }
  const names = await page.evaluate((t) => Object.keys(window.ARTKIT[t] ?? {}), template)
  if (!names.length) throw new Error(`No painters registered for template "${template}"`)
  for (const name of names) {
    if (only.length && !only.includes(name)) continue
    const t0 = Date.now()
    const { url, w, h } = await page.evaluate(
      ([t, n]) => {
        const c = window.ARTKIT[t][n]()
        return { url: c.toDataURL('image/webp', 0.9), w: c.width, h: c.height }
      },
      [template, name],
    )
    const buf = Buffer.from(url.split(',')[1], 'base64')
    writeFileSync(join(outDir, `${name}.webp`), buf)
    console.log(`${name.padEnd(16)} ${w}x${h}  ${(buf.length / 1024).toFixed(0)} KB  ${Date.now() - t0} ms`)
  }
} finally {
  await browser.close()
}
