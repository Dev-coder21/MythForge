import { RiverWater } from '../layers/RiverWater'
import { LayeredScene, type TemplateProps } from './Threshold'

/**
 * Tide: a wide river. Banks, reeds, boats and far monuments come from the kit;
 * the water itself is a procedural surface (kit "river") with sky reflection,
 * ripples and a sun glitter path.
 */
export function Tide(props: TemplateProps) {
  return (
    <LayeredScene
      {...props}
      extras={(ctx) =>
        ctx.kit.river ? (
          <RiverWater
            river={ctx.kit.river}
            rectAt={ctx.rectAt}
            portrait={ctx.portrait}
            skyTop={ctx.colors.skyTop}
            skyMid={ctx.colors.skyMid}
            skyHorizon={ctx.colors.skyHorizon}
            sun={ctx.colors.moon}
            sunUV={ctx.celestialUV}
          />
        ) : null
      }
    />
  )
}
