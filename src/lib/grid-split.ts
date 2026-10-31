import { Euler, Quaternion, Vector3 } from 'three'
import { autoConnect } from './auto-connect'
import { isPanelConnectedToAssembly } from './assemblies'
import { CONNECTOR_PROFILES } from './connector-profile'
import { createPanel, resolvePanels, validateProject } from './model'
import { parallelPanelCut } from './parallel-panels'
import type { Panel, Project } from './types'

const gap = 2 * CONNECTOR_PROFILES.t.seat
const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const positive = (axis: Vector3) => {
  const dominant = axis.toArray().map(Math.abs).indexOf(Math.max(...axis.toArray().map(Math.abs)))
  return axis.multiplyScalar(Math.sign(axis.getComponent(dominant)))
}

/** Four matching sides of one rectangular opening, including rotated openings. */
export function gridPanelCut(panels: readonly Panel[]) {
  if (panels.length !== 4) return undefined
  const first = panels[0]
  for (const opposite of panels.slice(1)) {
    const a = parallelPanelCut([first, opposite])
    const rest = panels.filter(panel => panel !== first && panel !== opposite)
    const b = parallelPanelCut(rest)
    if (!a || !b) continue
    const axisA = positive(new Vector3(0, 0, 1).applyQuaternion(rotation(a.a)))
    const axisB = positive(new Vector3(0, 0, 1).applyQuaternion(rotation(b.a)))
    if (Math.abs(axisA.dot(axisB)) > .00001) continue
    const centerA = new Vector3(...a.a.position).add(new Vector3(...a.b.position)).multiplyScalar(.5)
    const centerB = new Vector3(...b.a.position).add(new Vector3(...b.b.position)).multiplyScalar(.5)
    if (centerA.distanceTo(centerB) > .01) continue
    const lengthDimension = (panel: Panel, axis: Vector3) => Math.abs(new Vector3(1, 0, 0).applyQuaternion(rotation(panel)).dot(axis)) > .99999 ? 'width' as const : 'height' as const
    const dimA = lengthDimension(a.a, axisB), dimB = lengthDimension(b.a, axisA)
    if (Math.abs(a.a[dimA] - (b.separation - gap)) > .01 || Math.abs(b.a[dimB] - (a.separation - gap)) > .01) continue
    const depthA = dimA === 'width' ? a.a.height : a.a.width
    const depthB = dimB === 'width' ? b.a.height : b.a.width
    if (Math.abs(depthA - depthB) > .01) continue
    const pairA = { panels: [a.a, a.b], axis: axisA, span: a.separation, dimension: dimA }
    const pairB = { panels: [b.a, b.b], axis: axisB, span: b.separation, dimension: dimB }
    // Y follows the more vertical pair; X is the other opening axis.
    const aIsY = Math.abs(Math.abs(axisA.y) - Math.abs(axisB.y)) > .00001
      ? Math.abs(axisA.y) > Math.abs(axisB.y)
      : Math.abs(axisA.x) < Math.abs(axisB.x)
    const [x, y] = aIsY ? [pairB, pairA] : [pairA, pairB]
    return { x, y, center: centerA,
      maxX: Math.max(0, Math.floor((x.span - gap - 40) / (40 + gap))),
      maxY: Math.max(0, Math.floor((y.span - gap - 40) / (40 + gap))) }
  }
  return undefined
}

/** Build all segments with connector gaps, then fit boundary T and interior cross joints atomically. */
export function splitPanelGrid(project: Project, ids: readonly string[], x: number, y: number) {
  if (![x, y].every(value => Number.isInteger(value) && value >= 0) || x + y === 0) throw new Error('Choose at least one divider, using whole numbers.')
  const selected = new Set(ids)
  const frame = gridPanelCut(resolvePanels(project).filter(panel => selected.has(panel.id)))
  if (!frame || selected.size !== 4) throw new Error('Select all four matching sides of a rectangular opening.')
  if (ids.some(id => isPanelConnectedToAssembly(project, id))) throw new Error('Disassemble these panels before dividing the opening.')
  if ([...frame.x.panels, ...frame.y.panels].some(panel => panel.thickness < 18 || panel.thickness > 19)) throw new Error('T and cross connectors need 18–19 mm panels.')
  if (x > frame.maxX || y > frame.maxY) throw new Error('There is not enough room for these dividers and connectors.')
  const addedCount = 3 * (x + y) + 2 * x * y
  if (project.panels.length + addedCount > 200 || project.connections.length + 4 * (x + y) + 3 * x * y > 400) throw new Error('This grid exceeds the project limit of 200 panels or 400 connections.')
  const width = (frame.x.span - (x + 1) * gap) / (x + 1)
  const height = (frame.y.span - (y + 1) * gap) / (y + 1)
  const added: Panel[] = []
  for (const vertical of [true, false]) {
    const count = vertical ? x : y, segments = vertical ? y + 1 : x + 1
    const across = vertical ? frame.x : frame.y, along = vertical ? frame.y : frame.x
    const length = vertical ? height : width
    const step = vertical ? width + gap : height + gap
    const source = across.panels[0]
    for (let line = 1; line <= count; line++) for (let segment = 0; segment < segments; segment++) {
      added.push(createPanel({ ...source, id: crypto.randomUUID(), name: `${vertical ? 'Vertical' : 'Horizontal'} divider ${line}.${segment + 1}`,
        [across.dimension]: length, cornerRadius: 0, customOutline: undefined,
        position: frame.center.clone().addScaledVector(across.axis, -across.span / 2 + line * step)
          .addScaledVector(along.axis, -along.span / 2 + gap / 2 + length / 2 + segment * (length + gap)).toArray(),
      }))
    }
  }
  const result = autoConnect({ ...project, panels: [...project.panels, ...added] }, [...ids, ...added.map(panel => panel.id)])
  if (result.disassembledNames.length) throw new Error('Detach neighboring assemblies before dividing this opening.')
  if (result.splits !== 2 * (x + y)) throw new Error('These divisions cannot preserve the outer joints. Try fewer dividers.')
  const addedConnections = result.project.connections.filter(connection => !project.connections.some(old => old.id === connection.id))
  const crosses = new Set(addedConnections.filter(connection => connection.type === 'cross').map(connection => connection.id.replace(/:\d+$/, '')))
  if (crosses.size !== x * y) throw new Error('There is not enough connector clearance at the grid intersections.')
  const previous = new Set(validateProject(project).map(issue => issue.id))
  const problem = validateProject(result.project).find(issue => !previous.has(issue.id) && (issue.severity === 'error' || issue.id.startsWith('collision-')))
  if (problem) throw new Error(problem.message)
  return { project: result.project, panelIds: [...ids, ...added.map(panel => panel.id), ...result.addedPanelIds], connectors: result.connectors }
}
