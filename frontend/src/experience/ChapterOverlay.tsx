import { forwardRef } from 'react'
import type { Chapter, StorySpec } from '@/spec'

const pad = (n: number) => String(n).padStart(2, '0')
const RING_R = 15
export const RING_C = 2 * Math.PI * RING_R

/**
 * DOM elements the render loop updates every frame (no React re-renders while
 * scrolling): the counter number + ring, one rail fill per chapter, the caption,
 * and each chapter's copy container (visibility gated by the active chapter).
 */
export const chromeRefs = {
  ring: null as SVGCircleElement | null,
  number: null as HTMLSpanElement | null,
  caption: null as HTMLParagraphElement | null,
  fills: [] as (HTMLDivElement | null)[],
  copies: [] as (HTMLDivElement | null)[],
}

export const chapterCaption = (spec: StorySpec, c: Chapter) => `${spec.topic} · ${c.sceneParams.timeOfDay}`

/** "wikipedia:Great Pyramid of Giza" → label + link; anything else is shown as given. */
function sourceOf(source?: string): { label: string; href?: string } | null {
  if (!source) return null
  const [kind, ...rest] = source.split(':')
  const title = rest.join(':').trim()
  if (kind === 'wikipedia' && title) {
    return { label: `Wikipedia · ${title}`, href: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` }
  }
  return { label: source }
}

/** Small attribution under the chapter body; the only clickable thing in the overlay. */
function Source({ source }: { source?: string }) {
  const s = sourceOf(source)
  if (!s) return null
  const cls = 'pointer-events-auto text-[10px] uppercase tracking-[0.3em] text-white/45'
  return s.href ? (
    <a className={`${cls} border-b border-white/20 pb-0.5 hover:text-white/70`} href={s.href} target="_blank" rel="noreferrer">
      Source · {s.label}
    </a>
  ) : (
    <span className={cls}>Source · {s.label}</span>
  )
}

/**
 * Persistent chrome (MythForge's own, see EXPERIENCE_SPEC §8): story mark with
 * accent tick, chapter counter with a progress ring, bottom chapter rail whose
 * segments fill with each chapter's scroll, and a topic/time-of-day caption.
 */
export function StoryChrome({ spec }: { spec: StorySpec }) {
  const first = spec.chapters[0]
  if (!first) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-20 text-white">
      <header className="absolute inset-x-0 top-0 flex items-start justify-between px-5 pt-5 md:px-10 md:pt-7">
        <div className="flex items-center gap-3">
          <span className="h-3 w-[3px]" style={{ backgroundColor: first.sceneParams.accentColor }} />
          <span className="font-display text-sm uppercase tracking-[0.18em]">{spec.title}</span>
          <span className="hidden text-[10px] uppercase tracking-[0.3em] text-white/45 sm:inline">
            {spec.chapters.length} chapters
          </span>
        </div>
        <div className="flex items-center gap-3 tabular-nums">
          <span className="text-[10px] tracking-[0.3em] text-white/45">/ {pad(spec.chapters.length)}</span>
          <div className="relative h-10 w-10">
            <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
              <circle cx="20" cy="20" r={RING_R} fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="1" />
              <circle
                ref={(el) => {
                  chromeRefs.ring = el
                }}
                cx="20"
                cy="20"
                r={RING_R}
                fill="none"
                stroke={first.sceneParams.accentColor}
                strokeWidth="1.5"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C}
                strokeLinecap="round"
              />
            </svg>
            <span
              ref={(el) => {
                chromeRefs.number = el
              }}
              className="absolute inset-0 grid place-items-center font-display text-sm"
            >
              {pad(first.index)}
            </span>
          </div>
        </div>
      </header>

      <div className="absolute inset-x-5 bottom-5 md:inset-x-10 md:bottom-7">
        <p
          ref={(el) => {
            chromeRefs.caption = el
          }}
          className="mb-3 hidden text-right text-[10px] uppercase tracking-[0.35em] text-white/40 md:block"
        >
          {chapterCaption(spec, first)}
        </p>
        <ol className="flex gap-2">
          {spec.chapters.map((c, i) => (
            <li key={c.index} className="flex-1">
              <div className="relative h-px bg-white/20">
                <div
                  ref={(el) => {
                    chromeRefs.fills[i] = el
                  }}
                  className="absolute inset-0 origin-left scale-x-0"
                  style={{ backgroundColor: c.sceneParams.accentColor }}
                />
              </div>
              <p className="mt-2 text-[10px] tracking-[0.25em] text-white/55 tabular-nums">
                {pad(c.index)} <span className="uppercase">{c.titleWord}</span>
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

interface ChapterCopyProps {
  spec: StorySpec
  chapter: Chapter
  /** First chapter opens on the story subtitle; later chapters open on their subheading. */
  isFirst: boolean
}

/**
 * One chapter's copy. Exactly two states, never visible together:
 * - intro (segment start): headline + line
 * - chapter (scrolled): label, heading, body (desktop column / portrait footer), CTA
 * The render loop gates the whole container to the chapter on screen.
 */
export const ChapterCopy = forwardRef<HTMLDivElement, ChapterCopyProps>(function ChapterCopy(
  { spec, chapter, isFirst },
  ref,
) {
  const accent = chapter.sceneParams.accentColor
  return (
    <div ref={ref} className="pointer-events-none invisible absolute inset-0 z-10 text-white">
      <div data-hero className="absolute left-5 right-5 top-20 max-w-md md:left-10 md:top-28">
        <h1 className="text-2xl font-normal uppercase leading-[1.06] tracking-[-0.02em] md:text-4xl">
          {isFirst ? spec.subtitle : chapter.subheading}
        </h1>
        <p className="mt-4 max-w-sm text-sm font-light leading-[1.75] text-white/70 md:text-[15px]">
          {isFirst ? chapter.subheading : chapter.label}
        </p>
      </div>

      <div
        data-copy
        className="invisible absolute inset-x-5 top-20 md:inset-x-10 md:top-1/2 md:grid md:-translate-y-1/2 md:grid-cols-[1.1fr_0.9fr] md:items-start md:gap-14"
      >
        <div>
          <p data-reveal="label" className="invisible flex items-center gap-3 text-[11px] tracking-[0.3em] text-white/60">
            <span className="h-px w-6" style={{ backgroundColor: accent }} />
            {chapter.label}
          </p>
          <h2
            data-reveal="heading"
            className="mt-3 text-3xl font-normal uppercase leading-[1.0] tracking-[-0.025em] md:text-6xl"
          >
            {chapter.heading}
          </h2>
        </div>
        <div className="hidden md:block md:pt-8">
          <p data-reveal="body" className="text-[15px] font-light leading-[1.8] text-white/80">
            {chapter.body}
          </p>
          <p
            data-reveal="cta"
            className="invisible mt-6 inline-flex items-center gap-3 border-b border-white/40 pb-1 text-[11px] tracking-[0.35em]"
          >
            CONTINUE <span aria-hidden>↓</span>
          </p>
          <div data-reveal="source" className="invisible mt-5">
            <Source source={chapter.source} />
          </div>
        </div>
      </div>

      <p
        data-reveal="body-mobile"
        className="invisible absolute inset-x-5 bottom-[5.5rem] line-clamp-3 text-[13px] font-light leading-[1.75] text-white/80 md:hidden"
      >
        {chapter.body}
      </p>
    </div>
  )
})
