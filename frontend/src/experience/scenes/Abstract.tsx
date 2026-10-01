import { AbstractField } from '../layers/AbstractField'
import { LayeredScene, type TemplateProps } from './Threshold'

/**
 * Abstract (template id "cosmos"): for people, music, history and ideas with no physical place. No art
 * files: a code-only field (painterly nebula or ink wash), light ribbons, floating shapes and drifting
 * motes, all coloured from the chapter palette, so a non-place topic looks intentional.
 */
export function Abstract(props: TemplateProps) {
  const p = props.chapter.sceneParams
  return (
    <LayeredScene
      {...props}
      extras={(ctx) =>
        ctx.kit.abstract ? (
          <AbstractField
            rectAt={ctx.rectAt}
            base={p.primaryColor}
            accent={p.accentColor}
            deep={ctx.colors.skyTop}
            style={ctx.kit.abstract.style}
            ribbons={ctx.kit.abstract.ribbons}
            shapes={ctx.kit.abstract.shapes}
            particles={ctx.kit.abstract.particles}
            reducedMotion={ctx.reducedMotion}
          />
        ) : null
      }
    />
  )
}
