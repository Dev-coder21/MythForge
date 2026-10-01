import { Tide } from './Tide'
import type { TemplateProps } from './Threshold'

/**
 * Beach / island: shallow turquoise water (the Tide water shader with the kit's river tint), a sand beach
 * with a foam edge, leaning palms, shore rocks and low islands on the horizon. The camera drifts along the
 * shore; a landmark (a lighthouse, a pavilion) stands on the far point in the hero slot.
 */
export function Beach(props: TemplateProps) {
  return <Tide {...props} />
}
