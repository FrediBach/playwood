import { Euler, Vector3 } from 'three'
import { connectClosingPanel } from './closure-connectors'
import { getPhysicalConnectors } from './connector-selection'
import { getConnectorSeam, createPanel, resolvePanels } from './model'
import { outlineConnectionAligned } from './outline-closures'
import type { PanelHole } from './close-holes'
import type { Connection, Panel, Project, Side } from './types'

type Point = { x: number; y: number }
interface Rectangle { x: number; y: number; right: number; bottom: number }
const epsilon = 1e-4
// Hole fitting can introduce sub-micron roundoff on nominally coincident lines.
function closingPoints(panel: Panel): Point[] {
  const points = panel.customOutline!.map(p => ({ x: p.x * panel.width, y: p.y * panel.height }))
  for (const axis of ['x', 'y'] as const) {
    const values: number[] = []
    for (const p of points) {
      const same = values.find(value => Math.abs(value - p[axis]) < epsilon)
      if (same === undefined) values.push(p[axis])
      else p[axis] = same
    }
  }
  return points
}

/** Exact strips, merged across adjacent columns when their occupied intervals match. */
export function partitionClosingOutline(panel: Panel, horizontal = false): Rectangle[] {
  const points = closingPoints(panel).map(p => horizontal ? { x: p.y, y: p.x } : p)
  const xs = [...new Set(points.map(p => p.x))].sort((a, b) => a - b), ys = [...new Set(points.map(p => p.y))].sort((a, b) => a - b)
  const inside = (x: number, y: number) => {
    let result = false
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length]
      if ((a.y > y) !== (b.y > y) && x < a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)) result = !result
    }
    return result
  }
  const rectangles: Rectangle[] = []
  for (let x = 0; x < xs.length - 1; x++) {
    let start: number | undefined
    for (let y = 0; y < ys.length; y++) {
      const occupied = y < ys.length - 1 && inside((xs[x] + xs[x + 1]) / 2, (ys[y] + ys[y + 1]) / 2)
      if (occupied && start === undefined) start = y
      if (!occupied && start !== undefined) {
        const previous = rectangles.find(r => r.right === xs[x] && r.y === ys[start!] && r.bottom === ys[y])
        if (previous) previous.right = xs[x + 1]
        else rectangles.push({ x: xs[x], right: xs[x + 1], y: ys[start], bottom: ys[y] })
        start = undefined
      }
    }
  }
  return horizontal ? rectangles.map(r => ({ x: r.y, right: r.bottom, y: r.x, bottom: r.right })) : rectangles
}

function sharesBoundary(rect: Rectangle, a: Point, b: Point) {
  if (Math.abs(a.x - b.x) < epsilon) return (Math.abs(a.x - rect.x) < epsilon || Math.abs(a.x - rect.right) < epsilon)
    && Math.min(Math.max(a.y, b.y), rect.bottom) - Math.max(Math.min(a.y, b.y), rect.y) > epsilon
  return (Math.abs(a.y - rect.y) < epsilon || Math.abs(a.y - rect.bottom) < epsilon)
    && Math.min(Math.max(a.x, b.x), rect.right) - Math.max(Math.min(a.x, b.x), rect.x) > epsilon
}

/** Rectangles meet at bare seams; every piece attaches only to the original rim. */
export function closeWithRectangles(project: Project, hole: PanelHole, horizontal = false): Project {
  const template = hole.panel, world = resolvePanels(project), byId = new Map(world.map(p => [p.id, p]))
  const outline = closingPoints(template)
  const edges = hole.boundaryIds.map(id => {
    const parent = byId.get(id)!
    for (let edge = 0; edge < outline.length; edge++) for (const side of ['left', 'right', 'top', 'bottom'] as Side[]) for (const flip of [false, true]) {
      const joint: Connection = { id: 'probe', parentId: id, childId: template.id, type: '90', role: 'support', outlineEdge: edge, side, flip, offset: 0, inset: 0, count: 1, color: '#ff0000' }
      if (!outlineConnectionAligned(parent, template, joint)) continue
      const seam = getConnectorSeam(joint, parent, template)
      if (seam.upper >= seam.lower) return { id, edge }
    }
    throw new Error('Cannot identify the wall supporting a rectangular closing face.')
  })
  let next = project
  const supports = new Map<string, string[]>()
  for (const [index, rect] of partitionClosingOutline(template, horizontal).entries()) {
    const width = rect.right - rect.x, height = rect.bottom - rect.y
    if ([width, height].some(size => size < 40 || size > 4000)) throw new Error('Rectangular closing pieces must have cuts between 40 and 4000 mm.')
    const boundary = edges.filter(({ edge }) => sharesBoundary(rect, outline[edge], outline[(edge + 1) % outline.length])).map(({ id }) => id)
    if (new Set(boundary).size < 2) throw new Error('Every rectangular closing piece needs attachments to at least two surrounding walls.')
    const position = new Vector3((rect.x + rect.right - template.width) / 2, (template.height - rect.y - rect.bottom) / 2, 0).applyEuler(new Euler(...template.rotation)).add(new Vector3(...template.position)).toArray()
    const panel = createPanel({ ...template, id: crypto.randomUUID(), name: `${template.name} piece ${index + 1}`, width, height, position, customOutline: undefined })
    next = connectClosingPanel(next, panel, boundary)
    supports.set(panel.id, boundary)
  }
  const hardware = getPhysicalConnectors(next)
  for (const [piece, boundary] of supports) if (boundary.some(id => !hardware.some(({ connection: c }) => c.type === '90' && (c.parentId === id && c.childId === piece || c.parentId === piece && c.childId === id)))) throw new Error('Cannot fit every rectangular closing piece to its surrounding walls.')
  if (next.connections.some(c => supports.has(c.parentId) && supports.has(c.childId))) throw new Error('Rectangular closing pieces must attach to walls, not to each other.')
  return next
}
