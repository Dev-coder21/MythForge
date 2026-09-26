import { CatmullRomCurve3, PerspectiveCamera, Vector3 } from 'three'

export type Vec3Tuple = [number, number, number]

export interface CameraPaths {
  position: CatmullRomCurve3
  lookAt: CatmullRomCurve3
}

export function buildPaths(position: Vec3Tuple[], lookAt: Vec3Tuple[]): CameraPaths {
  const toCurve = (pts: Vec3Tuple[]) =>
    new CatmullRomCurve3(pts.map((p) => new Vector3(...p)), false, 'centripetal')
  return { position: toCurve(position), lookAt: toCurve(lookAt) }
}

export interface Rect {
  minX: number
  maxX: number
  minY: number
  maxY: number
  w: number
  h: number
}

const NDC_CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]

/**
 * World-space rectangle visible on the plane z = `z` for a camera posed at
 * `paths` sample `t`. Used to size layers so they always cover the frame
 * regardless of aspect ratio (desktop vs 390px mobile).
 */
export function makeRectAt(paths: CameraPaths, t: number, fov: number, aspect: number) {
  const cam = new PerspectiveCamera(fov, aspect, 0.1, 500)
  cam.position.copy(paths.position.getPointAt(t))
  cam.lookAt(paths.lookAt.getPointAt(t))
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()

  const origin = cam.position.clone()
  const dir = new Vector3()

  return (z: number): Rect => {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const [x, y] of NDC_CORNERS) {
      dir.set(x, y, 0.5).unproject(cam).sub(origin).normalize()
      const k = (z - origin.z) / dir.z
      const px = origin.x + dir.x * k
      const py = origin.y + dir.y * k
      minX = Math.min(minX, px)
      maxX = Math.max(maxX, px)
      minY = Math.min(minY, py)
      maxY = Math.max(maxY, py)
    }
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY }
  }
}
