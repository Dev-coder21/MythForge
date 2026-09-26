# MythForge

AI engine that turns any topic into a cinematic, scroll-driven 3D story site.
Topic → Wikipedia facts → Claude writes a validated **story spec (JSON)** → the frontend renders it as a layered 3D scroll experience.

The 3D scroll experience is the product's main selling point. Visual quality comes before feature count.

## Docs (read the relevant one before starting a task)
- `docs/SPEC.md` — full build spec (architecture, DB, pipeline, roadmap)
- `docs/EXPERIENCE_SPEC.md` — the quality bar and techniques for the 3D scroll story. **Read this before any frontend/3D work.**

## Stack
- Frontend: Vite + React + TypeScript (strict), @react-three/fiber, @react-three/drei, @react-three/postprocessing, GSAP + ScrollTrigger + SplitText, Lenis (smooth scroll), Tailwind for UI chrome, leva for debug panels
- Backend: FastAPI (Python 3.11+), Pydantic v2, Anthropic Claude API with tool calling
- DB: PostgreSQL (Supabase/Neon)

## Repo layout
```
frontend/src/
  experience/        # the 3D story renderer (the USP)
    scenes/          # scene templates: Threshold, Peak, Tide, Skyline, Dune...
    layers/          # DepthLayer, TitleLayer, Particles, Fog, Water, Grass shaders
    camera/          # per-chapter camera paths (CatmullRom), scroll binding
    post/            # postprocessing stack
    transitions/     # shader wipes between chapters
  spec/              # StorySpec TS types + sample specs (sample-kyoto.json ...)
  components/        # UI chrome (nav, chapter ticker, progress, loader)
  pages/
frontend/public/artkits/<template>/   # layered transparent art per template
backend/app/{api,retrieval,llm_pipeline,schemas,models,core}
```

## Rules
- The frontend only renders a `StorySpec`. It never calls the LLM. Keep `frontend/src/spec/types.ts` and `backend/app/schemas/story.py` in sync.
- Scene templates take ALL variation from props (`SceneParams`). No topic-specific code inside templates.
- Never parse free text from the LLM. Tool calling + Pydantic validation + max 2 retries.
- Performance budget: steady 60fps on a mid-range laptop. Cap DPR at 1.75, instance particles, compress textures (webp/KTX2), lazy-load chapter art.
- Respect `prefers-reduced-motion` (disable scrub camera moves, keep fades).
- Original work only: do not copy code, shaders, artwork or layouts from Kage/threeui or any other template. Techniques are fine; assets and code must be ours.

## Commands
- Frontend: `cd frontend && npm run dev` / `npm run build` / `npm run test`
- Backend: `cd backend && uvicorn app.main:app --reload` / `pytest`

## Working style
- Build in small slices; after each slice run the dev server and check it in the browser before continuing.
- Commit after every working slice.
- When changing visuals, expose new values in the leva panel so they can be tuned live.
