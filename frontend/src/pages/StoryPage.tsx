import { Leva } from 'leva'
import { StoryExperience } from '@/experience/StoryExperience'
import type { StorySpec } from '@/spec'

interface StoryPageProps {
  spec: StorySpec
}

/** Chapter 1 renders as the full 3D experience; later chapters are still text placeholders. */
export function StoryPage({ spec }: StoryPageProps) {
  return (
    <>
      <Leva collapsed hidden={!import.meta.env.DEV} />

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
