import { Tide } from './Tide'
import type { TemplateProps } from './Threshold'

/**
 * Harbor: open sea (the Tide water shader: waves, sky reflection, sun glitter path, from the kit's
 * "river" block), a stone seawall promenade in front, moored boats and a ferry, a low far skyline,
 * gulls and sea mist. The camera drifts along the waterfront; the landmark stands across the water.
 */
export function Harbor(props: TemplateProps) {
  return <Tide {...props} />
}
