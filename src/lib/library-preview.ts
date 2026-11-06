import { connectorDisplayColor } from './connector-options'
import { getConnectionAnchors, resolvePanels } from './model'
import type { Project } from './types'
import { Color, Euler, Vector3 } from 'three'

type PreviewFace = { points: Vector3[]; color: string; depth: number }
const cameraDirection = new Vector3(1, 0.8, 1).normalize()
const screenRight = new Vector3(1, 0, -1).normalize()
const screenUp = new Vector3().crossVectors(cameraDirection, screenRight)
const projectPoint = (point: Vector3) => [point.dot(screenRight), -point.dot(screenUp)]

/** A small orthographic drawing of the same panels that will open in the editor. */
function previewFaces(project: Project): PreviewFace[] {
  const panels = resolvePanels(project)
  const faces: PreviewFace[] = []
  for (const panel of panels) {
    const rotation = new Euler(...panel.rotation)
    const corners = Array.from({ length: 8 }, (_, index) => new Vector3(
      (index & 1 ? 1 : -1) * panel.width / 2,
      (index & 2 ? 1 : -1) * panel.height / 2,
      (index & 4 ? 1 : -1) * panel.thickness / 2,
    ).applyEuler(rotation).add(new Vector3(...panel.position)))
    const sides = [
      { indices: [0, 4, 6, 2], normal: new Vector3(-1, 0, 0) },
      { indices: [1, 3, 7, 5], normal: new Vector3(1, 0, 0) },
      { indices: [0, 1, 5, 4], normal: new Vector3(0, -1, 0) },
      { indices: [2, 6, 7, 3], normal: new Vector3(0, 1, 0) },
      { indices: [0, 2, 3, 1], normal: new Vector3(0, 0, -1) },
      { indices: [4, 5, 7, 6], normal: new Vector3(0, 0, 1) },
    ]
    for (const side of sides) {
      const normal = side.normal.applyEuler(rotation)
      if (normal.dot(cameraDirection) <= 0.00001) continue
      const points = side.indices.map(index => corners[index])
      const light = 0.72 + 0.28 * Math.max(0, normal.dot(new Vector3(0.2, 1, 0.5).normalize()))
      faces.push({ points, color: `#${new Color(panel.color).multiplyScalar(light).getHexString()}`,
        depth: points.reduce((sum, point) => sum + point.dot(cameraDirection), 0) / points.length })
    }
  }
  const byId = new Map(panels.map(panel => [panel.id, panel]))
  for (const connection of project.connections) {
    const parent = byId.get(connection.parentId), child = byId.get(connection.childId)
    if (!parent || !child) continue
    for (const anchor of getConnectionAnchors(connection, parent, child)) {
      const center = new Vector3(...anchor)
      // Draw a hardware-sized square in the projection so seams remain legible.
      const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => center.clone()
        .addScaledVector(screenRight, x * 16).addScaledVector(screenUp, y * 16))
      faces.push({ points, color: connectorDisplayColor(connection), depth: center.dot(cameraDirection) + 20 })
    }
  }
  return faces.sort((a, b) => a.depth - b.depth)
}

export type LibraryDrawing = { color: string; points: string }[]

export function createLibraryDrawing(project: Project): LibraryDrawing {
  const faces = previewFaces(project).map(face => ({ ...face, projected: face.points.map(projectPoint) }))
  if (!faces.length) return []
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const face of faces) for (const [x, y] of face.projected) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const scale = Math.min(204 / Math.max(1, maxX - minX), 119 / Math.max(1, maxY - minY))
  return faces.map(face => ({ color: face.color, points: face.projected.map(([x, y]) =>
    `${120 + (x - (minX + maxX) / 2) * scale},${76 + (y - (minY + maxY) / 2) * scale}`).join(' ') }))
}
