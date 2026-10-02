# MythForge

Type a place or a piece of history. MythForge reads the sources, writes a short fact-checked story, and renders it as a cinematic, scroll-driven 3D site.

![Kyoto · chapter one at night: a torii gate on a hill, lanterns, falling blossoms and the chapter title rising behind the grass](docs/screenshots/kyoto-torii-night.jpg)

**Live showcase:** https://dev-coder21.github.io/MythForge/ (the gallery and finished stories, served as a static site; writing new stories runs locally, see below).

Everything runs locally on free services: Wikipedia and Wikimedia Commons for sources and images, the Gemini and Groq free tiers (or a local Ollama model) for writing and fact checking.

## Screenshots

| | |
|---|---|
| ![Kyoto garden at dusk](docs/screenshots/kyoto-garden-dusk.jpg) | ![Giza at sunset](docs/screenshots/giza-sunset.jpg) |
| Kyoto · a temple garden at dusk | Giza · the pyramids at sunset |
| ![The Sphinx under the moon](docs/screenshots/giza-sphinx-moon.jpg) | ![A cargo boat on the Nile at dawn](docs/screenshots/giza-nile-dawn.jpg) |
| Giza · the Sphinx under a full moon | Giza · a stone barge on the Nile at dawn |
| ![Mount Everest story at night](docs/screenshots/everest-peak-night.jpg) | ![Homepage](docs/screenshots/homepage.jpg) |
| A generated Mount Everest story on the Peak scene | The homepage over a live, dimmed chapter |
| ![Generation progress](docs/screenshots/generating.jpg) | ![Gallery](docs/screenshots/gallery.jpg) |
| Generation progress with the real pipeline stages | The gallery with frames captured from each story |

Kyoto and Giza are hand-written example stories. The Everest story was generated end to end from the homepage.

## How it works

```mermaid
flowchart LR
    T[Topic] --> R[Retrieval<br/>Wikipedia summary + sections<br/>Commons images with licences]
    R -->|too thin| X[Rejected with a clear message]
    R --> W[LLM writer<br/>one call returns the whole draft]
    W --> V{Validation<br/>schema + copy rules<br/>numbers and sources grounded<br/>kit and setting rules}
    V -->|errors, max 2 corrections| W
    V --> F[Fact check by a different model<br/>every sentence against the sources]
    F -->|unsupported| W2[One rewrite, then remove what is still unsupported]
    F --> S[(Story spec JSON)]
    W2 --> S
    S --> UI[React Three Fiber renderer<br/>layered scene templates, GSAP scroll, shader transitions]
```

1. **Retrieval.** The backend fetches the Wikipedia summary and the most relevant sections (about 1,400 words), plus openly licensed Commons images with author credit. Topics without enough material are rejected before any model call.
2. **Writing.** One LLM call returns the full draft: chapter headings, body copy, a source per chapter, and the scene choice for each chapter (template, art kit, time of day, colours, particles, transition).
3. **Validation.** Pydantic checks the shape, then the copy rules (no em dashes, no contrast-by-negation phrasing, a cliche list, heading length, no numbers in headings), then grounding rules: every number must appear in the source text, every source must be one that was retrieved, landmark art only for its own landmark, and one setting per story. Errors go back to the model for up to two corrections.
4. **Fact check.** A second model, never the one that wrote the story, checks every sentence against the source text. Hedged facts stated as certain count as unsupported. Unsupported sentences get one rewrite; anything still unsupported is removed, and the score is stored with the story.
5. **Rendering.** The frontend only renders the story spec. Each chapter is a layered 3D scene built from a template and a hand-painted art kit, driven by scroll.

## Key engineering decisions

**A template library instead of generated 3D.** Generating scenes from scratch looks inconsistent and is slow. MythForge ships a small set of scene templates (eleven families, from Threshold and Dune to Harbor, Ice and Abstract), each with painted art kits and code-driven light, fog, particles and camera paths. The model picks and parameterises them. Variety comes from the spec, and quality comes from the art direction.

**The story spec is the contract.** `frontend/src/spec/types.ts` and `backend/app/schemas/story.py` describe the same JSON. The frontend never calls a model, and the backend never ships layout code. The copy and palette rules live in one file (`backend/app/schemas/copy_rules.json`) that both the backend validator and the frontend tests read.

**A provider-agnostic chain of free models.** Gemini, Groq and Ollama sit behind one small interface over plain HTTP, with no SDKs. The chain falls back automatically, waits out per-minute limits using the provider's retry hint, tells daily quotas apart from per-minute ones, and benches a failing model for a few minutes. Extra Groq models act as writer fallbacks, since each has its own daily cap. Every step reports live progress to the UI.

**Two-model grounding.** The writer never grades itself. The fact check runs on a different model from a separate list, and its score, the flagged sentences and both model names are stored and shown in each story's Sources panel. A failed rewrite (quota, invalid draft) keeps the checked first version instead of dropping the report.

**An art-kit pipeline.** Painted elements come in on flat green or magenta. `process_raw.py` removes the watermark without damaging the art under it, cuts the element out with rembg (BiRefNet) tightened by a narrow chroma key, removes colour spill, keeps soft alpha for clouds and mist, and grades each set to shared mid tones so the scene's night, dawn and day lighting reads on it. Every painted file has a code-painted fallback of the same name.

**A performance budget, measured.** The target is a steady 60 fps on a mid-range laptop. Device pixel ratio is capped by a pixel budget and adapted at runtime, only the current and next chapter are mounted, and textures are compressed webp. `npm run fps` scrolls a whole story in headless Edge with the GPU on and reports frame times: about 88 fps at 1440×900 and 90 fps at 390×844 on the Everest story (p95 frame time 11.3 ms).

## Scene families

Eleven generic or landmark scene families, each a layered template with its own painted art kit, camera path,
time-of-day lighting (night, dawn, day, dusk), particles and a hero slot for an AI-painted landmark. The writer
picks the family from a catalog; people, music, history and ideas go to Abstract instead of a random landscape.

| | | |
|---|---|---|
| ![Threshold: Kyoto torii at night](docs/screenshots/kyoto-torii-night.jpg) | ![Dune: Giza at sunset](docs/screenshots/giza-sunset.jpg) | ![Tide: the Nile at dawn](docs/screenshots/giza-nile-dawn.jpg) |
| **Threshold** · shrines, gardens, approaches | **Dune** · deserts (generic erg, Giza landmark kits) | **Tide** · rivers |
| ![Peak](docs/screenshots/scene-peak.jpg) | ![Old city](docs/screenshots/scene-oldcity.jpg) | ![Ancient ruins](docs/screenshots/scene-ruins.jpg) |
| **Peak** · mountains and volcanoes | **Old city** · cities and urban monuments | **Ancient ruins** · archaeological sites |
| ![Harbor](docs/screenshots/scene-harbor.jpg) | ![Forest](docs/screenshots/scene-forest.jpg) | ![Beach](docs/screenshots/scene-beach.jpg) |
| **Harbor** · coasts and ports | **Forest** · rainforests and woodland | **Beach** · islands and lagoons |
| ![Ice](docs/screenshots/scene-ice.jpg) | ![Abstract](docs/screenshots/scene-abstract.jpg) | |
| **Ice** · poles and glaciers, aurora at night | **Abstract** · people, music, ideas (code only, no art files) | |

The Peak, Old city, Ruins, Harbor, Forest, Beach and Ice frames come from development preview stories, so they
show a placeholder heading and a stand-in shape in the hero slot.

## AI landmark layer

![Taj Mahal painted into the lantern path at dawn](docs/screenshots/landmark-taj-mahal.jpg)

When a chapter is about one specific structure, the writer names it and describes its physical form from the
sources (that description is fact-checked like any sentence). A free image model (Cloudflare Workers AI or Hugging
Face, FLUX.1-schnell) paints it on a flat screen; the art pipeline cuts it out and applies the scene's grade; a
vision model (Gemini) compares the cutout with the Wikipedia lead photo and the description and rejects wrong
structure types, text or watermarks and broken cutouts. One retry, then the scene is shown without a landmark, so a
story never shows a wrong building. Above: the Taj Mahal, painted by Cloudflare FLUX.1-schnell on the first attempt
and passed by `gemini-3.5-flash`. The Sources panel credits it as AI-generated next to the Wikipedia photo.

## Multilingual sources

Topics with thin English coverage are completed from other Wikipedias. Wikidata gives the topic's country and its
articles in every language; local languages come first (Hindi, Marathi and the other Indian languages for India,
Japanese for Japan, Arabic for Arab countries), then French, German and Spanish. An article is used only if it is
about the same kind of thing as the topic (Wikidata sometimes links a festival committee's page to a temple). The
writer still writes in English and cites the original article; the fact check compares meaning across languages.

| Topic | English | Added from other languages |
|---|---|---|
| Chaturshringi Temple, Pune | 213 words (rejected before) | Odia 368, Marathi 181 |
| Kasba Ganapati, Pune | 599 words | Telugu 241, Tamil 202 (Marathi skipped: about the festival committee) |
| Ōsu Kannon, Nagoya | 659 words | Japanese 776 |

Retrieval measured on 2 October 2026. Stories for these topics: pending (free-tier quota).

## Evaluation

`backend/eval/` holds the evaluation harness; every run is resumable and stays within free-tier limits. Full tables
and findings: [backend/eval/report.md](backend/eval/report.md).

| Check | Result | Measured |
|---|---|---|
| Golden set success rate (12 topics) | 92% (11 of 12) | 30 September 2026 |
| Average grounding score | 99% over 10 fact-checked stories (the checker was lenient; see findings) | 30 September 2026 |
| Template fit (golden set) | 82%, both misses rivers other than the Nile; measured before the newer scene families | 30 September 2026 |
| Scene routing (forest, beach, ice, abstract) | 4 of 4; grounding 100%, 100%, 93%, 100% | 2 October 2026 |
| Writing rubric, same three topics | 3.42 before, 4.25 after | 1 October 2026 |
| Landmark stories (Colosseum, Eiffel Tower, Gateway of India) | pending | |
| Multilingual stories (3 topics) | pending | |

## Writing quality

Gold examples (every hand-written Kyoto and Giza chapter) and a "never like this" list of real flat headings are in
the writer prompt. The writer proposes three headings per chapter; a smaller model picks the most vivid one the body
supports. A style critic rewrites only flat or cliched sentences and may not change or add a number. Headings are
fact-checked like sentences: one that implies an unsupported claim is swapped for a supported candidate.

Rubric (1 to 5, scored by a model separate from the writers, with the source text), measured on 1 October 2026:

| Same three topics | Vivid | Specific | Grounded | No cliches | Mean |
|---|---|---|---|---|---|
| Before | 2.67 | 4.00 | 4.67 | 2.33 | 3.42 |
| After | 4.00 | 4.33 | 5.00 | 3.67 | 4.25 |

Example: "A sea of sand stretches beyond the horizon." became "So large it glows from other stars." That heading was
later flagged by the stricter heading fact check, which is why that check exists. The other three topics of the
rubric set (Everest, Namib Desert, Fushimi Inari-taisha) are pending. The extra passes raise the cost to 24,000 to
42,000 tokens per story.

## How the scenes and art were made

Scenes are assembled from a fixed, hand-built template library; MythForge does not generate 3D geometry. The painted art in the kits was generated with an image model from written briefs, then cut out, cleaned and graded with the pipeline above. The code-painted placeholders were drawn procedurally in canvas. No third-party templates, shaders or artwork are used.

## Tech stack

- **Frontend:** Vite, React 19, TypeScript (strict), React Three Fiber, drei, postprocessing, GSAP with ScrollTrigger, Lenis, Tailwind, leva for live tuning, Vitest, Playwright for screenshots and frame timing
- **Backend:** FastAPI, Pydantic v2, SQLAlchemy with SQLite, httpx, pytest
- **Models:** Gemini (AI Studio free tier), Groq free tier (gpt-oss-120b, qwen3.8-27b, gpt-oss-20b), optional local Ollama
- **Art pipeline:** Python with rembg (BiRefNet), NumPy, SciPy, Pillow

## Run it locally

Requirements: Node 20+ and Python 3.11+.

```bash
npm run setup
```

This creates `backend/.venv`, installs the Python and npm dependencies, and reminds you to create `backend/.env`. Copy `backend/.env.example` to `backend/.env` and fill in the free keys:

- `GEMINI_API_KEY`: free at https://aistudio.google.com/apikey
- `GROQ_API_KEY`: free at https://console.groq.com/keys
- `HTTP_CONTACT`: an email or URL of your own; Wikimedia requires contact details in every request

Then start the backend and frontend together:

```bash
npm run dev
```

Open http://localhost:5173. The API runs on port 8000 behind the `/api` proxy, so the same address works from a phone on your network. Ctrl+C stops both servers.

| Where | Command | What it does |
|---|---|---|
| `frontend/` | `npm run test` | spec and copy-rule tests (also checks `backend/samples`) |
| `frontend/` | `npm run shots` | screenshots at 390 px and 1440 px |
| `frontend/` | `npm run fps` | frame timing for a whole story |
| `frontend/` | `npm run kit -- --template peak` | regenerate code-painted placeholder art |
| `backend/` | `.venv/Scripts/python -m pytest` | backend tests (`.venv/bin/python` on macOS and Linux) |
| `backend/` | `.venv/Scripts/python -m eval.run --resume` | quality evaluation |

## Project structure

```
frontend/
  src/experience/     scroll story renderer: scenes, layers, camera, post, transitions
  src/spec/           StorySpec types, the Kyoto and Giza example stories, spec tests
  src/pages/          home, story, gallery, 404
  src/components/     generating screen, sources panel, ambient backdrop
  public/artkits/     per-template art kits (kit.json + painted and code-painted layers)
  scripts/            shots, fps, posters, art-kit generator and processor
backend/
  app/retrieval/      Wikipedia and Commons, cached in SQLite
  app/llm_pipeline/   providers and fallback chain, prompt, validation, fact check, kit catalog
  app/schemas/        StorySpec (Pydantic) and the shared copy rules
  app/api/            generate, status, stories, posters
  eval/               golden topics, evaluation runner, report
  tests/
art-raw/              painted source art before processing
docs/                 specs and screenshots
```

## Limitations and future work

- **Generic scenes, one layout each.** Eleven families cover most places, but each has one composition. The only river
  kit is the Nile landmark, so other rivers fall back to Harbor or Forest; a generic river kit is next.
- **Free tiers limit throughput.** A story with the style passes costs 24,000 to 42,000 tokens, so about five to
  seven stories per model per day; generation takes about a minute with rate-limit waits.
- **The fact checker is a small model.** It became stricter (hedges, headings), but it can still miss stretched
  claims; two checkers that must agree would be more reliable.
- **Landmark paintings depend on free image quotas** and a vision check; when either is unavailable the scene is
  shown without the landmark.
- **Retries are frequent.** Most first drafts break the title-word or heading rules.
- **Stories are three chapters** and always written in English.

## Privacy

MythForge runs on your machine. The topic you type is sent to Wikipedia, Wikimedia Commons and the AI providers you configure; stories, posters and the cache stay in `backend/` on your disk.
