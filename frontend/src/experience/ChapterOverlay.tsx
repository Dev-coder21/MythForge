import type { Chapter } from '@/spec'

interface ChapterOverlayProps {
  chapter: Chapter
  storyTitle: string
  chapterCount: number
}

/**
 * DOM copy layered over the canvas. Elements are addressed by data attributes
 * from useChapterTimeline, which owns every reveal.
 */
export function ChapterOverlay({ chapter, storyTitle, chapterCount }: ChapterOverlayProps) {
  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Copy sits over the sky, clear of the title and foreground. */}
      <div className="absolute inset-x-0 top-0 h-[55%] bg-gradient-to-b from-black/55 via-black/20 to-transparent" />

      <header className="relative flex items-start justify-between px-5 pt-5 text-[11px] tracking-[0.35em] text-white/70 md:px-10 md:pt-8">
        <span className="uppercase">{storyTitle}</span>
        <span className="tabular-nums">
          {pad(chapter.index)} <span className="text-white/35">/ {pad(chapterCount)}</span>
        </span>
      </header>

      <p
        data-reveal="label"
        className="invisible relative mt-6 px-5 text-[11px] tracking-[0.3em] text-white/60 md:mt-10 md:px-10"
      >
        {chapter.label}
      </p>

      <div data-copy className="relative mt-4 max-w-md px-5 md:mt-6 md:max-w-lg md:px-10">
        <h2
          data-reveal="heading"
          className="font-display text-2xl uppercase leading-[1.05] tracking-wide text-white md:text-4xl"
        >
          {chapter.heading}
        </h2>
        <p data-reveal="subheading" className="mt-2 text-sm font-semibold text-white/85 md:mt-3 md:text-lg">
          {chapter.subheading}
        </p>
        <p data-reveal="body" className="mt-2 text-[13px] leading-relaxed text-white/65 md:mt-3 md:text-[15px]">
          {chapter.body}
        </p>
      </div>

      <div
        data-hint
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[10px] tracking-[0.4em] text-white/50"
      >
        SCROLL
      </div>
    </div>
  )
}
