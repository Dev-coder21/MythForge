import { useEffect, useState } from 'react'
import { modelLabel } from '@/components/GeneratingScreen'
import { sourceOf } from '@/experience/ChapterOverlay'
import type { GroundingReport } from '@/lib/api'
import type { StorySpec } from '@/spec'

interface StoryInfoPanelProps {
  spec: StorySpec
  /** undefined = hand-written story (no fact check); 'loading' while the report loads. */
  grounding?: GroundingReport | null | 'loading'
}

/** Small "About this story" panel: sources, fact-check score, image credits. */
export function StoryInfoPanel({ spec, grounding }: StoryInfoPanelProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const sources = [...new Set(spec.chapters.map((c) => c.source).filter((s): s is string => !!s))]
  const images = spec.chapters
    .map((c) => c.heroImage)
    .filter((i): i is NonNullable<typeof i> => !!i)
    .filter((img, i, all) => all.findIndex((o) => o.url === img.url) === i)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="story-info"
        className="fixed right-5 top-[72px] z-40 border-b border-white/30 pb-0.5 text-[10px] uppercase tracking-[0.3em] text-white/60 transition-colors hover:text-white md:right-10 md:top-[88px]"
      >
        {open ? 'Close' : 'Sources'}
      </button>

      <aside
        id="story-info"
        hidden={!open}
        className="fixed inset-x-3 top-[100px] z-40 max-h-[calc(100svh-180px)] overflow-y-auto bg-[#0b0d13]/95 px-5 py-6 text-white md:inset-x-auto md:right-10 md:top-[120px] md:w-[380px]"
      >
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/45">About this story</p>

        <section className="mt-5">
          <h2 className="text-[11px] uppercase tracking-[0.25em] text-white/80">Fact check</h2>
          <FactCheck grounding={grounding} />
        </section>

        <section className="mt-7">
          <h2 className="text-[11px] uppercase tracking-[0.25em] text-white/80">Sources</h2>
          <ul className="mt-3 space-y-2 text-[13px] font-light">
            {sources.length === 0 && <li className="text-white/50">No sources recorded.</li>}
            {sources.map((src) => {
              const s = sourceOf(src)
              return (
                <li key={src}>
                  {s?.href ? (
                    <a href={s.href} target="_blank" rel="noreferrer" className="border-b border-white/25 hover:border-white">
                      {s.label}
                    </a>
                  ) : (
                    s?.label
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="mt-7">
          <h2 className="text-[11px] uppercase tracking-[0.25em] text-white/80">Images</h2>
          <ul className="mt-3 space-y-3 text-[12px] font-light leading-[1.6] text-white/70">
            {images.length === 0 && <li className="text-white/50">The scenes are original painted art; no photographs are used.</li>}
            {images.map((img) => (
              <li key={img.url}>
                <a href={img.url} target="_blank" rel="noreferrer" className="border-b border-white/25 hover:border-white">
                  {img.attribution}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </>
  )
}

function FactCheck({ grounding }: { grounding: StoryInfoPanelProps['grounding'] }) {
  if (grounding === undefined) {
    return <p className="mt-3 text-[13px] font-light leading-[1.6] text-white/60">Hand-written example story; not machine checked.</p>
  }
  if (grounding === 'loading') {
    return (
      <div className="mt-3 space-y-2" aria-busy="true">
        <div className="h-6 w-24 animate-pulse bg-white/10" />
        <div className="h-2 w-48 animate-pulse bg-white/[0.07]" />
      </div>
    )
  }
  if (grounding?.skipped) {
    return (
      <p className="mt-3 text-[13px] font-light leading-[1.6] text-white/60">
        The fact check could not run for this story{/rate|quota|busy|limit/i.test(grounding.skipped) ? ' because the free AI models were at their limit' : ''}. Treat its details with care.
      </p>
    )
  }
  if (!grounding || grounding.score == null) {
    return <p className="mt-3 text-[13px] font-light text-white/60">No fact-check report for this story.</p>
  }
  const pct = Math.round(grounding.score * 100)
  const flagged = grounding.unsupported?.length ?? 0
  return (
    <div className="mt-3">
      <p className="font-display text-4xl leading-none">{pct}%</p>
      <p className="mt-2 text-[13px] font-light leading-[1.6] text-white/70">
        of {grounding.sentences} sentences supported by the sources
        {grounding.checkedBy ? `, checked by ${modelLabel(grounding.checkedBy)}` : ''}
        {grounding.writtenBy ? ` (written by ${modelLabel(grounding.writtenBy)})` : ''}.
      </p>
      {flagged > 0 && (
        <p className="mt-2 text-[12px] leading-[1.6] text-white/50">
          {grounding.removed?.length ?? 0} unsupported sentence{grounding.removed?.length === 1 ? '' : 's'} removed
          {grounding.kept?.length ? `; ${grounding.kept.length} kept to keep the chapter readable` : ''}.
        </p>
      )}
    </div>
  )
}
