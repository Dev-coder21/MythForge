import { AuroraLayer } from '../layers/AuroraLayer'
import { LayeredScene, type TemplateProps } from './Threshold'

/**
 * Ice / polar: a far glacier range, an ice cliff with blue crevasses, an iceberg, floes and a snowfield in
 * front, drifting snow; at night an aurora (kit "aurora") folds across the sky. The camera glides low over
 * the ice toward the cliff.
 */
export function Polar(props: TemplateProps) {
  const night = props.chapter.sceneParams.timeOfDay === 'night'
  return (
    <LayeredScene
      {...props}
      extras={(ctx) =>
        night && ctx.kit.aurora ? (
          <AuroraLayer
            z={ctx.kit.aurora.z}
            rect={ctx.rectAt(ctx.kit.aurora.z)}
            colorA={ctx.kit.aurora.colorA}
            colorB={ctx.kit.aurora.colorB}
            opacity={ctx.kit.aurora.opacity}
            v={ctx.kit.aurora.v}
            h={ctx.kit.aurora.h}
            speed={ctx.reducedMotion ? 0 : ctx.kit.aurora.speed}
          />
        ) : null
      }
    />
  )
}
