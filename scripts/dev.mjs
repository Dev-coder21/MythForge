/**
 * One command for local development: FastAPI (uvicorn, :8000) + Vite (:5173) together.
 *
 *   npm run setup   # once: backend venv + pip install, frontend npm install
 *   npm run dev     # both servers, prefixed logs; Ctrl+C stops both
 *   npm run dev -- --reload   # also restart the backend on Python changes
 *
 * The frontend reaches the backend through Vite's /api proxy, so only :5173 needs opening
 * (also from a phone on the same network).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const backend = join(root, 'backend')
const frontend = join(root, 'frontend')
const win = process.platform === 'win32'
const venvPython = join(backend, '.venv', win ? 'Scripts/python.exe' : 'bin/python')

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (process.argv.includes('--setup')) {
  if (!existsSync(venvPython)) run(win ? 'py' : 'python3', ['-3', '-m', 'venv', '.venv'].slice(win ? 0 : 1), backend)
  run(venvPython, ['-m', 'pip', 'install', '-q', '-r', 'requirements.txt'], backend)
  run('npm', ['install'], frontend)
  if (!existsSync(join(backend, '.env'))) console.log('\nNext: copy backend/.env.example to backend/.env and add your free API keys.')
  console.log('Setup done. Start with: npm run dev')
  process.exit(0)
}

if (!existsSync(venvPython)) {
  console.error('The backend virtualenv is missing. Run: npm run setup')
  process.exit(1)
}
if (!existsSync(join(frontend, 'node_modules'))) {
  console.error('Frontend dependencies are missing. Run: npm run setup')
  process.exit(1)
}

const COLORS = { api: '\x1b[33m', web: '\x1b[36m' }
const procs = []

function start(name, cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, shell: win, env: { ...process.env, FORCE_COLOR: '1' } })
  const prefix = `${COLORS[name]}[${name}]\x1b[0m `
  const pipe = (stream, out) => {
    let buf = ''
    stream.on('data', (d) => {
      buf += d.toString()
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const line of lines) out.write(prefix + line + '\n')
    })
  }
  pipe(p.stdout, process.stdout)
  pipe(p.stderr, process.stderr)
  p.on('exit', (code) => {
    console.log(`${prefix}exited (${code ?? 'signal'}), stopping everything`)
    stopAll(code ?? 0)
  })
  procs.push(p)
}

let stopping = false
function stopAll(code = 0) {
  if (stopping) return
  stopping = true
  for (const p of procs) {
    if (p.exitCode !== null) continue
    if (win) spawnSync('taskkill', ['/pid', String(p.pid), '/t', '/f'], { stdio: 'ignore' })
    else p.kill('SIGTERM')
  }
  process.exit(code)
}
process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))

// Auto-reload is opt-in (npm run dev -- --reload): on Windows uvicorn's reloader can hang under piped
// output and keep serving the old code, which is worse than restarting by hand after backend edits.
const reload = process.argv.includes('--reload') ? ['--reload', '--timeout-graceful-shutdown', '3'] : []
start('api', venvPython, ['-m', 'uvicorn', 'app.main:app', '--port', '8000', ...reload], backend)
start('web', 'npm', ['run', 'dev', '--', '--host'], frontend)
console.log('MythForge: http://localhost:5173  (API on :8000, proxied at /api)')
