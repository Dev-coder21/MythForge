/**
 * Art-kit manifest (public/artkits/<template>/<kit>/kit.json).
 *
 * Every layer is placed relative to the chapter's opening frame at its own
 * depth, so a kit composes correctly on any aspect ratio. Replace any texture
 * file with real painted art of the same name; placement stays in kit.json.
 */
export interface KitLight {
  /** Position inside the element image, 0–1 from the left / bottom. */
  u: number
  v: number
  color: string
  intensity: number
  /** Falloff radius in world units. */
  radius: number
  /** Flicker amount 0–1. */
  flicker?: number
  /** Size of the additive glow sprite, as a fraction of the element height. */
  glow?: number
}

export interface KitPlacement {
  /** Horizontal position as a fraction of visible width, from the centre (-0.5 … 0.5). */
  x: number
  /** Texture column (0 left … 1 right, after flip) placed at `x`. Default 0.5. */
  anchorX?: number
  /** Where texture row `anchorY` sits, as a fraction of visible height from the bottom. */
  bottom: number
  /** Texture row (0 = bottom) pinned at `bottom`. Default 0. */
  anchorY?: number
  /** Element height as a fraction of visible height. */
  height: number
  /** Cap on element width as a fraction of visible width (scales it down). */
  maxWidth?: number
  /** Stretch horizontally to cover the frame (ground planes). */
  stretch?: boolean
}

export interface KitLayer extends KitPlacement {
  id: string
  texture: string
  z: number
  /** Mirror horizontally (mirrors baked lighting too; prefer a painted variant). */
  flip?: boolean
  /** Wind sway amount (0 = rigid). */
  sway?: number
  /** Runtime rim strength on edges facing the moon. */
  rim?: number
  /** Blend toward the fog colour (atmospheric perspective), 0–1. */
  fog?: number
  /** Blend toward the chapter palette tint, 0–1. */
  tint?: number
  /** Brightness multiplier (e.g. 0.6 to push a near silhouette darker). */
  shade?: number
  light?: KitLight
  /** Overrides for portrait screens. */
  portrait?: Partial<KitPlacement>
}

export interface KitFog {
  z: number
  opacity: number
  /** Fraction of the plane (from the bottom) where fog fades out. */
  height: number
  speed: number
  scale: number
}

export interface KitParticles {
  /** Sprite-sheet texture id (cells laid out horizontally). */
  texture: string
  cells: number
  count: number
  zMin: number
  zMax: number
  size: number
  speed: number
  /** Fall speed, world units per second. */
  fall: number
  opacity: number
}

export interface KitShafts {
  count: number
  opacity: number
  length: number
  spread: number
}

export interface Kit {
  name: string
  template: string
  textures: Record<string, string>
  layers: KitLayer[]
  fog?: KitFog[]
  particles?: KitParticles[]
  shafts?: KitShafts
}

export const kitUrl = (template: string, kit: string, file = 'kit.json') =>
  `${import.meta.env.BASE_URL}artkits/${template}/${kit}/${file}`
