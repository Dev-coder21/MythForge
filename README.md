# MythForge

Name a place or a piece of history. MythForge reads Wikipedia, has a free AI model write a short
story grounded in those sources, fact-checks every sentence with a second model, and renders the
result as a cinematic, scroll-driven 3D site.

Everything runs locally and uses only free services (Wikipedia, Wikimedia Commons, the Gemini and
Groq free tiers, or a local Ollama model).

## Run it

Requirements: Node 20+ and Python 3.11+.

```bash
npm run setup
```

That creates `backend/.venv`, installs the Python and npm dependencies, and reminds you to create
`backend/.env`. Copy `backend/.env.example` to `backend/.env` and fill in:

- `GEMINI_API_KEY`: free at https://aistudio.google.com/apikey
- `GROQ_API_KEY`: free at https://console.groq.com/keys (fallback, and the default fact checker)
- `HTTP_CONTACT`: an email or URL; Wikimedia requires contact info in every request

Then start the backend and frontend together:

```bash
npm run dev
```

Open http://localhost:5173. The API runs on :8000 and is proxied at `/api`, so the same address
also works from a phone on your network. Ctrl+C stops both servers.

## Pages

- `/`: type a topic; generation progress shows live (sources, writing, fact check, scenes)
- `/story/:slug`: the story, with a Sources panel (sources, fact-check score, image credits)
- `/gallery`: every generated story plus the hand-written Kyoto and Giza examples

## Other commands

| Where | Command | What it does |
|---|---|---|
| `frontend/` | `npm run test` | spec and copy-rule tests (also checks `backend/samples`) |
| `frontend/` | `npm run shots` | screenshots at 390px and 1440px into `frontend/.captures` |
| `frontend/` | `npm run build` | type check and production build |
| `backend/` | `.venv/Scripts/python -m pytest` | backend tests (use `.venv/bin/python` on macOS/Linux) |
| `backend/` | `.venv/Scripts/python -m scripts.generate_samples` | regenerate `backend/samples` |

See `CLAUDE.md` and `docs/` for the architecture and the design rules.

## Privacy

MythForge runs on your machine. The topic you type is sent to Wikipedia, Wikimedia Commons and the
AI providers you configured; stories, posters and the cache stay in `backend/` on your disk.
