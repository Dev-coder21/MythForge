import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** OS-level prefers-reduced-motion, optionally forced on (leva debug toggle). */
export function useReducedMotion(force = false): boolean {
  const [prefers, setPrefers] = useState(() => window.matchMedia(QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = () => setPrefers(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return force || prefers
}
