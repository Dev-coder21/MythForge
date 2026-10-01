import { LayeredScene, type TemplateProps } from './Threshold'

/**
 * Forest / jungle (template id "grove"): misty far canopy, a row of tall trunks, a near trunk framing
 * the side, hanging vines across the top, ferns in front; light shafts and fireflies or mist from the kit.
 * The camera walks slowly in between the trunks; a landmark stands beyond them in the hero slot.
 */
export function Forest(props: TemplateProps) {
  return <LayeredScene {...props} />
}
