import { Link } from 'react-router'
import { usePageMeta } from '@/lib/usePageMeta'
import { PUBLIC_STORIES } from '@/spec'

/** Unknown story slug (or any missing page): say so plainly and offer what exists. */
export function NotFound({ slug }: { slug?: string }) {
  usePageMeta('Not found', 'This page or story does not exist on MythForge.')
  return (
    <main className="flex min-h-screen items-center bg-[#0b0e16] px-6 text-white md:px-16">
      <div className="max-w-xl">
        <p className="text-[11px] tracking-[0.3em] text-white/50">404 · NOT FOUND</p>
        <h1 className="mt-4 text-4xl font-normal uppercase leading-[1.05] tracking-[-0.02em] md:text-6xl">
          This story has not been written yet.
        </h1>
        <p className="mt-5 text-[15px] font-light leading-[1.8] text-white/70">
          {slug ? `There is no story called “${slug}”.` : 'There is nothing at this address.'} These are ready to read:
        </p>
        <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-[12px] tracking-[0.3em]">
          {PUBLIC_STORIES.map((s) => (
            <li key={s}>
              <Link className="border-b border-white/40 pb-1 uppercase hover:border-white" to={`/story/${s}`}>
                {s}
              </Link>
            </li>
          ))}
          <li>
            <Link className="border-b border-white/40 pb-1 uppercase hover:border-white" to="/gallery">
              Gallery
            </Link>
          </li>
          <li>
            <Link className="border-b border-white/40 pb-1 uppercase hover:border-white" to="/">
              New story
            </Link>
          </li>
        </ul>
      </div>
    </main>
  )
}
