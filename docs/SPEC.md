# MASTER BUILD SPECIFICATION — MythForge

An AI-powered engine that generates immersive, Kage-style cinematic scroll experiences for any topic or place — automatically retrieving real content, writing editorial-voice copy, and assembling a living 3D scene with scroll-driven choreography. This document is written to be handed directly to an AI coding assistant (Claude Code, Antigravity, Cursor, etc.) as a complete build brief.

---

## 1. Elevator Pitch
A user types a topic ("Kyoto temples," "the history of jazz," "a city's food scene"). MythForge retrieves real facts and images, has an LLM structure and write the narrative in a moody editorial voice, then procedurally assembles a multi-chapter, scroll-driven 3D story site — big kinetic typography, parallax 3D scenes, particle effects — and renders it live in the browser. This is not one site; it's a **site-generation engine**.

## 2. The Core Engineering Insight (read this before anything else)
You cannot realistically have an AI generate novel photorealistic 3D models per topic in a few weeks. The solution: build a small curated library of **parameterized scene templates** — reusable Three.js scenes (a threshold/gate, a mountain peak, an ocean, a forest, an urban skyline, a desert, a night sky/cosmos, ancient ruins) each built once by you with tunable parameters (accent colors, particle type, ground type, prop variant, background object). The LLM's actual job per chapter is: **pick the best-fitting template + choose its parameters + write the copy** — a structured classification/generation task, not open-ended 3D generation. This is what makes the whole idea tractable.

## 3. Core Modules (build in this priority order)
1. **Scene Template Library** (6-8 parameterized Three.js/R3F scenes) — CRITICAL, build this FIRST since everything depends on it
2. **Content Retrieval Pipeline** (Wikipedia/web search + image sourcing) — CRITICAL
3. **LLM Story Structuring Pipeline** (chapters, copy, template selection, params) — CRITICAL, the differentiator
4. **Rendering Engine** (takes a "story spec" JSON, renders the full scroll experience) — CRITICAL
5. **Generation Dashboard** (input topic, watch it generate, browse past stories) — CRITICAL
6. **Caching & story gallery/sharing** — Important
7. **Auth, monitoring, full CI/CD** — Nice-to-have

## 4. Data Sources (real, free, public)
- **Wikipedia REST API / Wikivoyage API** — free, structured factual content and summaries for places, topics, history
- **Wikimedia Commons API** — free, properly-licensed real photos (critical: avoids copyright issues that a generic image scrape would create)
- **Unsplash API** (free tier, attribution required) — as a secondary/fallback image source for topics with thin Wikimedia coverage
- **Anthropic Claude API or OpenAI API** — the LLM doing story structuring, copywriting, and template/parameter selection (use structured output / tool calling to force valid JSON matching your scene-template schema)
- **Note on honesty:** state clearly in your README that "3D scenes" are procedurally assembled from a fixed template library, not generated per-topic from scratch — this is the accurate and impressive claim; overclaiming "AI generates 3D models" would be a credibility risk in an interview.

## 5. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 React Frontend (Vite) + react-three-fiber         │
│  Topic Input | Generation Progress | Rendered Story Experience    │
│  Story Gallery                                                     │
└───────────────────────────┬───────────────────────────────────────┘
                             │ REST/WebSocket (generation progress)
┌───────────────────────────▼───────────────────────────────────────┐
│                      FastAPI Backend (Python)                      │
│      /generate   /stories   /stories/{id}   /templates             │
└──────┬──────────────┬──────────────┬───────────────────────────────┘
       │              │              │
┌──────▼─────┐ ┌──────▼──────┐ ┌─────▼──────────────────────────────┐
│ Content     │ │  LLM Story   │ │  Story Spec Assembler                │
│ Retrieval   │ │  Structuring │ │  (validates LLM output against       │
│ (Wikipedia +│ │  Pipeline    │ │  scene-template schema, resolves      │
│ Commons/    │ │  (chapters,  │ │  image URLs, finalizes JSON)          │
│ Unsplash)   │ │  copy, scene │ │                                       │
│             │ │  selection)  │ │                                       │
└──────┬─────┘ └──────┬───────┘ └─────┬─────────────────────────────────┘
       │              │               │
       └──────────────┴───────┬───────┘
                               │
                    ┌──────────▼──────────┐
                    │   PostgreSQL DB       │
                    │  stories, chapters,    │
                    │  generation_jobs,      │
                    │  cached_content         │
                    └──────────┬─────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Object Storage        │
                    │ (Supabase Storage/S3)  │
                    │  cached images          │
                    └───────────────────────┘

Frontend renders the final "story spec" JSON using the Scene Template
Library (Module 1) — this is the reusable Three.js component set that
never changes per-topic, only its input parameters do.

Deployment: Docker Compose locally → Frontend on Vercel/Netlify,
Backend on Render/Railway, DB on Supabase/Neon, images on Supabase Storage
```

## 6. Database Schema (PostgreSQL)

```sql
stories (
  id UUID PK, topic VARCHAR, title VARCHAR, subtitle VARCHAR,
  status ENUM(generating/complete/failed), created_at, share_slug VARCHAR
)

chapters (
  id UUID PK, story_id FK, chapter_index INT,
  chapter_label VARCHAR,      -- e.g. "CHAPTER 01 — THE HIDDEN GATE"
  heading TEXT, subheading TEXT, body_copy TEXT,
  scene_template_id VARCHAR,  -- references template library key
  scene_params JSONB,         -- { primaryColor, accentColor, particleType,
                               --   groundType, propVariant, backgroundObject }
  hero_image_url TEXT, image_attribution TEXT
)

generation_jobs (
  id UUID PK, story_id FK, stage ENUM(retrieving/structuring/assembling/done/error),
  progress_pct INT, error_message TEXT, started_at, completed_at
)

cached_content (
  id UUID PK, source_type ENUM(wikipedia/commons/unsplash),
  query VARCHAR, raw_content JSONB, fetched_at
)
```

## 7. Pipeline Detail

**Content Retrieval:**
- Given a topic, query Wikipedia REST API for the summary + relevant sections; for place-based topics, also try Wikivoyage
- Query Wikimedia Commons for topically-related, properly-licensed images (fallback to Unsplash if thin)
- Cache all retrieved content in `cached_content` — avoids re-hitting APIs for repeat/similar topics and respects rate limits

**LLM Story Structuring (the core pipeline):**
- Input: retrieved raw content + topic
- Task 1 — **Chapter planning:** LLM breaks the topic into 3-5 narrative chapters with a clear arc (e.g., for "Kyoto temples": Threshold → Gardens → Ritual → Afterlight), each with a working title
- Task 2 — **Copywriting:** for each chapter, LLM writes a short, moody, editorial-style heading + one-paragraph subheading in the reference tone ("WHERE STILLNESS REVEALS THE UNSEEN.") — write a strong system prompt with 2-3 style examples to lock this tone in
- Task 3 — **Scene template selection + parameterization:** LLM is given the schema of available templates (Section 8) and must output, per chapter, a `scene_template_id` and a `scene_params` object matching that template's parameter schema exactly
- **Use structured output / forced JSON schema (tool calling)** for all three tasks — never free-text-parse the LLM's response, this avoids a whole category of bugs and is worth stating as a deliberate engineering choice in your README
- Validate every LLM output against a strict Pydantic schema before writing to the DB; retry with an error-correction prompt if validation fails

**Story Spec Assembly:**
- Combine chapters + resolved image URLs + template params into one finalized JSON "story spec" per story
- This JSON is the single contract between backend and frontend — the frontend never talks to the LLM directly, it only ever renders a story spec

## 8. Scene Template Library (build this first, it's the foundation)

Build 6-8 templates as react-three-fiber components, each accepting a shared prop shape:

```typescript
type SceneParams = {
  primaryColor: string;        // hex
  accentColor: string;         // hex
  particleType: 'petals' | 'snow' | 'embers' | 'fireflies' | 'dust' | 'none';
  groundType: 'grass' | 'sand' | 'water' | 'stone' | 'void';
  backgroundObject: 'moon' | 'sun' | 'stars' | 'clouds' | 'none';
  propVariant: string;         // template-specific, e.g. 'gate' | 'tower' | 'tree'
}
```

**Templates to build:**
1. **Threshold** (gate/torii-style silhouette, parallax layers) — reference template
2. **Peak** (mountain silhouette, mist layers)
3. **Tide** (ocean/water plane with animated shader waves)
4. **Grove** (tree silhouettes, layered forest depth)
5. **Skyline** (urban silhouette, window-light particles)
6. **Dune** (desert, gradient sky, heat-shimmer shader)
7. **Cosmos** (starfield, nebula-gradient background, minimal foreground)
8. **Ruin** (broken/ancient architecture silhouette, dust particles)

Each template: layered parallax planes (simple extruded/primitive geometry + gradient/shader materials, NOT complex modeled assets — Kage's own gate/moon/grass are simple primitives and shaders, not detailed models), a particle system (instanced meshes, 200-500 particles is plenty), and a real photo (from content retrieval) composited as a soft background/texture layer for authenticity.

## 9. API Endpoints (FastAPI)
```
POST /generate                  { topic } -> starts a generation_job, returns job id
GET  /generate/{job_id}/status  poll generation progress (or use WebSocket)
GET  /stories                   list completed stories (gallery)
GET  /stories/{id}              full story spec JSON for rendering
GET  /templates                 list available scene templates + their param schemas
```

## 10. Frontend Design System — make it look "dope"

**Visual direction:** exactly the reference aesthetic — dark, cinematic, oversized kinetic typography bleeding off-screen, generous negative space, a single accent color per chapter that shifts as you scroll.

- **Typography:** one large display serif or condensed sans for chapter titles (massive scale, like the reference's "KAGE" letters), a clean humanist sans for body copy
- **Layout:** full-viewport chapters, chapter number ticker (01/02/03/04) always visible, a scroll progress indicator
- **Signature visual moment:** the scroll-driven camera move through each 3D scene — as the user scrolls, the Three.js camera should dolly/pan through the template scene while text and particles parallax at different speeds, exactly like the reference

**Animation stack:**
- **react-three-fiber + drei** for the 3D scene layer
- **GSAP + ScrollTrigger** to drive the scroll-linked camera movement, text reveals, and chapter transitions — this is the same core tech the reference template uses
- **Framer Motion** for UI chrome (nav, progress indicators, the generation-progress screen)
- Keep particle counts modest (a few hundred instanced meshes) and use simple shader materials — performance matters more than absolute complexity; a smooth 60fps scroll beats a laggy "impressive" scene

**Component approach:** Vite + React + TypeScript, react-three-fiber for 3D, GSAP for scroll choreography, Tailwind for UI chrome.

## 11. Tech Stack Summary
- Frontend: React (Vite) + TypeScript, react-three-fiber + drei, GSAP/ScrollTrigger, Framer Motion, Tailwind CSS
- Backend: FastAPI (Python 3.11+), Pydantic v2 (strict schema validation on all LLM outputs)
- DB: PostgreSQL (Supabase or Neon)
- LLM: Anthropic Claude API (structured output/tool calling) for chapter planning, copywriting, and template selection
- Content APIs: Wikipedia REST API, Wikivoyage, Wikimedia Commons API, Unsplash (fallback)
- Storage: Supabase Storage (cached images)
- Background jobs: simple async task (FastAPI BackgroundTasks) or Celery+Redis if generation needs to be queued
- Deployment: Docker + docker-compose locally; Render/Railway backend, Vercel/Netlify frontend
- Testing: pytest (schema validation tests are especially important here), Vitest/React Testing Library

## 12. Week-by-Week Roadmap (5-6 weeks — this is a genuinely ambitious build, budget accordingly)

**Week 1 — Scene Template Library**
- Build 3 templates fully (Threshold, Peak, Tide) with the shared param schema, hardcoded test values
- Get the GSAP ScrollTrigger camera-dolly working smoothly through one scene
- *Done when:* you can manually pass different `SceneParams` into one template and see it visibly change color/particles/props, scrolling smoothly at 60fps.

**Week 2 — Remaining Templates + Content Retrieval**
- Build the remaining 3-5 templates
- Build Wikipedia/Commons retrieval pipeline, caching layer
- *Done when:* all 6-8 templates render correctly with varied params, and you can pull real content + images for 3 test topics.

**Week 3 — LLM Story Structuring Pipeline**
- Build the 3-task LLM pipeline (chapter planning, copywriting, template/param selection) with strict structured output + Pydantic validation
- Test on 5-10 diverse topics, manually review output quality and tone consistency
- *Done when:* for a new topic, the pipeline reliably produces a valid, schema-correct story spec with copy that matches the target editorial tone.

**Week 4 — Story Spec Assembly + Rendering Integration**
- Wire the story spec JSON into the frontend renderer — dynamic chapter count, dynamic template selection per chapter
- Build the generation-progress UI (polling or WebSocket)
- *Done when:* typing a topic in the UI produces a fully rendered, scrollable, correctly-choreographed story end to end.

**Week 5 — Gallery, Polish, Edge Cases**
- Build the story gallery (browse past generations), sharing via `share_slug`
- Handle failure cases gracefully (LLM validation failures, thin content topics, retry logic)
- Full animation/typography polish pass
- *Done when:* 10 different topics all generate successfully without manual intervention, and failures degrade gracefully rather than crashing.

**Week 6 — Deploy & Document**
- Docker deploy to cloud, performance pass (check mobile/lower-end device scroll performance)
- Write README (include the Section 2 honesty note on the template-library approach), record a demo video generating 2-3 different stories live

## 13. Engineering Guardrails & Acceptance Criteria

**LLM output reliability:** This project lives or dies on structured output working reliably. Use tool calling / forced JSON schema from day one, never regex-parse free text. Build a validation+retry loop (max 2 retries with an error-correction prompt) before treating a generation as failed.

**Content quality floor:** Some topics will have thin Wikipedia coverage. Build a minimum-content check before starting LLM structuring — if retrieval returns too little, either broaden the query or surface a clear "try a different topic" message rather than generating a low-quality story.

**Performance:** Three.js scenes must stay performant — cap particle counts, use instanced meshes, lazy-load chapters not yet in view. Test on a mid-range device, not just your dev machine.

**Cost reality check:** Each generation costs real LLM API tokens (3 tasks × however many chapters) plus image API calls. Cache aggressively (the `cached_content` table exists specifically for this) and consider a simple rate limit on `/generate` in the public demo so costs stay bounded.

**Image licensing:** Only use Wikimedia Commons (properly licensed) or Unsplash (with attribution) — never scrape arbitrary images. Store attribution in `image_attribution` and display it in the UI; this is both a legal necessity and a professionalism signal.

**Secrets/env:** `.env` with `DATABASE_URL`, `LLM_API_KEY`, `UNSPLASH_API_KEY`; provide `.env.example`.

**Definition of done for the whole project:** deployed at a public URL, a user can type any reasonable topic and get a fully rendered, smoothly-scrolling cinematic story within a reasonable wait time, README explains the template-library architecture honestly, and a demo video shows at least 2 different generated topics to prove genuine dynamism (not one hardcoded example).

---

## Resume Bullet (draft, refine after building)
"Built MythForge, a generative engine that transforms any topic into an immersive, scroll-driven cinematic web experience; designed a parameterized Three.js scene-template system and an LLM pipeline (structured output, multi-stage chapter planning and copywriting) that dynamically retrieves real content and assembles a fully choreographed 3D narrative end-to-end."

## Repo Structure
```
mythforge/
├── backend/
│   ├── app/
│   │   ├── api/            # FastAPI routers
│   │   ├── models/         # SQLAlchemy models
│   │   ├── retrieval/       # Wikipedia/Commons/Unsplash clients + caching
│   │   ├── llm_pipeline/    # chapter planning, copywriting, template selection
│   │   ├── schemas/         # Pydantic schemas (incl. SceneParams validation)
│   │   └── core/            # config, db session
│   ├── tests/
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── scenes/          # the 6-8 scene template components
│   │   ├── components/      # UI chrome (nav, progress, gallery)
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── lib/
│   ├── tests/
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## How to Use This Document
Build Module 1 (Scene Template Library) completely and get it looking genuinely good with hardcoded params before touching any LLM or backend code — it's the visual core of the whole product and the part most likely to eat unplanned time. Only once 2-3 templates render and scroll beautifully should you move to content retrieval and the LLM pipeline. Hand this document to your AI coding assistant one module at a time, in the priority order from Section 3, following the Week-by-Week Roadmap in Section 12.
