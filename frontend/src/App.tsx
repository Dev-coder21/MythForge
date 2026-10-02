import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router'
import { NotFound } from '@/pages/NotFound'

// Each page loads on demand, so the home page never ships the story engine's chapter art up front.
const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })))
const StoryRoute = lazy(() => import('@/pages/StoryRoute').then((m) => ({ default: m.StoryRoute })))
const GalleryPage = lazy(() => import('@/pages/GalleryPage').then((m) => ({ default: m.GalleryPage })))

/** Routes: / (home), /story/:slug, /gallery, and a 404 for everything else. */
export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Suspense fallback={<div className="min-h-screen bg-[#07080c]" aria-busy="true" />}>
        <Routes>
          <Route path="/" element={<LegacyStoryRedirect fallback={<HomePage />} />} />
          <Route path="/story/:slug" element={<StoryRoute />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

/** Old links used /?story=<slug>; send them to /story/<slug>. */
function LegacyStoryRedirect({ fallback }: { fallback: React.ReactNode }) {
  const [params] = useSearchParams()
  const story = params.get('story')
  return story ? <Navigate to={`/story/${encodeURIComponent(story.toLowerCase())}`} replace /> : fallback
}
