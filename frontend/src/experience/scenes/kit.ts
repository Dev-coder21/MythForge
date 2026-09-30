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
  /** Falloff radius as a multiple of the element's placed height (scales with the element). */
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
  /** Repeat the texture this many times across (tileable strips like the wall). */
  tileX?: number
  /** Skip this layer (e.g. a foreground branch that would crowd portrait copy). */
  hidden?: boolean
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
  /** Gentle vertical bob, world units (things floating on water). */
  bob?: number
  /** Mirror vertically (water reflections). */
  flipY?: boolean
  /** Overall opacity 0–1 (reflections). */
  opacity?: number
  /** Animated reflective water confined to a mask texture (grey, white = water) in this element's UV space. */
  water?: { mask: string; opacity?: number }
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
  /** Sideways wind, world units per second (blown sand). */
  windX?: number
}

export interface KitShafts {
  count: number
  opacity: number
  length: number
  spread: number
  /** Fan direction in radians (-π/2 = straight down). */
  angle?: number
}

type Vec3 = [number, number, number]

/** Per-kit camera move: CatmullRom position + look-at paths sampled by chapter progress. */
export interface KitCamera {
  position: [Vec3, Vec3, Vec3, Vec3]
  lookAt: [Vec3, Vec3, Vec3, Vec3]
  fov?: number
}

/** Sun/moon placement in the opening frame (0–1 from left / bottom). */
export interface KitCelestial {
  u: number
  v: number
  uPortrait?: number
  vPortrait?: number
  /** Radius as a fraction of the frame's short side. */
  size?: number
  driftU?: number
  driftV?: number
  intensity?: number
  halo?: number
}

/** Where the giant title sits (fractions of the frame at the title's depth). */
export interface KitTitle {
  v?: number
  vPortrait?: number
  /** Horizontal centre for vertical titles, from the frame centre (-0.5 … 0.5). */
  x?: number
  xPortrait?: number
  /** Vertical titles: stack height as a fraction of the frame height. */
  height?: number
}

/**
 * A texture file, or candidates tried in order: the first that loads wins. Used to
 * prefer hand-painted art and fall back to the code-painted version.
 */
export type KitTextureSource = string | string[]

/** Per-location light: overrides the palette derived from the spec's colours and time of day. */
export interface KitSky {
  top?: string
  mid?: string
  horizon?: string
  fog?: string
  /** Tint for layers that opt in (kit layer "tint"). */
  tint?: string
  /** Runtime rim light colour. */
  rim?: string
  /** Sun/moon disc colour. */
  sun?: string
}

/** Heat shimmer near the horizon: band centre and half-height (frame fractions), strength. */
export interface KitHeat {
  v: number
  h: number
  strength: number
}

/** A river water plane (Tide): placed like a stretched layer, shaded procedurally. */
export interface KitRiver {
  z: number
  bottom: number
  height: number
  /** Brightness of the sun glitter path (0 = off). */
  glitter?: number
  portrait?: { bottom?: number; height?: number }
}

export interface Kit {
  name: string
  template: string
  textures: Record<string, KitTextureSource>
  layers: KitLayer[]
  fog?: KitFog[]
  particles?: KitParticles[]
  shafts?: KitShafts
  camera?: KitCamera
  celestial?: KitCelestial
  title?: KitTitle
  sky?: KitSky
  heat?: KitHeat
  river?: KitRiver
}

export const kitUrl = (template: string, kit: string, file = 'kit.json') =>
  `${import.meta.env.BASE_URL}artkits/${template}/${kit}/${file}`
