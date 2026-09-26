import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { MathUtils, Vector2, Vector3 } from 'three'
import { chapterState } from '../store'
import type { CameraPaths } from './paths'

interface CameraRigProps {
  paths: CameraPaths
  /** Max parallax offset in world units (spec: ~0.3). */
  parallax: number
  /** Damping factor for the parallax lerp (higher = snappier). */
  parallaxDamping: number
  /** Path sample used as a static pose when reduced motion is on. */
  reducedPoseT: number
}

const pos = new Vector3()
const look = new Vector3()

/** Samples the position + look-at curves by chapter progress and adds lerped mouse parallax. */
export function CameraRig({ paths, parallax, parallaxDamping, reducedPoseT }: CameraRigProps) {
  const offset = useRef(new Vector2())

  useFrame(({ camera }, dt) => {
    const reduced = chapterState.reducedMotion
    const t = reduced ? reducedPoseT : MathUtils.clamp(chapterState.progress, 0, 1)

    paths.position.getPointAt(t, pos)
    paths.lookAt.getPointAt(t, look)

    const o = offset.current
    const tx = reduced ? 0 : chapterState.pointer.x * parallax
    const ty = reduced ? 0 : chapterState.pointer.y * parallax * 0.6
    o.x = MathUtils.damp(o.x, tx, parallaxDamping, dt)
    o.y = MathUtils.damp(o.y, ty, parallaxDamping, dt)

    camera.position.set(pos.x + o.x, pos.y + o.y, pos.z)
    // Shift the look target by a fraction of the offset so parallax reads as a head move, not a pan.
    camera.lookAt(look.x + o.x * 0.35, look.y + o.y * 0.35, look.z)
  })

  return null
}
