import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type JobStage, type JobStatus } from '@/lib/api'

const POLL_MS = 2000
const MAX_MISSES = 5

const STAGES: { id: JobStage; label: string; note: string }[] = [
  { id: 'retrieving', label: 'Fetching sources', note: 'Reading Wikipedia and finding openly licensed images on Wikimedia Commons.' },
  { id: 'structuring', label: 'Writing', note: 'One model drafts every chapter from the source text alone.' },
  { id: 'checking', label: 'Fact-checking', note: 'A second model checks each sentence against the sources.' },
  { id: 'painting', label: 'Painting the landmark', note: 'An image model paints the named structure; a vision model checks it against the Wikipedia photo.' },
  { id: 'assembling', label: 'Building scenes', note: 'Choosing art, light and colour for each chapter.' },
]
const ORDER: JobStage[] = ['queued', 'retrieving', 'structuring', 'checking', 'painting', 'assembling', 'done']

const WAITING = [
  'Free AI tiers take their time. A story usually lands within one to three minutes.',
  'Every number in the story has to appear in the sources, so drafts sometimes go back for a second pass.',
  'Headings are kept short and free of numbers; the figures live in the body copy.',
  'Images come from Wikimedia Commons and keep their licence and author credit.',
  'You can leave this tab open and come back; the page picks up where it was.',
]

interface GeneratingScreenProps {
  jobId: string
  topic: string
  onDone: (slug: string) => void
  onRetry: () => void
  onChangeTopic: () => void
}

/** Live view of one generation job, polling /generate/{id}/status. */
export function GeneratingScreen({ jobId, topic, onDone, onRetry, onChangeTopic }: GeneratingScreenProps) {
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [lost, setLost] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [tip, setTip] = useState(0)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    let alive = true
    let misses = 0
    let timer = 0
    const poll = async () => {
      try {
        const s = await api.status(jobId)
        if (!alive) return
        misses = 0
        setLost(null)
        setStatus(s)
        if (s.stage === 'done' && s.storySlug) {
          done.current(s.storySlug)
          return
        }
        if (s.stage === 'error') return
      } catch (e) {
        if (!alive) return
        if (e instanceof ApiError && e.status === 404) {
          setLost('This generation job no longer exists. Start the story again.')
          return
        }
        misses += 1
        if (misses >= MAX_MISSES) {
          setLost(e instanceof ApiError ? e.message : 'Lost contact with the MythForge server.')
          return
        }
      }
      timer = window.setTimeout(poll, POLL_MS)
    }
    void poll()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [jobId])

  // Elapsed clock from the job's own start time, so a reload keeps counting.
  const startedAt = status?.startedAt
  useEffect(() => {
    // The API returns naive UTC timestamps; read them as UTC.
    const started = startedAt ? Date.parse(/(Z|[+-]\d\d:\d\d)$/i.test(startedAt) ? startedAt : `${startedAt}Z`) : Date.now()
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [startedAt])

  useEffect(() => {
    const id = window.setInterval(() => setTip((t) => (t + 1) % WAITING.length), 9000)
    return () => window.clearInterval(id)
  }, [])

  const failed = status?.stage === 'error' || lost !== null
  const stageIdx = ORDER.indexOf(status?.stage ?? 'queued')
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <section className="w-full max-w-3xl" aria-live="polite">
      <p className="text-[10px] uppercase tracking-[0.3em] text-white/50">
        {failed ? 'Stopped' : 'Forging'} · <span className="tabular-nums">{mm}:{ss}</span>
      </p>
      <h1 className="mt-3 font-display text-[clamp(44px,9vw,112px)] uppercase leading-[0.9]">{topic || 'Your story'}</h1>

      {/* Overall progress: a hairline that fills, no spinner. */}
      <div className="mt-8 h-px w-full bg-white/15">
        <div
          className="h-px bg-white/80 transition-[width] duration-[1500ms] ease-out"
          style={{ width: `${failed ? 0 : Math.max(4, status?.progress ?? 2)}%` }}
        />
      </div>

      {failed ? (
        <FailurePanel message={lost ?? status?.error ?? 'The story could not be finished.'} onRetry={onRetry} onChangeTopic={onChangeTopic} />
      ) : (
        <>
          <ol className="mt-8 grid gap-5 sm:grid-cols-5 sm:gap-6">
            {STAGES.map((s) => {
              const idx = ORDER.indexOf(s.id)
              const state = idx < stageIdx ? 'done' : idx === stageIdx ? 'active' : 'pending'
              return (
                <li key={s.id} className={state === 'pending' ? 'text-white/30' : 'text-white'}>
                  <div className="h-[2px] w-full overflow-hidden bg-white/10">
                    <div
                      className={`h-full bg-white/85 ${state === 'active' ? 'animate-[mf-sweep_2.4s_ease-in-out_infinite]' : ''}`}
                      style={{ width: state === 'done' ? '100%' : state === 'active' ? '40%' : '0%' }}
                    />
                  </div>
                  <p className="mt-3 text-[11px] uppercase tracking-[0.25em]">{s.label}</p>
                  {state === 'active' && <p className="mt-2 text-[13px] font-light leading-[1.6] text-white/60">{s.note}</p>}
                </li>
              )
            })}
          </ol>

          <p className="mt-8 min-h-[1.6em] text-[13px] text-white/70">{liveLine(status)}</p>

          {/* Skeleton of the chapters being written. */}
          <div className="mt-8 grid gap-6 sm:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-3">
                <div className="h-2 w-24 animate-pulse bg-white/10" style={{ animationDelay: `${i * 200}ms` }} />
                <div className="h-5 w-4/5 animate-pulse bg-white/10" style={{ animationDelay: `${i * 200 + 100}ms` }} />
                <div className="h-2 w-full animate-pulse bg-white/[0.07]" style={{ animationDelay: `${i * 200 + 200}ms` }} />
                <div className="h-2 w-11/12 animate-pulse bg-white/[0.07]" style={{ animationDelay: `${i * 200 + 300}ms` }} />
                <div className="h-2 w-2/3 animate-pulse bg-white/[0.07]" style={{ animationDelay: `${i * 200 + 400}ms` }} />
              </div>
            ))}
          </div>

          <p className="mt-10 max-w-xl text-[13px] font-light leading-[1.7] text-white/50">{WAITING[tip]}</p>
        </>
      )}
    </section>
  )
}

/** "groq:openai/gpt-oss-120b" → "Groq · gpt-oss-120b" */
export function modelLabel(id: string | null | undefined): string {
  if (!id) return ''
  const [provider = '', ...rest] = id.split(':')
  const model = rest.join(':').split('/').pop() ?? ''
  const name = { groq: 'Groq', gemini: 'Gemini', ollama: 'Ollama', cloudflare: 'Cloudflare', huggingface: 'Hugging Face' }[provider] ?? provider
  return model ? `${name} · ${model}` : name
}

function liveLine(s: JobStatus | null): string {
  if (!s || s.stage === 'queued') return 'Waiting for the server to pick up the job.'
  if (s.stage === 'retrieving') return 'Collecting source text and images.'
  const who = modelLabel(s.provider)
  const wait = s.detail?.match(/waiting (\d+)s/)
  if (wait) return `${who}: the free tier is busy, trying again in ${wait[1]}s.`
  if (s.detail?.startsWith('unavailable')) return `${who} is unavailable, switching to the next free model.`
  if (s.detail?.startsWith('rewriting')) return 'Rewriting sentences the fact check could not find in the sources.'
  if (s.stage === 'painting') {
    if (wait) return `${who}: the free image tier is busy, trying again in ${wait[1]}s.`
    return who && s.detail === 'painting' ? `${who} is painting the landmark.` : 'Painting the landmark.'
  }
  if (s.stage === 'assembling') return 'Saving the story.'
  if (who) return s.stage === 'checking' ? `${who} is checking the facts.` : `${who} is writing.`
  return 'Working.'
}

function FailurePanel({ message, onRetry, onChangeTopic }: { message: string; onRetry: () => void; onChangeTopic: () => void }) {
  const daily = /daily/i.test(message)
  const rateLimited = /rate limit|quota|busy|free tier/i.test(message)
  const thin = /not enough|too little|thin/i.test(message)
  const headline = rateLimited
    ? 'The free AI models are at their limit right now.'
    : thin
      ? 'There is not enough source material for this topic.'
      : 'The story could not be finished.'
  const hint = daily
    ? 'The free daily allowance of every configured model is used up. It refills gradually over the next hours; adding a second free provider key also helps.'
    : rateLimited
    ? 'Free tiers reset within a minute or two. Try again shortly.'
    : thin
      ? 'Try a more specific or better known name, such as a single place or event.'
      : 'You can try again; a second attempt often succeeds.'
  return (
    <div role="alert" className="mt-8 max-w-2xl">
      <p className="text-xl font-light text-white md:text-2xl">{headline}</p>
      <p className="mt-3 text-[14px] leading-[1.7] text-white/65">{hint}</p>
      <details className="mt-4 text-[12px] text-white/45">
        <summary className="cursor-pointer select-none uppercase tracking-[0.25em]">Details</summary>
        <p className="mt-2 break-words leading-[1.6]">{message}</p>
      </details>
      <div className="mt-8 flex flex-wrap gap-8 text-[12px] uppercase tracking-[0.3em]">
        {!thin && (
          <button type="button" onClick={onRetry} className="border-b border-white pb-1 text-white">
            Try again
          </button>
        )}
        <button type="button" onClick={onChangeTopic} className="border-b border-white/40 pb-1 text-white/75 hover:text-white">
          Change topic
        </button>
      </div>
    </div>
  )
}
