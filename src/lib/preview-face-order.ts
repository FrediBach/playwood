import { Vector3 } from 'three'

export interface PreviewFace {
  points: Vector3[]
  normal: Vector3
  color: string
  /** Whether the edge arriving at this vertex is an original outline. */
  edges: boolean[]
}
const epsilon = 1e-6

function clipFace(face: PreviewFace, distances: number[], sign: number): PreviewFace {
  const points: Vector3[] = [], edges: boolean[] = []
  for (let index = 0; index < face.points.length; index++) {
    const next = (index + 1) % face.points.length
    const a = face.points[index], b = face.points[next]
    const da = distances[index] * sign, db = distances[next] * sign
    const insideA = da >= 0, insideB = db >= 0
    if (insideA !== insideB) {
      points.push(a.clone().lerp(b, da / (da - db)))
      edges.push(insideA && face.edges[next])
    }
    if (insideB) { points.push(b); edges.push(face.edges[next]) }
  }
  return { ...face, points, edges }
}

/** Painter ordering needs plane splits: average face depth fails for long shelves
 * and side panels. An iterative BSP traversal avoids recursion limits and emits
 * convex fragments back to front, preserving just the original outline edges. */
export function orderPreviewFaces(faces: PreviewFace[], viewDirection: Vector3): PreviewFace[] {
  const ordered: PreviewFace[] = []
  const tasks: { faces: PreviewFace[]; emit?: boolean }[] = [{ faces }]
  while (tasks.length) {
    const task = tasks.pop()!
    if (task.emit || task.faces.length < 2) { ordered.push(...task.faces); continue }
    const plane = task.faces[Math.floor(task.faces.length / 2)]
    const offset = plane.normal.dot(plane.points[0])
    const front: PreviewFace[] = [], back: PreviewFace[] = [], coplanar: PreviewFace[] = []
    for (const face of task.faces) {
      const distances = face.points.map(point => {
        const distance = plane.normal.dot(point) - offset
        return Math.abs(distance) < epsilon ? 0 : distance
      })
      const positive = distances.some(distance => distance > 0)
      const negative = distances.some(distance => distance < 0)
      if (positive && negative) {
        front.push(clipFace(face, distances, 1))
        back.push(clipFace(face, distances, -1))
      } else if (positive) front.push(face)
      else if (negative) back.push(face)
      else coplanar.push(face)
    }
    const towardFront = plane.normal.dot(viewDirection) >= 0
    tasks.push({ faces: towardFront ? front : back }, { faces: coplanar, emit: true }, { faces: towardFront ? back : front })
  }
  return ordered
}
