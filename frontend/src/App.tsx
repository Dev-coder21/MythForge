import { useEffect, useState } from 'react'
import { NotFound } from '@/pages/NotFound'
import { StoryPage } from '@/pages/StoryPage'
import { DEFAULT_STORY, STORIES, type StorySpec } from '@/spec'

type State = { status: 'loading' } | { status: 'ready'; spec: StorySpec } | { status: 'missing'; slug: string }

/** Picks the story from the URL (?story=<slug>, default kyoto) and renders it. */
export default function App() {
  const slug = new URLSearchParams(window.location.search).get('story')?.toLowerCase() || DEFAULT_STORY
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    const load = STORIES[slug]
    if (!load) {
      setState({ status: 'missing', slug })
      document.title = 'Story not found · MythForge'
      return
    }
    let alive = true
    void load().then((spec) => {
      if (!alive) return
      setState({ status: 'ready', spec })
      // Per-story title and description (ship checklist).
      document.title = `${spec.title} · MythForge`
      setMeta('description', spec.subtitle)
    })
    return () => {
      alive = false
    }
  }, [slug])

  if (state.status === 'missing') return <NotFound slug={state.slug} />
  if (state.status === 'loading') return <div className="min-h-screen bg-black" aria-busy="true" />
  return <StoryPage key={slug} spec={state.spec} />
}

function setMeta(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.name = name
    document.head.appendChild(el)
  }
  el.content = content
}
