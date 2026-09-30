import { useEffect } from 'react'

const SITE = 'MythForge'

/** Per-route document title and meta description (ship checklist). */
export function usePageMeta(title: string | null, description: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : SITE
    setMeta('description', description)
    setMeta('og:title', document.title, 'property')
    setMeta('og:description', description, 'property')
  }, [title, description])
}

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, name)
    document.head.appendChild(el)
  }
  el.content = content
}
