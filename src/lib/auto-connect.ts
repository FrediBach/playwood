import { DEFAULT_CONNECTOR_COLOR } from './connector-options'
import { Euler, Quaternion, Vector3 } from 'three'
import { createPanel, getConnectorPlacements, resolvePanels, validateProject } from './model'
import { isPanelConnectedToAssembly } from './assemblies'
import { CONNECTOR_PROFILES } from './connector-profile'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { prepareJointUpgrade } from './prepare-joint-upgrade'
import type { Connection, ConnectorType, Panel, Project, Side } from './types'

const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const sides: Side[] = ['left', 'right', 'top', 'bottom']
const types: ConnectorType[] = ['cross', 't', '90', '105', '150']
const pairKey = (a: string, b: string) => [a, b].sort().join('/')
const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')

function jointGroups(connections: Connection[]) {
  const groups = new Map<string, Connection[]>()
  for (const connection of connections) groups.set(jointId(connection), [...groups.get(jointId(connection)) ?? [], connection])
  return [...groups.values()].map(connections => ({ connections, members: new Set(connections.flatMap(c => [c.parentId, c.childId])) }))
}

function occupiedHardware(project: Project, panels: Panel[]) {
  // Hiding a panel affects display, not the space occupied by its hardware.
  const physicalPanels = panels.map(panel => panel.visible ? panel : { ...panel, visible: true })
  return getPhysicalConnectors(project).flatMap(piece => {
    const rail = getConnectorRail(piece.connection, physicalPanels, project.connections)
    if (!rail) return []
    const slide = connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
    return [{ ...piece, position: new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent), slide) }]
  })
}

function fits(parent: Panel, child: Panel, connection: Connection): boolean {
  const expected = resolvePanels({ version: 1, name: '', panels: [parent, child], connections: [{ ...connection, role: undefined }] })[1]
  if (new Vector3(...expected.position).distanceTo(new Vector3(...child.position)) > 0.5) return false
  const a = rotation(expected), b = rotation(child)
  return axes.every(axis => Math.abs(axis.clone().applyQuaternion(a).dot(axis.clone().applyQuaternion(b))) > 0.99999)
}

/** Fill compatible joints, including complete upgrades of occupied T/cross corners. */
export function autoConnect(project: Project, selectedIds: readonly string[] = []) {
  const prepared = splitInteriorTJoints(project, selectedIds)
  project = prepared.project
  selectedIds = selectedIds.length > 1 ? [...selectedIds, ...prepared.addedPanelIds] : selectedIds
  const worldPanels = resolvePanels(project)
  const panels = worldPanels.filter(panel => panel.visible)
  const selected = new Set(selectedIds)
  const inScope = (a: Panel, b: Panel) => !selected.size || (selected.size === 1 ? selected.has(a.id) || selected.has(b.id) : selected.has(a.id) && selected.has(b.id))
  const byId = new Map(worldPanels.map(panel => [panel.id, panel]))
  let groups = jointGroups(project.connections)
  const connectedPairs = () => new Set(groups.flatMap(group => [...group.members].flatMap(a => [...group.members].filter(b => b !== a).map(b => pairKey(a, b)))))
  let existingPairs = connectedPairs(), occupied = occupiedHardware(project, worldPanels)
  const previousErrors = new Set(validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.id))
  let upgrades = 0
  const disassembledNames = new Set<string>()
  let joints = prepared.splits, connectors = prepared.connectors
  for (const type of types) for (const parent of panels) for (const child of panels) {
    if (parent.id === child.id) continue
    const shared = type === 't' || type === 'cross'
    // Shared joints may need an unselected upright to join the requested pair.
    if (shared ? selected.size && !selected.has(parent.id) && !selected.has(child.id)
      : !inScope(parent, child) || existingPairs.has(pairKey(parent.id, child.id))) continue
    const relative = new Vector3(...child.position).sub(new Vector3(...parent.position)).applyQuaternion(rotation(parent).invert())
    // Distant panels cannot share an edge. Avoid solving every connector pose in large projects.
    if (relative.length() > Math.hypot(parent.width, parent.height) / 2 + Math.hypot(child.width, child.height) / 2 + 40) continue
    for (const side of sides) for (const flip of [false, true]) for (const quarterTurn of [false, true]) {
      const offset = side === 'left' || side === 'right' ? relative.y : relative.x
      const id = crypto.randomUUID()
      const first: Connection = { id: `${id}:0`, parentId: parent.id, childId: child.id, type, side, flip, offset, inset: 0, color: DEFAULT_CONNECTOR_COLOR, count: 2, role: 'support', ...(quarterTurn ? { quarterTurn } : {}) }
      if (!fits(parent, child, first)) continue
      const group = [first]
      const count = type === 'cross' ? 3 : type === 't' ? 2 : 1
      for (let branch = 1; branch < count; branch++) {
        let match: Connection | undefined
        for (const panel of panels) {
          if (panel.id === parent.id || group.some(connection => connection.childId === panel.id)) continue
          const delta = new Vector3(...panel.position).sub(new Vector3(...parent.position)).applyQuaternion(rotation(parent).invert())
          for (const turned of [false, true]) {
            const candidate: Connection = { ...first, id: `${id}:${branch}`, childId: panel.id, count: 0,
              offset: side === 'left' || side === 'right' ? delta.y : delta.x, quarterTurn: turned }
            if (fits(parent, panel, candidate)) { match = candidate; break }
          }
          if (match) break
        }
        if (!match) break
        group.push(match)
      }
      if (group.length !== count) continue
      const members = [parent, ...group.map(connection => byId.get(connection.childId)!)]
      // Only expand selection to complete a joint that connects a requested,
      // previously unconnected pair. Existing joints alone never trigger edits.
      if (!members.some(a => members.some(b => a.id !== b.id && inScope(a, b) && !existingPairs.has(pairKey(a.id, b.id))))) continue
      const candidate: Project = { version: 1, name: '', panels: members, connections: group }
      let rail = getConnectorRail(first, members, group)!
      if (rail.upper - rail.lower < -1e-7) continue
      if (rail.upper - rail.lower < 40 - 1e-7) {
        first.count = 1
        rail = getConnectorRail(first, members, group)!
      }
      const errors = () => validateProject(candidate).filter(issue => issue.severity === 'error' || issue.id.startsWith('collision-'))
      if (errors().length) continue
      const memberIds = new Set(members.map(panel => panel.id))
      const replaced = groups.filter(old => [...old.members].filter(id => memberIds.has(id)).length >= 2)
      // Every occupied slot must be represented, and at the same physical seam.
      // Never delete a partial T/cross joint or an unrelated nearby corner.
      if (replaced.some(old => old.members.size >= memberIds.size || [...old.members].some(id => !memberIds.has(id)))) continue
      const origin = new Vector3(...rail.placements[0].position), tangent = new Vector3(...rail.tangent)
      if (replaced.some(old => {
        const hardware = old.connections.find(c => c.count > 0)!
        const oldRail = getConnectorRail(hardware, worldPanels, old.connections)
        if (!oldRail || Math.abs(tangent.dot(new Vector3(...oldRail.tangent))) < 0.99999) return true
        const delta = new Vector3(...oldRail.placements[0].position).sub(origin)
        return delta.addScaledVector(tangent, -delta.dot(tangent)).length() > 0.5
      })) continue
      const removedIds = new Set(replaced.flatMap(old => old.connections.map(c => c.id)))
      const placements = rail.placements.map(item => new Vector3(...item.position))
      if (placements.some(position => occupied.some(other => !removedIds.has(other.connection.id) && position.distanceTo(other.position) < 40 - 0.1))) continue
      const replacementHardware = occupied.filter(piece => removedIds.has(piece.connection.id))
      const color = replaced[0]?.connections[0].color ?? DEFAULT_CONNECTOR_COLOR
      for (const connection of group) connection.color = color
      const baked = prepareJointUpgrade(project, replaced.flatMap(old => old.connections))
      // Removing a driving attachment must leave its child at its world pose;
      // descendants keep their existing attachments to that stationary child.
      const released = new Set(replaced.flatMap(old => old.connections.filter(c => c.role !== 'support').map(c => c.childId)))
      const next: Project = { ...baked.project,
        panels: released.size ? baked.project.panels.map(panel => released.has(panel.id) ? byId.get(panel.id)! : panel) : baked.project.panels,
        connections: [...baked.project.connections.filter(connection => !removedIds.has(connection.id)), ...group] }
      if (next.connections.length > 400) throw new Error('Projects support up to 400 connections. Remove unused connectors first.')
      if (removedIds.size) {
        const overrides = Object.fromEntries(Object.entries(project.connectorOverrides ?? {}).filter(([key]) => !removedIds.has(JSON.parse(key)[0])))
        // Keep per-piece finishes; old type/slide/removal overrides cannot be
        // applied to replacement hardware on a newly fitted shared rail.
        placements.forEach((position, index) => {
          const nearest = [...replacementHardware].sort((a, b) => position.distanceToSquared(a.position) - position.distanceToSquared(b.position))[0]
          if (nearest && nearest.color !== color) overrides[connectorId(first.id, index)] = { color: nearest.color }
        })
        if (project.connectorOverrides || Object.keys(overrides).length) next.connectorOverrides = overrides
        if (validateProject(next).some(issue => issue.severity === 'error' && !previousErrors.has(issue.id))) continue
      }
      project = next
      groups = jointGroups(project.connections); existingPairs = connectedPairs(); occupied = occupiedHardware(project, worldPanels)
      upgrades += replaced.length
      baked.disassembledNames.forEach(name => disassembledNames.add(name))
      joints++; connectors += first.count
    }
  }
  return { project, joints, connectors, upgrades, disassembledNames: [...disassembledNames], splits: prepared.splits, addedPanelIds: prepared.addedPanelIds }
}


/** A continuous panel is cut around the CAD body's 35 mm central gap.
 * Try the complete edit first, including any existing joints on the outer edges.
 * A rejected candidate never alters the project.
 */
export function splitInteriorTJoints(original: Project, selectedIds: readonly string[]) {
  let project = original, splits = 0, connectors = 0
  const addedPanelIds: string[] = [], selected = new Set(selectedIds)
  const seat = CONNECTOR_PROFILES.t.seat
  const previousErrors = new Set(validateProject(original).filter(issue => issue.severity === 'error').map(issue => issue.id))
  for (let changed = true; changed;) {
    changed = false
    const panels = resolvePanels(project)
    outer: for (const shelf of panels) for (const divider of panels) {
      // Splitting a polygon can create disconnected pieces; never rescale the
      // same outline onto both halves of a rectangular stock cut.
      if (shelf.id === divider.id || !shelf.visible || !divider.visible || shelf.customOutline) continue
      if (selected.size && !(selectedIds.length === 1 ? selected.has(shelf.id) || selected.has(divider.id) : selected.has(shelf.id) && selected.has(divider.id))) continue
      if (project.connections.some(c => [c.parentId, c.childId].includes(shelf.id) && [c.parentId, c.childId].includes(divider.id))) continue
      if (isPanelConnectedToAssembly(project, shelf.id)) continue
      const local = new Vector3(...divider.position).sub(new Vector3(...shelf.position)).applyQuaternion(rotation(shelf).invert())
      for (const dimension of ['width', 'height'] as const) {
        const axis = dimension === 'width' ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
        const cut = local.dot(axis), length = shelf[dimension]
        const leftLength = length / 2 + cut - seat, rightLength = length / 2 - cut - seat
        if (leftLength < 40 || rightLength < 40) continue
        const worldAxis = axis.applyQuaternion(rotation(shelf))
        const left: Panel = { ...shelf, [dimension]: leftLength, position: new Vector3(...shelf.position).addScaledVector(worldAxis, (leftLength - length) / 2).toArray() }
        const right = createPanel({ ...shelf, id: crypto.randomUUID(), name: `${shelf.name.slice(0, 108)} (section)`, [dimension]: rightLength, position: new Vector3(...shelf.position).addScaledVector(worldAxis, (length - rightLength) / 2).toArray() })
        for (const flip of [false, true]) {
          const id = crypto.randomUUID()
          const first: Connection = { id: `${id}:0`, parentId: left.id, childId: divider.id, type: 't', side: dimension === 'width' ? 'right' : 'top', flip, offset: 0, inset: 0, color: DEFAULT_CONNECTOR_COLOR, count: 2, role: 'support' }
          if (!fits(left, divider, first)) continue
          const second: Connection = { ...first, id: `${id}:1`, childId: right.id, count: 0 }
          if (!fits(left, right, second)) continue
          const localProject: Project = { version: 1, name: '', panels: [left, divider, right], connections: [first, second] }
          if (validateProject(localProject).some(issue => issue.id.endsWith('-overlap'))) first.count = 1
          if (validateProject(localProject).some(issue => issue.severity === 'error' || issue.id.startsWith('collision-'))) continue
          const nextPanels = panels.map(panel => panel.id === shelf.id ? left : panel).concat(right)
          const byId = new Map(nextPanels.map(panel => [panel.id, panel]))
          const affectedGroups = new Set(project.connections.filter(c => c.parentId === shelf.id || c.childId === shelf.id).map(c => c.id.replace(/:\d+$/, '')))
          const remapped: Connection[] = []
          let compatible = true
          for (const connection of project.connections) {
            if (!affectedGroups.has(connection.id.replace(/:\d+$/, ''))) { remapped.push(connection); continue }
            const parents = connection.parentId === shelf.id ? [left, right] : [byId.get(connection.parentId)!]
            const children = connection.childId === shelf.id ? [left, right] : [byId.get(connection.childId)!]
            let match: Connection | undefined
            for (const parent of parents) for (const child of children) {
              const delta = new Vector3(...child.position).sub(new Vector3(...parent.position)).applyQuaternion(rotation(parent).invert())
              const offset = connection.side === 'left' || connection.side === 'right' ? delta.y : delta.x
              // Retain identical branch metadata when transforms only add floating-point noise.
              const candidate: Connection = { ...connection, role: 'support', parentId: parent.id, childId: child.id, offset: Math.abs(offset - connection.offset) < 1e-7 ? connection.offset : offset }
              if (fits(parent, child, candidate)) match = candidate
            }
            if (!match) { compatible = false; break }
            remapped.push(match)
          }
          if (!compatible) continue
          const placements = getConnectorPlacements(first, left, divider)
          const blocked = remapped.filter(c => c.count > 0).some(c => {
            const parent = byId.get(c.parentId)!, child = byId.get(c.childId)!
            return getConnectorPlacements(c, parent, child).some(existing => placements.some(placed => new Vector3(...existing.position).distanceTo(new Vector3(...placed.position)) < 40))
          })
          if (blocked) continue
          const next = { ...project, panels: nextPanels, connections: [...remapped, first, second] }
          if (next.panels.length > 200 || next.connections.length > 400) throw new Error('This T joint would exceed the project limit of 200 panels or 400 connections.')
          if (validateProject(next).some(issue => issue.severity === 'error' && !previousErrors.has(issue.id))) continue
          project = next; splits++; connectors += first.count; addedPanelIds.push(right.id)
          if (selected.has(shelf.id)) selected.add(right.id)
          changed = true
          break outer
        }
      }
    }
  }
  return { project, splits, connectors, addedPanelIds }
}
