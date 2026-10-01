import type { ComponentType } from 'react'
import type { SceneTemplateId } from '@/spec'
import { Abstract } from './Abstract'
import { Beach } from './Beach'
import { Dune } from './Dune'
import { Forest } from './Forest'
import { Polar } from './Polar'
import { Harbor } from './Harbor'
import { OldCity } from './OldCity'
import { Ruins } from './Ruins'
import { Peak } from './Peak'
import { Tide } from './Tide'
import { LayeredScene, Threshold, type TemplateProps } from './Threshold'

/**
 * Scene templates by spec id. A template is a scene component (the shared
 * layered scene plus its own effects) and its art kits in public/artkits/<id>/.
 * Templates not built yet render as the plain layered scene with their kit.
 */
const TEMPLATES: Partial<Record<SceneTemplateId, ComponentType<TemplateProps>>> = {
  threshold: Threshold,
  dune: Dune,
  tide: Tide,
  peak: Peak,
  skyline: OldCity,
  ruin: Ruins,
  harbor: Harbor,
  grove: Forest,
  beach: Beach,
  polar: Polar,
  cosmos: Abstract,
}

export function templateFor(id: SceneTemplateId): ComponentType<TemplateProps> {
  return TEMPLATES[id] ?? LayeredScene
}

export function registerTemplate(id: SceneTemplateId, component: ComponentType<TemplateProps>) {
  TEMPLATES[id] = component
}
