import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError, STATIC, type StorySummary } from '@/lib/api'
import { usePageMeta } from '@/lib/usePageMeta'
import { sampleKyoto } from '@/spec'

interface Card {
  key: string
  slug: string
  title: string
  subtitle: string
  meta: string
  poster: string | null
  primary: string
  accent: string
}

/** Hand-written examples, always available (posters are captured frames in public/posters). */
const FEATURED: Card[] = [
  {
    key: 'kyoto',
    slug: 'kyoto',
    title: sampleKyoto.title,
    subtitle: sampleKyoto.subtitle,
    meta: 'Featured · Hand-written example',
    poster: `${import.meta.env.BASE_URL}posters/kyoto.jpg`,
    primary: sampleKyoto.chapters[0]!.sceneParams.primaryColor,
    accent: sampleKyoto.chapters[0]!.sceneParams.accentColor,
  },
  {
    key: 'giza',
    slug: 'giza',
    title: 'Giza',
    subtitle: 'Three kings, one plateau, and the river that carried the stone.',
    meta: 'Featured · Hand-written example',
    poster: `${import.meta.env.BASE_URL}posters/giza.jpg`,
    primary: '#3a2418',
    accent: '#ff8a3c',
  },
]

type State = { status: 'loading' } | { status: 'ready'; stories: StorySummary[] } | { status: 'error'; message: string }

export function GalleryPage() {
  usePageMeta('Gallery', 'Every story made with MythForge, plus the hand-written Kyoto and Giza examples.')
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    api
      .stories()
      .then((s) => alive && setState({ status: 'ready', stories: s.filter((x) => x.status === 'complete' && x.slug) }))
      .catch((e: unknown) => alive && setState({ status: 'error', message: e instanceof ApiError ? e.message : 'Stories could not be loaded.' }))
    return () => {
      alive = false
    }
  }, [attempt])

  return (
    <div className="min-h-[100svh] bg-[#07080c] text-white">
      <header className="flex items-center justify-between px-5 pt-5 md:px-10 md:pt-7">
        <Link to="/" className="font-display text-sm uppercase tracking-[0.2em]">
          MythForge
        </Link>
        <Link to="/" className="border-b border-white/30 pb-1 text-[11px] uppercase tracking-[0.3em] text-white/60 hover:text-white">
          New story
        </Link>
      </header>

      <main className="px-5 pb-24 pt-14 md:px-10 md:pt-20">
        <h1 className="font-display text-[clamp(48px,10vw,128px)] uppercase leading-[0.9]">Gallery</h1>

        <SectionLabel>Featured</SectionLabel>
        <div className="grid gap-5 md:grid-cols-2 md:gap-6">
          {FEATURED.map((c) => (
            <StoryCard key={c.key} card={c} />
          ))}
        </div>

        <SectionLabel>Your stories</SectionLabel>
        {state.status === 'loading' && (
          <div className="grid gap-5 md:grid-cols-2 md:gap-6" aria-busy="true" aria-label="Loading stories">
            {[0, 1].map((i) => (
              <div key={i} className="aspect-[4/5] animate-pulse bg-white/[0.06] sm:aspect-[16/10]" />
            ))}
          </div>
        )}
        {state.status === 'error' && (
          <div role="alert" className="max-w-xl">
            <p className="text-lg font-light">Your stories could not be loaded.</p>
            <p className="mt-2 text-[14px] leading-[1.7] text-white/60">{state.message}</p>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="mt-6 border-b border-white pb-1 text-[12px] uppercase tracking-[0.3em]">
              Try again
            </button>
          </div>
        )}
        {state.status === 'ready' && state.stories.length === 0 && (
          <div className="max-w-xl">
            <p className="text-lg font-light">No stories yet.</p>
            <p className="mt-2 text-[14px] leading-[1.7] text-white/60">Name a place or a piece of history and it will appear here once it is written.</p>
            <Link to="/" className="mt-6 inline-block border-b border-white pb-1 text-[12px] uppercase tracking-[0.3em]">
              Forge the first one
            </Link>
          </div>
        )}
        {state.status === 'ready' && state.stories.length > 0 && (
          <div className="grid gap-5 md:grid-cols-2 md:gap-6">
            {state.stories.map((s) => (
              <StoryCard
                key={s.id}
                card={{
                  key: s.id,
                  slug: s.slug!,
                  title: s.title ?? s.topic,
                  subtitle: s.subtitle ?? '',
                  meta: [s.topic, s.groundingScore != null ? `${Math.round(s.groundingScore * 100)}% supported` : null, formatDate(s.createdAt)]
                    .filter(Boolean)
                    .join(' · '),
                  poster: s.posterUrl ? api.url(s.posterUrl) : null,
                  primary: s.primaryColor ?? '#1a1d26',
                  accent: s.accentColor ?? '#d9c7a4',
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-5 mt-14 text-[11px] uppercase tracking-[0.3em] text-white/50 md:mt-20">{children}</h2>
}

function StoryCard({ card }: { card: Card }) {
  const [failed, setFailed] = useState(false)
  const showPoster = card.poster && !failed
  return (
    <Link to={`/story/${card.slug}`} className="group relative block aspect-[4/5] overflow-hidden sm:aspect-[16/10]" style={{ backgroundColor: card.primary }}>
      {showPoster ? (
        <img src={card.poster!} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-x-0 bottom-0 h-px" style={{ backgroundColor: card.accent }} />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(7_8_12/0.88),rgb(7_8_12/0)_60%)]" />
      <div className="absolute inset-x-0 bottom-0 p-5 md:p-7">
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/55">{card.meta}</p>
        <h3 className="mt-2 font-display text-[clamp(32px,5vw,60px)] uppercase leading-[0.95]">{card.title}</h3>
        {card.subtitle && <p className="mt-2 max-w-md text-[14px] font-light leading-[1.6] text-white/75">{card.subtitle}</p>}
        {!showPoster && !STATIC && <p className="mt-3 text-[11px] text-white/40">The cover frame is taken the first time the story is opened.</p>}
      </div>
    </Link>
  )
}

function formatDate(iso: string): string {
  const d = new Date(/(Z|[+-]\d\d:\d\d)$/i.test(iso) ? iso : `${iso}Z`)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
