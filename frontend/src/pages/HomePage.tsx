import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AmbientBackdrop } from '@/components/AmbientBackdrop'
import { GeneratingScreen } from '@/components/GeneratingScreen'
import { api, ApiError } from '@/lib/api'
import { usePageMeta } from '@/lib/usePageMeta'
import { sampleKyoto } from '@/spec'

const EXAMPLES = ['Mount Everest', 'Petra', 'Namib Desert', 'Fushimi Inari-taisha']

/** Landing: the name, one line, one input. Generation runs in place (?job=…) over the same backdrop. */
export function HomePage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const jobId = params.get('job')
  const jobTopic = params.get('topic') ?? ''
  const [topic, setTopic] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  usePageMeta(
    jobId ? `Forging ${jobTopic}` : null,
    'Name a place or a piece of history and MythForge builds it as a cinematic story you scroll through in 3D.',
  )

  async function start(t: string) {
    const clean = t.trim()
    if (clean.length < 2) {
      setError('Enter a topic of at least two characters.')
      return
    }
    setSending(true)
    setError(null)
    try {
      const { jobId: id } = await api.generate(clean)
      setParams({ job: id, topic: clean })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong starting the story.')
    } finally {
      setSending(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void start(topic)
  }

  return (
    <div className="relative min-h-[100svh] overflow-hidden bg-[#07080c] text-white">
      <AmbientBackdrop spec={sampleKyoto} chapter={1} dim={jobId ? 0.65 : 0.4} />
      {/* Readability: a soft floor of shade behind the copy, darker toward the bottom. */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgb(7_8_12/0.8),rgb(7_8_12/0.05)_60%,rgb(7_8_12/0.25))]" />
      {/* While a story is being written the scene recedes further, so progress text stays legible. */}
      <div
        className={`pointer-events-none absolute inset-0 bg-[#07080c] transition-opacity duration-1000 ${jobId ? 'opacity-60' : 'opacity-0'}`}
      />

      <header className="relative z-10 flex items-center justify-between px-5 pt-5 md:px-10 md:pt-7">
        <Link to="/" className="font-display text-sm uppercase tracking-[0.2em]">
          MythForge
        </Link>
        <nav className="text-[11px] uppercase tracking-[0.3em] text-white/60">
          <Link to="/gallery" className="border-b border-transparent pb-1 transition-colors hover:border-white/60 hover:text-white">
            Gallery
          </Link>
        </nav>
      </header>

      <main className="relative z-10 flex min-h-[calc(100svh-120px)] flex-col justify-end px-5 pb-16 md:px-10 md:pb-24 [@media(max-height:500px)]:pb-8 [@media(max-height:500px)]:pt-4">
        {jobId ? (
          <GeneratingScreen
            key={jobId}
            jobId={jobId}
            topic={jobTopic}
            onDone={(slug) => navigate(`/story/${slug}`, { state: { fresh: true } })}
            onRetry={() => void start(jobTopic)}
            onChangeTopic={() => {
              setTopic(jobTopic)
              setParams({})
            }}
          />
        ) : (
          <section className="max-w-3xl">
            <h1 className="font-display text-[clamp(52px,min(15vw,22svh),184px)] uppercase leading-[0.86] tracking-[-0.01em]">
              MythForge
            </h1>
            <p className="mt-5 max-w-xl text-[15px] font-light leading-[1.7] text-white/75 md:text-[17px]">
              Name a place or a piece of history. MythForge reads the sources and builds it as a story you scroll
              through in 3D.
            </p>

            <form onSubmit={onSubmit} className="mt-10 flex max-w-2xl items-end gap-5 border-b border-white/35 pb-3 focus-within:border-white">
              <label className="min-w-0 flex-1">
                <span className="block text-[10px] uppercase tracking-[0.3em] text-white/50">Topic</span>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={120}
                  placeholder="Mount Everest"
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-2 w-full bg-transparent text-2xl font-light text-white outline-none placeholder:text-white/25 md:text-4xl"
                />
              </label>
              <button
                type="submit"
                disabled={sending}
                className="shrink-0 pb-1 text-[12px] uppercase tracking-[0.3em] text-white transition-opacity disabled:opacity-40"
              >
                {sending ? 'Starting' : 'Forge'}
              </button>
            </form>
            {error ? (
              <p role="alert" className="mt-4 text-[14px] text-[#f2b8a0]">
                {error}
              </p>
            ) : (
              <p className="mt-4 text-[12px] tracking-[0.08em] text-white/45">
                Try{' '}
                {EXAMPLES.map((ex, i) => (
                  <span key={ex}>
                    <button type="button" onClick={() => setTopic(ex)} className="text-white/70 hover:text-white">
                      {ex}
                    </button>
                    {i < EXAMPLES.length - 1 ? ' · ' : ''}
                  </span>
                ))}
              </p>
            )}
          </section>
        )}
      </main>

      <footer className="relative z-10 px-5 pb-5 text-[11px] leading-[1.6] text-white/40 md:px-10">
        Runs on your machine. Your topic goes to Wikipedia and a free AI model to write the story; nothing else leaves.
      </footer>
    </div>
  )
}
