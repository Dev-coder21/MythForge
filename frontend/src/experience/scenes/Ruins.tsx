import { LayeredScene, type TemplateProps } from './Threshold'

/**
 * Ancient ruins (template id "ruin"): broken columns, a ruined arch and fallen blocks at several
 * depths, dry grass and wildflowers in front, distant hills, dust motes in light shafts. The camera
 * walks in between the columns; the landmark stands beyond the colonnade.
 */
export function Ruins(props: TemplateProps) {
  return <LayeredScene {...props} />
}
