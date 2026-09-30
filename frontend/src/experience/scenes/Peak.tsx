import { LayeredScene, type TemplateProps } from './Threshold'

/**
 * Peak: any mountain, range or volcano. Layered ranges with a dominant summit,
 * pine slopes and a foreground ledge come from the kit; the camera climbs past
 * the ledge to reveal the summit (kit camera). Mist drifts between the ranges
 * (kit fog), snow blows across (kit particles with windX), and the light
 * follows the spec's time of day through the kit's skyByTime (moonlight,
 * alpenglow, clear day).
 */
export function Peak(props: TemplateProps) {
  return <LayeredScene {...props} />
}
