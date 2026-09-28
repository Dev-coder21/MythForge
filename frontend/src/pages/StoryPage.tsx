import { Leva } from 'leva'
import { StoryExperience } from '@/experience/StoryExperience'
import type { StorySpec } from '@/spec'

interface StoryPageProps {
  spec: StorySpec
}

const showLeva = import.meta.env.DEV && !navigator.webdriver

/** Chapter 1 renders as the full 3D experience; later chapters are still text placeholders. */
export function StoryPage({ spec }: StoryPageProps) {
  return (
    <>
      {/* Dev-only tuning panel, docked bottom-right. Outside dev (and under automation, so
          screenshots stay clean) a hidden root must still be mounted: without one,
          useControls auto-creates its own visible panel. */}
      {showLeva ? (
        <div className="fixed bottom-4 right-4 z-50 max-h-[70vh] w-[min(300px,calc(100vw-2rem))] overflow-y-auto">
          <Leva fill collapsed />
        </div>
      ) : (
        <Leva hidden />
      )}

      <main>
        <StoryExperience spec={spec} chapterIndex={0} />

        {spec.chapters.slice(1).map((chapter) => (
          <section
            key={chapter.index}
            className="flex h-screen items-center justify-center border-t border-white/10 px-6"
          >
            <div className="max-w-2xl space-y-3">
              <p className="text-xs tracking-[0.3em] text-white/50">{chapter.label}</p>
              <h2
                className="font-display text-6xl uppercase md:text-8xl"
                style={{ color: chapter.sceneParams.accentColor }}
              >
                {chapter.titleWord}
              </h2>
              <p className="text-2xl font-semibold">{chapter.heading}</p>
              <p className="text-white/60">{chapter.subheading}</p>
            </div>
          </section>
        ))}
      </main>
    </>
  )
}
