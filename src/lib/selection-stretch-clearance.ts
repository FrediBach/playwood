import { Euler, Quaternion, Vector3 } from 'three'
import { CONNECTOR_LOCAL_BOUNDS } from './connector-bounds'
import { connectorSlide, getConnectorRail, rescaleConnectorSlides } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { resolvePanels } from './model'
import { panelCornerRadius } from './panel-shape'
import { StructureEditError } from './structure-edit'
import { getTrofastInsertLocalBounds } from './trofast'
import type { Panel, Project, Vec3 } from './types'

interface Body {
  id: string
  kind: 'panel' | 'hardware' | 'insert'
  owner: string
  panelIds: string[]
  connectionId?: string
  center: Vector3
  axes: Vector3[]
  half: number[]
}

const EPSILON = 1e-5
const jointId = (id: string) => id.replace(/:\d+$/, '')
const sourceBodies = new WeakMap<Project, Body[]>()
const axes = (rotation: Quaternion) => [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  .map(axis => axis.applyQuaternion(rotation))

function occupiedBodies(project: Project): Body[] {
  const panels = resolvePanels(project).map(panel => ({ ...panel, visible: true }))
  const bodies: Body[] = []
  for (const panel of panels) {
    const rotation = new Quaternion().setFromEuler(new Euler(...panel.rotation))
    const panelAxes = axes(rotation)
    bodies.push({ id: `panel/${panel.id}`, kind: 'panel', owner: panel.id, panelIds: [panel.id],
      center: new Vector3(...panel.position), axes: panelAxes,
      half: [panel.width, panel.height, panel.thickness].map(value => Math.max(0.1, value / 2 - 0.5)) })
    for (const insert of panel.trofastInserts ?? []) {
      const bounds = getTrofastInsertLocalBounds(panel, insert)
      if (!bounds) continue
      const min = new Vector3(...bounds.min), max = new Vector3(...bounds.max)
      bodies.push({ id: `insert/${panel.id}/${insert.id}`, kind: 'insert', owner: panel.id, panelIds: [panel.id],
        center: min.clone().add(max).multiplyScalar(0.5).applyQuaternion(rotation).add(new Vector3(...panel.position)),
        axes: panelAxes, half: max.sub(min).multiplyScalar(0.5).toArray() })
    }
  }
  const joints = new Map<string, Set<string>>()
  for (const connection of project.connections) {
    const id = jointId(connection.id), members = joints.get(id) ?? new Set<string>()
    members.add(connection.parentId); members.add(connection.childId); joints.set(id, members)
  }
  for (const piece of getPhysicalConnectors(project)) {
    const rail = getConnectorRail(piece.connection, panels, project.connections)
    const placement = rail?.placements[piece.index]
    if (!rail || !placement) throw new StructureEditError('A connector has no usable shared edge.', [], [piece.connection.id])
    const origin = new Vector3(...placement.position).addScaledVector(new Vector3(...rail.tangent),
      connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide))
    const rotation = new Quaternion().setFromEuler(new Euler(...placement.rotation)), hardwareAxes = axes(rotation)
    CONNECTOR_LOCAL_BOUNDS[piece.type].forEach((bounds, index) => {
      const min = new Vector3(...bounds.min), max = new Vector3(...bounds.max)
      bodies.push({ id: `hardware/${piece.id}/${index}`, kind: 'hardware', owner: piece.id,
        panelIds: [...joints.get(jointId(piece.connection.id))!], connectionId: piece.connection.id,
        center: min.clone().add(max).multiplyScalar(0.5).applyQuaternion(rotation).add(origin), axes: hardwareAxes,
        half: max.sub(min).multiplyScalar(0.5).addScalar(0.05).toArray() })
    })
  }
  return bodies
}

/** Joint rails intersect several stock edges. Their active endpoint can switch
 * during a pull; corner-radius clamps can switch too. Split the sweep at those
 * exact affine crossings, so hardware follows its actual piecewise-linear path. */
function sweepSteps(before: Project, after: Project): Project[] {
  const source = resolvePanels(before), target = new Map(resolvePanels(after).map(panel => [panel.id, panel]))
  const scalar = (start: number, end: number, t: number) => start + (end - start) * t
  const panelAt = (panel: Panel, t: number): Panel => {
    const next = target.get(panel.id)!
    return { ...panel, width: scalar(panel.width, next.width, t), height: scalar(panel.height, next.height, t),
      position: panel.position.map((value, axis) => scalar(value, next.position[axis], t)) as Vec3 }
  }
  const times = new Set([0, 1])
  const addCrossing = (a: number[], b: number[], lower: number, upper: number) => {
    const start = a[0] - b[0], end = a[1] - b[1]
    if (Math.abs(start - end) < 1e-10) return
    const fraction = start / (start - end)
    if (fraction > 1e-8 && fraction < 1 - 1e-8) times.add(lower + (upper - lower) * fraction)
  }
  for (const panel of source) {
    if (!panel.cornerRadius) continue
    const next = target.get(panel.id)!
    const values = [[panel.cornerRadius, panel.cornerRadius], [panel.width / 2, next.width / 2], [panel.height / 2, next.height / 2]]
    values.forEach((first, index) => values.slice(index + 1).forEach(second => addCrossing(first, second, 0, 1)))
  }
  const radiusSteps = [...times].sort((a, b) => a - b), byId = new Map(source.map(panel => [panel.id, panel]))
  const afterConnections = new Map(after.connections.map(connection => [connection.id, connection]))
  for (let index = 1; index < radiusSteps.length; index++) {
    const lower = radiusSteps[index - 1], upper = radiusSteps[index]
    const groups = new Map<string, { lower: number[][]; upper: number[][] }>()
    for (const connection of before.connections) {
      if (connection.outlineEdge !== undefined) continue // Unchanged fitted outlines are outside the stretch scope.
      const horizontal = ['top', 'bottom', 'front', 'back'].includes(connection.side)
      const parentSource = byId.get(connection.parentId)!, childSource = byId.get(connection.childId)!
      const next = afterConnections.get(connection.id)!
      const endpoints = [lower, upper].map(t => {
        const parent = panelAt(parentSource, t), child = panelAt(childSource, t)
        const parentLength = horizontal ? parent.width : parent.height
        const childLength = horizontal !== !!connection.quarterTurn ? child.width : child.height
        const parentRadius = ['front', 'back'].includes(connection.side) ? 0 : panelCornerRadius(parent)
        const childRadius = panelCornerRadius(child), offset = scalar(connection.offset, next.offset, t)
        return { lower: [-parentLength / 2 + parentRadius, offset - childLength / 2 + childRadius],
          upper: [parentLength / 2 - parentRadius, offset + childLength / 2 - childRadius] }
      })
      const id = jointId(connection.id), group = groups.get(id) ?? { lower: [], upper: [] }
      for (const side of ['lower', 'upper'] as const) for (let endpoint = 0; endpoint < 2; endpoint++) {
        group[side].push([endpoints[0][side][endpoint], endpoints[1][side][endpoint]])
      }
      groups.set(id, group)
    }
    for (const group of groups.values()) for (const values of [group.lower, group.upper]) {
      values.forEach((first, i) => values.slice(i + 1).forEach(second => addCrossing(first, second, lower, upper)))
    }
  }
  const sorted = [...times].sort((a, b) => a - b).filter((time, index, values) => index === 0 || time === 1 || time - values[index - 1] > 1e-10)
  const steps = sorted.map(t => {
    if (t === 0) return before
    if (t === 1) return after
    const panels = source.map(panel => panelAt(panel, t))
    const intermediate = { ...before, panels, connections: before.connections.map(connection => ({ ...connection,
      offset: scalar(connection.offset, afterConnections.get(connection.id)!.offset, t) })) }
    return rescaleConnectorSlides(before, intermediate, source, panels)
  })
  // A collapsed rail has no meaningful fractional position. A dormant saved
  // slide would start unclamping during growth; do not guess its intended path.
  const visibleSource = source.map(panel => ({ ...panel, visible: true }))
  for (const piece of getPhysicalConnectors(before)) {
    if (Math.abs(before.connectorOverrides?.[piece.id]?.slide ?? 0) < EPSILON) continue
    const original = getConnectorRail(piece.connection, visibleSource, before.connections)
    if (!original || original.upper - original.lower > 1e-6) continue
    for (const step of steps.slice(1)) {
      const connection = step.connections.find(item => item.id === piece.connection.id)!
      const rail = getConnectorRail(connection, resolvePanels(step).map(panel => ({ ...panel, visible: true })), step.connections)
      if (rail && Math.abs((rail.upper - rail.lower) - (original.upper - original.lower)) > 1e-6) {
        throw new StructureEditError('This stretch cannot preserve a saved connector slide on a collapsed rail. Reset that connector position first.', [piece.connection.parentId, piece.connection.childId], [piece.connection.id])
      }
    }
  }
  return steps
}

const reach = (body: Body, axis: Vector3) => body.axes.reduce((sum, own, index) => sum + Math.abs(own.dot(axis)) * body.half[index], 0)

/** A fixed-orientation box whose center and extents vary linearly has linear
 * separating-axis inequalities. Intersect their time intervals to catch even
 * thin obstacles between the source and a distant pointer sample. An existing
 * overlap may remain or improve, but its minimum penetration may not increase. */
function worsensDuringSweep(a: Body, b: Body, nextA: Body, nextB: Body, originalA: Body, originalB: Body): boolean {
  const normals = [...a.axes, ...b.axes, ...a.axes.flatMap(first => b.axes.map(second => new Vector3().crossVectors(first, second)))]
    .filter(axis => axis.lengthSq() > 1e-10).map(axis => axis.clone().normalize())
  const beforeDelta = b.center.clone().sub(a.center), afterDelta = nextB.center.clone().sub(nextA.center)
  const rows = normals.map(axis => ({ before: beforeDelta.dot(axis), after: afterDelta.dot(axis),
    beforeReach: reach(a, axis) + reach(b, axis), afterReach: reach(nextA, axis) + reach(nextB, axis) }))
  const originalDelta = originalB.center.clone().sub(originalA.center)
  const existing = Math.max(0, Math.min(...normals.map(axis => reach(originalA, axis) + reach(originalB, axis) - Math.abs(originalDelta.dot(axis)))))
  let lower = 0, upper = 1
  for (const row of rows) for (const sign of [-1, 1]) {
    const start = row.beforeReach + sign * row.before - existing - EPSILON
    const end = row.afterReach + sign * row.after - existing - EPSILON
    const speed = end - start
    if (Math.abs(speed) < 1e-10) { if (start <= 0) return false; continue }
    const boundary = -start / speed
    if (speed > 0) lower = Math.max(lower, boundary)
    else upper = Math.min(upper, boundary)
    if (lower >= upper - 1e-10) return false
  }
  return lower < upper - 1e-10
}

function sameMotion(a: Body, b: Body, nextA: Body, nextB: Body): boolean {
  return a.center.clone().sub(b.center).distanceTo(nextA.center.clone().sub(nextB.center)) < EPSILON
    && a.half.every((value, index) => Math.abs(value - nextA.half[index]) < EPSILON)
    && b.half.every((value, index) => Math.abs(value - nextB.half[index]) < EPSILON)
}

/** Includes hidden stock and installed pieces, and excludes each clamp's own
 * complete joint and each insert's cutout panel. Conservative CAD/stock boxes
 * retain the editor's existing custom-outline and perforation limitations. */
export function assertSelectionStretchClearance(before: Project, after: Project): void {
  let source = sourceBodies.get(before)
  if (!source) { source = occupiedBodies(before); sourceBodies.set(before, source) }
  const originals = new Map(source.map(body => [body.id, body]))
  for (const step of sweepSteps(before, after).slice(1)) {
    const targets = new Map(occupiedBodies(step).map(body => [body.id, body]))
    const bounds = new Map(source.map(body => {
      const next = targets.get(body.id)!
      const world = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
      return [body.id, world.map((axis, dimension) => [
        Math.min(body.center.getComponent(dimension) - reach(body, axis), next.center.getComponent(dimension) - reach(next, axis)),
        Math.max(body.center.getComponent(dimension) + reach(body, axis), next.center.getComponent(dimension) + reach(next, axis)),
      ])] as const
    }))
    for (const [index, first] of source.entries()) for (const second of source.slice(index + 1)) {
      if (first.kind === 'hardware' && second.kind === 'hardware' && first.owner === second.owner) continue
      if (first.kind === 'panel' && second.kind !== 'panel' && second.panelIds.includes(first.owner)) continue
      if (second.kind === 'panel' && first.kind !== 'panel' && first.panelIds.includes(second.owner)) continue
      const nextFirst = targets.get(first.id), nextSecond = targets.get(second.id)
      if (!nextFirst || !nextSecond) throw new Error('The selection stretch changed the installed parts.')
      if (sameMotion(first, second, nextFirst, nextSecond)) continue
      if (bounds.get(first.id)!.some(([min, max], dimension) => min >= bounds.get(second.id)![dimension][1]
        || max <= bounds.get(second.id)![dimension][0])) continue
      if (!worsensDuringSweep(first, second, nextFirst, nextSecond, originals.get(first.id)!, originals.get(second.id)!)) continue
      const hardware = first.kind === 'hardware' || second.kind === 'hardware'
      const insert = first.kind === 'insert' || second.kind === 'insert'
      throw new StructureEditError(`This stretch would ${hardware ? 'overlap connector hardware' : insert ? 'overlap a storage insert' : 'overlap panels'}. Try a smaller distance.`,
        [...new Set([...first.panelIds, ...second.panelIds])], [first.connectionId, second.connectionId].filter((id): id is string => !!id))
    }
    source = [...targets.values()]
  }
}
