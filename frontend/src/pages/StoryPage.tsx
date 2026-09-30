import { Leva } from 'leva'
import { StoryExperience } from '@/experience/StoryExperience'
import type { StorySpec } from '@/spec'

interface StoryPageProps {
  spec: StorySpec
  /** Receives one JPEG frame of the first chapter (gallery poster). */
  onPoster?: (dataUrl: string) => void
}

const showLeva = import.meta.env.DEV && !navigator.webdriver

/** Renders a full story spec as the scroll experience. */
export function StoryPage({ spec, onPoster }: StoryPageProps) {
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
        <StoryExperience spec={spec} onPoster={onPoster} />
      </main>
    </>
  )
}
