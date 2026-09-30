import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Dev-only: POST a PNG data URL to /__capture?name=foo and it is written to
 * .captures/foo.png. Used for scripted screenshot comparisons from the browser.
 */
function devCapture(): Plugin {
  const dir = fileURLToPath(new URL('./.captures', import.meta.url))
  return {
    name: 'dev-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const name = (new URL(req.url ?? '/', 'http://local').searchParams.get('name') ?? 'capture').replace(
          /[^\w.-]/g,
          '_',
        )
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          const base64 = Buffer.concat(chunks).toString().replace(/^data:image\/png;base64,/, '')
          mkdirSync(dir, { recursive: true })
          writeFileSync(join(dir, `${name}.png`), Buffer.from(base64, 'base64'))
          res.end('ok')
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), devCapture()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // The FastAPI backend (uvicorn on :8000). Same-origin /api calls: no CORS, and it works over the LAN.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
})
