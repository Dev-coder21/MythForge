import { LayeredScene, type TemplateProps } from './Threshold'

/**
 * Dune: open desert. Layered dunes, monuments and palms from the kit; its
 * signature effects are kit-driven too: heat shimmer near the horizon (kit
 * "heat", applied in the composite pass) and wind-blown sand (kit particles
 * with "windX").
 */
export function Dune(props: TemplateProps) {
  return <LayeredScene {...props} />
}
