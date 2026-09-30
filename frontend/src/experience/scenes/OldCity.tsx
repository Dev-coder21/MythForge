import { LayeredScene, type TemplateProps } from './Threshold'

/**
 * Old city (template id "skyline"): layered rooftops and chimneys, distant generic domes and
 * spires, a paved plaza with lamp posts in front, birds and haze. The camera rises over the
 * rooftops; an AI-painted landmark takes the hero slot between the roof rows.
 */
export function OldCity(props: TemplateProps) {
  return <LayeredScene {...props} />
}
