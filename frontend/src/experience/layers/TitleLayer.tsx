import antonWoff from '@fontsource/anton/files/anton-latin-400-normal.woff?url'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Group, Mesh } from 'three'
import { chapterState } from '../store'

/** The bits of troika's Text mesh we touch. */
type TroikaText = Mesh & {
  fillOpacity: number
  outlineOpacity: number
  textRenderInfo?: { caretPositions?: Float32Array; blockBounds: number[] } | null
}

interface TitleLayerProps {
  word: string
  z: number
  /** World x of the word's center (used when `left` is not set). */
  x: number
  /** World x of the word's left edge; the word may then run off the right edge. */
  left?: number
  /** World y of the title baseline (partly hidden behind the foreground). */
  baseY: number
  fontSize: number
  letterSpacing: number
  /** Title is scaled down (never up) to fit this world width (mobile). */
  maxWidth: number
  /** Scale the word to exactly `maxWidth`, up or down (landscape bleed). */
  fill?: boolean
  color: string
  glowColor: string
  glowOpacity: number
  /** How far letters start below the baseline, in font-size units. */
  riseDistance: number
  /** How far the title drifts back in beat 3, in world units. */
  driftBack: number
}

interface Layout {
  xs: number[]
  width: number
}

/**
 * Giant 3D title placed between the mid structure and near foliage. One drei
 * <Text> per letter so each can rise and fade on its own; letter x positions
 * come from troika's caret positions for the full word, so kerning and
 * letter spacing match a normally set word.
 */
export function TitleLayer({
  word,
  z,
  x,
  left,
  baseY,
  fontSize,
  letterSpacing,
  maxWidth,
  fill = false,
  color,
  glowColor,
  glowOpacity,
  riseDistance,
  driftBack,
}: TitleLayerProps) {
  // split('') (not Array.from) so indices match troika's UTF-16 caret array.
  const letters = useMemo(() => word.split(''), [word])
  const [layout, setLayout] = useState<Layout | null>(null)
  const group = useRef<Group>(null)
  const refs = useRef<(TroikaText | null)[]>([])

  const onMeasure = useCallback(
    (mesh: TroikaText) => {
      const info = mesh.textRenderInfo
      const cp = info?.caretPositions
      if (!info || !cp) return
      const xs = letters.map((_, i) => ((cp[i * 4] ?? 0) + (cp[i * 4 + 1] ?? 0)) / 2)
      const width = (info.blockBounds[2] ?? 0) - (info.blockBounds[0] ?? 0)
      setLayout((prev) =>
        prev && prev.width === width && prev.xs.every((v, i) => v === xs[i]) ? prev : { xs, width },
      )
    },
    [letters],
  )

  const fitScale = layout ? maxWidth / layout.width : 1
  const scale = fill ? fitScale : Math.min(1, fitScale)
  const groupX = left !== undefined && layout ? left + (layout.width * scale) / 2 : x

  useFrame(() => {
    const s = chapterState
    const out = s.titleOut
    if (group.current) group.current.position.z = z - out * driftBack
    for (let i = 0; i < letters.length; i++) {
      const mesh = refs.current[i]
      if (!mesh) continue
      const v = s.letters[i]?.v ?? 0
      mesh.position.y = s.reducedMotion ? 0 : -(1 - v) * riseDistance * fontSize
      // The scene blends in linear light, so a linear alpha of 0.1 still reads as
      // ~30% on screen. Square-ish gamma makes titleOut a perceptual fade.
      const alpha = Math.pow(Math.min(1, v * 1.6) * (1 - out), 2.2)
      mesh.fillOpacity = alpha
      mesh.outlineOpacity = glowOpacity * alpha
    }
  })

  const common = {
    font: antonWoff,
    fontSize,
    anchorY: 'bottom-baseline' as const,
    color,
    outlineWidth: 0,
    outlineBlur: '12%',
    outlineColor: glowColor,
  }

  return (
    <group ref={group} position={[groupX, baseY, z]} scale={scale}>
      {/* Spacing lives only in the measuring pass; letters use the measured x positions. */}
      <Text {...common} letterSpacing={letterSpacing} anchorX="center" visible={false} onSync={onMeasure}>
        {word}
      </Text>
      {layout &&
        letters.map((ch, i) => (
          <Text
            key={`${ch}-${i}`}
            ref={(m: TroikaText | null) => {
              refs.current[i] = m
            }}
            {...common}
            anchorX="center"
            position-x={layout.xs[i] ?? 0}
            fillOpacity={0}
            outlineOpacity={0}
          >
            {ch}
          </Text>
        ))}
    </group>
  )
}
