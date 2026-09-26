import { Canvas } from '@react-three/fiber'
import { Leva } from 'leva'
import type { StorySpec } from '@/spec'

interface StoryPageProps {
  spec: StorySpec
}

/** Empty shell: a fixed WebGL canvas behind scrollable chapter placeholders. */
export function StoryPage({ spec }: StoryPageProps) {
  return (
    <>
      <Leva collapsed />

      <div className="fixed inset-0 -z-10">
        <Canvas dpr={[1, 1.75]} gl={{ antialias: true }} camera={{ position: [0, 0, 5], fov: 45 }}>
          <color attach="background" args={['#000000']} />
        </Canvas>
      </div>

      <main>
        <header className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-7xl font-black uppercase tracking-tight md:text-9xl">{spec.title}</h1>
          <p className="max-w-xl text-lg text-white/60">{spec.subtitle}</p>
        </header>

        {spec.chapters.map((chapter) => (
          <section
            key={chapter.index}
            className="flex h-[250vh] items-start justify-center border-t border-white/10 px-6 pt-[40vh]"
          >
            <div className="max-w-2xl space-y-3">
              <p className="text-xs tracking-[0.3em] text-white/50">{chapter.label}</p>
              <h2
                className="text-6xl font-black uppercase md:text-8xl"
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
