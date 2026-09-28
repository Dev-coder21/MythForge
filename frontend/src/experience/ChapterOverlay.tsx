import type { StorySpec } from '@/spec'

interface ChapterOverlayProps {
  spec: StorySpec
  chapterIndex: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * DOM layer over the canvas, in two states:
 * - hero (at rest): small headline + intro top-left, chapter numerals on the horizon
 * - chapter spread (scrolled): label, big heading left, body column right, CTA
 * Elements are addressed by data attributes; useChapterTimeline owns every reveal.
 */
export function ChapterOverlay({ spec, chapterIndex }: ChapterOverlayProps) {
  const chapter = spec.chapters[chapterIndex]
  if (!chapter) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 text-white">

      <header className="absolute inset-x-0 top-0 flex items-start justify-between px-5 pt-5 text-[11px] tracking-[0.35em] text-white/70 md:px-10 md:pt-7">
        <span className="uppercase">{spec.title}</span>
        <nav className="hidden gap-6 uppercase text-white/55 md:flex">
          {spec.chapters.map((c) => (
            <span key={c.index} className={c.index === chapter.index ? 'text-white' : undefined}>
              {c.titleWord}
            </span>
          ))}
        </nav>
      </header>

      {/* Hero block: visible at rest, leaves on the first scroll. */}
      <div data-hero className="absolute left-5 top-16 max-w-sm md:left-10 md:top-24 md:max-w-md">
        <p className="text-[11px] tracking-[0.3em] text-white/55">{chapter.label}</p>
        <h1 className="mt-3 text-2xl font-semibold uppercase leading-[1.08] md:text-4xl">{spec.subtitle}</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/65 md:text-[15px]">{chapter.subheading}</p>
      </div>

      {/* Secondary kinetic type: chapter numerals on the horizon + vertical side text. */}
      <div
        data-numerals
        className="absolute bottom-[26%] left-5 hidden gap-6 text-xs tabular-nums tracking-[0.2em] text-white/70 md:left-10 md:flex md:gap-10 md:text-sm"
      >
        {spec.chapters.map((c) => (
          <span key={c.index} className={c.index === chapter.index ? 'text-white' : 'text-white/45'}>
            {pad(c.index)}
          </span>
        ))}
      </div>
      <p
        data-side
        className="absolute right-4 top-1/2 hidden -translate-y-1/2 text-[11px] uppercase tracking-[0.5em] text-white/45 [writing-mode:vertical-rl] md:block md:right-8"
      >
        {spec.topic}
      </p>

      {/* Chapter spread: revealed mid-chapter over the dimmed scene. */}
      <div
        data-copy
        className="absolute inset-x-5 top-20 grid gap-5 md:inset-x-10 md:top-1/2 md:-translate-y-1/2 md:grid-cols-[1.1fr_0.9fr] md:items-start md:gap-14"
      >
        <div>
          <p data-reveal="label" className="invisible text-[11px] tracking-[0.3em] text-white/60">
            {chapter.label}
          </p>
          <h2
            data-reveal="heading"
            className="mt-3 text-3xl font-semibold uppercase leading-[1.02] tracking-tight md:text-6xl"
          >
            {chapter.heading}
          </h2>
        </div>
        <div className="md:pt-8">
          <p data-reveal="body" className="text-[13px] leading-relaxed text-white/75 md:text-[15px]">
            {chapter.body}
          </p>
          <p
            data-reveal="cta"
            className="invisible mt-6 inline-flex items-center gap-3 border-b border-white/40 pb-1 text-[11px] tracking-[0.35em]"
          >
            CONTINUE <span aria-hidden>↓</span>
          </p>
        </div>
      </div>
    </div>
  )
}
