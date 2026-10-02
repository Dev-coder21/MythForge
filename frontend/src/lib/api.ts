/**
 * Backend client. Requests go to /api, which the Vite dev server proxies to
 * FastAPI on :8000 (vite.config.ts), so the app works on localhost and over the LAN.
 */
import type { StorySpec } from '@/spec'

const BASE = '/api'

/**
 * Static build (GitHub Pages): no backend. Stories come from public/data/ (exported with
 * `python -m scripts.export_static`), and generation explains that it runs locally.
 */
export const STATIC = import.meta.env.VITE_STATIC === '1'
const DATA = `${import.meta.env.BASE_URL}data/stories`
const groundingById = new Map<string, GroundingReport | null>()

async function staticJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DATA}/${path}`)
  if (!res.ok) throw new ApiError(res.status === 404 ? 'Story not found.' : `Request failed (${res.status}).`, res.status)
  return (await res.json()) as T
}

export const LOCAL_ONLY_MESSAGE =
  'This is the static showcase. Writing a new story needs the free AI models and runs on your own machine: clone the repository and run npm run dev.'

export type JobStage = 'queued' | 'retrieving' | 'structuring' | 'checking' | 'painting' | 'assembling' | 'done' | 'error'

export interface JobStatus {
  jobId: string
  storyId: string
  stage: JobStage
  progress: number
  /** "provider:model" currently working, e.g. "groq:openai/gpt-oss-120b". */
  provider: string | null
  /** Live message: "working", "rate limited, waiting 20s", ... */
  detail: string | null
  storySlug: string | null
  error: string | null
  startedAt: string
  completedAt: string | null
}

export interface StorySummary {
  id: string
  topic: string
  title: string | null
  subtitle: string | null
  slug: string | null
  status: 'generating' | 'complete' | 'failed'
  groundingScore: number | null
  posterUrl: string | null
  primaryColor: string | null
  accentColor: string | null
  createdAt: string
}

export interface GroundingReport {
  score: number | null
  /** Why the fact check did not run (free tiers busy, ...). */
  skipped?: string
  sentences?: number
  checkedBy?: string
  writtenBy?: string
  unsupported?: { id: string; field: string; text: string; reason: string }[]
  removed?: string[]
  kept?: string[]
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...init })
  } catch {
    throw new ApiError('The MythForge server is not reachable. Start it with npm run dev from the project root.', 0)
  }
  if (res.status === 502 || res.status === 504) {
    throw new ApiError('The MythForge server is not running. Start it with npm run dev from the project root.', res.status)
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) message = 'Please enter a topic between 2 and 120 characters.'
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(message, res.status)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const liveApi = {
  generate: (topic: string) =>
    request<{ jobId: string; storyId: string }>('/generate', { method: 'POST', body: JSON.stringify({ topic }) }),
  status: (jobId: string) => request<JobStatus>(`/generate/${encodeURIComponent(jobId)}/status`),
  stories: () => request<StorySummary[]>('/stories'),
  story: (idOrSlug: string) => request<StorySpec>(`/stories/${encodeURIComponent(idOrSlug)}`),
  grounding: (id: string) => request<GroundingReport>(`/stories/${encodeURIComponent(id)}/grounding`),
  uploadPoster: (id: string, dataUrl: string) =>
    request<void>(`/stories/${encodeURIComponent(id)}/poster`, { method: 'POST', body: JSON.stringify({ dataUrl }) }),
  /** Absolute URL for a backend path such as StorySummary.posterUrl. */
  url: (path: string) => BASE + path,
}

export const api: typeof liveApi = STATIC
  ? {
      generate: async () => {
        throw new ApiError(LOCAL_ONLY_MESSAGE, 0)
      },
      status: async () => {
        throw new ApiError('No generation jobs in the static showcase.', 404)
      },
      stories: () => staticJson<StorySummary[]>('index.json'),
      story: async (slug: string) => {
        const { spec, grounding } = await staticJson<{ spec: StorySpec; grounding: GroundingReport | null }>(
          `${encodeURIComponent(slug)}.json`,
        )
        groundingById.set(spec.id, grounding)
        return spec
      },
      grounding: async (id: string) => groundingById.get(id) ?? { score: null },
      uploadPoster: async () => undefined,
      url: (path: string) => path,
    }
  : liveApi
