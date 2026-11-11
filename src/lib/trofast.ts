import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { CONNECTOR_LOCAL_BOUNDS } from './connector-bounds'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { resolvePanels } from './model'
import { panelCornerRadius } from './panel-shape'
import { getTrofastItem, type TrofastItem } from './trofast-catalog'
import type { Panel, Project, TrofastInsert, ValidationIssue, Vec3 } from './types'

/** A visual design allowance, not a structural or fabrication specification. */
export const TROFAST_EDGE_MARGIN = 20
export const MAX_TROFAST_INSERTS = 24
const EPSILON = 0.001
const quaternion = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const rotationMatrix = (rotation: Quaternion) => new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(rotation))
const uid = () => globalThis.crypto?.randomUUID?.() ?? `trofast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function getTrofastFace(panel: Panel): 1 | -1 {
  return new Vector3(0, 0, 1).applyQuaternion(quaternion(panel)).y >= 0 ? 1 : -1
}

export function getTrofastPanelReason(panel: Panel): string {
  if (panel.pattern !== 'solid' || panel.customOutline) return 'TROFAST cutouts need a solid rectangular panel.'
  if (Math.abs(new Vector3(0, 0, 1).applyQuaternion(quaternion(panel)).y) < 0.999999) return 'Place the panel flat, parallel to the ground, to add TROFAST storage.'
  return ''
}

export function getTrofastPositionBounds(panel: Panel, item: TrofastItem, quarterTurn = false) {
  const width = quarterTurn ? item.depth : item.width, height = quarterTurn ? item.width : item.depth
  const minX = width / 2 + TROFAST_EDGE_MARGIN, minY = height / 2 + TROFAST_EDGE_MARGIN
  const maxX = panel.width - minX, maxY = panel.height - minY
  return maxX + EPSILON < minX || maxY + EPSILON < minY ? null : { minX, maxX, minY, maxY }
}

/** Conservative outer envelope, including the rim, in panel-local millimeters. */
export function getTrofastInsertLocalBounds(panel: Panel, insert: TrofastInsert): { min: Vec3; max: Vec3 } | null {
  const item = getTrofastItem(insert.itemId)
  if (!item) return null
  const width = insert.quarterTurn ? item.depth : item.width, height = insert.quarterTurn ? item.width : item.depth
  const x = insert.x - panel.width / 2, y = panel.height / 2 - insert.y
  const z1 = insert.face * (panel.thickness / 2 + item.rimHeight)
  const z2 = insert.face * (panel.thickness / 2 + item.rimHeight - item.height)
  return { min: [x - width / 2, y - height / 2, Math.min(z1, z2)], max: [x + width / 2, y + height / 2, Math.max(z1, z2)] }
}

export function getTrofastInsertObb(panel: Panel, insert: TrofastInsert): OBB | null {
  const bounds = getTrofastInsertLocalBounds(panel, insert)
  if (!bounds) return null
  const min = new Vector3(...bounds.min), max = new Vector3(...bounds.max), rotation = quaternion(panel)
  return new OBB(min.clone().add(max).multiplyScalar(0.5).applyQuaternion(rotation).add(new Vector3(...panel.position)),
    max.sub(min).multiplyScalar(0.5), rotationMatrix(rotation))
}

function panelObb(panel: Panel) {
  return new OBB(new Vector3(...panel.position), new Vector3(panel.width, panel.height, panel.thickness).multiplyScalar(0.5), rotationMatrix(quaternion(panel)))
}

function fitsRoundedPanel(panel: Panel, insert: TrofastInsert, item: TrofastItem) {
  const halfWidth = (insert.quarterTurn ? item.depth : item.width) / 2 + TROFAST_EDGE_MARGIN
  const halfHeight = (insert.quarterTurn ? item.width : item.depth) / 2 + TROFAST_EDGE_MARGIN
  const radius = panelCornerRadius(panel)
  return [-1, 1].every(sx => [-1, 1].every(sy => {
    const x = Math.abs(insert.x - panel.width / 2 + sx * halfWidth)
    const y = Math.abs(insert.y - panel.height / 2 + sy * halfHeight)
    if (x > panel.width / 2 + EPSILON || y > panel.height / 2 + EPSILON) return false
    const dx = Math.max(0, x - (panel.width / 2 - radius)), dy = Math.max(0, y - (panel.height / 2 - radius))
    return dx * dx + dy * dy <= radius * radius + EPSILON
  }))
}

function connectorObbs(project: Project, panels: Panel[]) {
  // Visibility is a display preference; hidden parts still occupy physical space.
  const visible = panels.map(panel => panel.visible ? panel : { ...panel, visible: true })
  return getPhysicalConnectors(project).flatMap(piece => {
    const rail = getConnectorRail(piece.connection, visible, project.connections)
    if (!rail) return []
    const placement = rail.placements[piece.index]
    if (!placement) return []
    const origin = new Vector3(...placement.position).addScaledVector(new Vector3(...rail.tangent), connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide))
    const rotation = new Quaternion().setFromEuler(new Euler(...placement.rotation))
    return CONNECTOR_LOCAL_BOUNDS[piece.type].map(bounds => {
      const min = new Vector3(...bounds.min), max = new Vector3(...bounds.max)
      return new OBB(min.clone().add(max).multiplyScalar(0.5).applyQuaternion(rotation).add(origin),
        max.sub(min).multiplyScalar(0.5), rotationMatrix(rotation))
    })
  })
}

interface PlacementContext { panels: Panel[]; hardware: OBB[]; world: boolean }
function placementIssues(panel: Panel, insert: TrofastInsert, context: PlacementContext): { key: string; message: string }[] {
  const issues: { key: string; message: string }[] = []
  const add = (key: string, message: string) => issues.push({ key, message })
  const item = getTrofastItem(insert.itemId)
  if (!item) return [{ key: 'item', message: 'Choose an available TROFAST item.' }]
  if (!item.colors.includes(insert.colorId)) add('color', 'Choose a color available for this TROFAST item.')
  if (panel.pattern !== 'solid' || panel.customOutline) add('shape', 'TROFAST cutouts need a solid rectangular panel.')
  if (context.world) {
    const normalY = new Vector3(0, 0, insert.face).applyQuaternion(quaternion(panel)).y
    if (normalY < 0.999999) add('orientation', 'Keep the TROFAST panel flat with the box opening facing upward.')
  }
  if (!Number.isFinite(insert.x) || !Number.isFinite(insert.y) || !fitsRoundedPanel(panel, insert, item)) add('fit', `Leave at least ${TROFAST_EDGE_MARGIN} mm of panel around the TROFAST rim.`)
  const box = getTrofastInsertObb(panel, insert)!
  // OBB axes preserve correct checks for arbitrarily yawed horizontal panels.
  const extentY = Math.abs(box.rotation.elements[1]) * box.halfSize.x + Math.abs(box.rotation.elements[4]) * box.halfSize.y + Math.abs(box.rotation.elements[7]) * box.halfSize.z
  if (context.world && box.center.y - extentY < -EPSILON) add('floor', 'There is not enough space below this panel: the TROFAST box would reach below the floor.')
  for (const other of context.panels) {
    if (other.id !== panel.id && box.intersectsOBB(panelObb(other), 1e-8)) add(`panel-${other.id}`, `The TROFAST box needs more clearance from ${other.name}.`)
    for (const existing of other.trofastInserts ?? []) {
      if (other.id === panel.id && existing.id === insert.id) continue
      const occupied = getTrofastInsertObb(other, existing)
      if (occupied && box.intersectsOBB(occupied, 1e-8)) add(`insert-${other.id}-${existing.id}`, 'This TROFAST box overlaps another storage insert.')
    }
  }
  if (context.hardware.some(hardware => box.intersectsOBB(hardware, 1e-8))) add('hardware', 'Move the TROFAST box clear of the PlayWood connectors.')
  return issues
}

export function getTrofastPlacementIssue(project: Project, panelId: string, insert: TrofastInsert): string {
  const panels = resolvePanels(project), panel = panels.find(item => item.id === panelId)
  if (!panel) return 'Choose an existing panel.'
  return placementIssues(panel, insert, { panels, hardware: connectorObbs(project, panels), world: true })[0]?.message ?? ''
}

/** Source definitions can skip world orientation/floor checks; rebuilt instances cannot. */
export function validateTrofastInserts(project: Project, panels?: Panel[], world = true): ValidationIssue[] {
  // Attachment resolution changes poses, never insert membership. Avoid resolving
  // an entire graph when there is no insert to validate.
  if (!(panels ?? project.panels).some(panel => panel.trofastInserts?.length)) return []
  panels ??= resolvePanels(project)
  const context = { panels, hardware: connectorObbs(project, panels), world }
  return panels.flatMap(panel => {
    const inserts = panel.trofastInserts ?? []
    const issues: ValidationIssue[] = inserts.flatMap(insert => placementIssues(panel, insert, context).map(issue => ({
      id: `trofast-${panel.id}-${insert.id}-${issue.key}`, severity: 'error' as const, message: `${panel.name}: ${issue.message}`, panelIds: [panel.id],
    })))
    if (inserts.length > MAX_TROFAST_INSERTS) issues.push({ id: `trofast-${panel.id}-count`, severity: 'error', message: `A panel supports up to ${MAX_TROFAST_INSERTS} TROFAST inserts.`, panelIds: [panel.id] })
    if (new Set(inserts.map(insert => insert.id)).size !== inserts.length) issues.push({ id: `trofast-${panel.id}-ids`, severity: 'error', message: 'TROFAST insert IDs must be unique within a panel.', panelIds: [panel.id] })
    return issues
  })
}

export function assertNoNewTrofastIssues(previous: Project, next: Project): Project {
  const before = new Set(validateTrofastInserts(previous).map(issue => issue.id))
  const issue = validateTrofastInserts(next).find(issue => !before.has(issue.id))
  if (issue) throw new Error(issue.message)
  return next
}

export function findTrofastPlacement(project: Project, panelId: string, itemId: string, ignoreInsertId?: string): TrofastInsert | null {
  const panels = resolvePanels(project), panel = panels.find(item => item.id === panelId), item = getTrofastItem(itemId)
  if (!panel || !item || getTrofastPanelReason(panel)) return null
  if ((panel.trofastInserts ?? []).filter(insert => insert.id !== ignoreInsertId).length >= MAX_TROFAST_INSERTS) return null
  if (panel.position[1] + panel.thickness / 2 + item.rimHeight - item.height < -EPSILON) return null
  const id = ignoreInsertId ?? uid(), context = { panels, hardware: connectorObbs(project, panels), world: true }
  const inverse = quaternion(panel).invert(), origin = new Vector3(...panel.position)
  const obstacles = [
    ...panels.filter(other => other.id !== panelId).map(panelObb),
    ...panels.flatMap(other => (other.trofastInserts ?? []).filter(insert => other.id !== panelId || insert.id !== id).flatMap(insert => {
      const box = getTrofastInsertObb(other, insert)
      return box ? [box] : []
    })),
    ...context.hardware,
  ].map(box => {
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const corner = new Vector3(x, y, z).multiply(box.halfSize).applyMatrix3(box.rotation).add(box.center).sub(origin).applyQuaternion(inverse)
      min.min(corner); max.max(corner)
    }
    return { min, max }
  })
  for (const quarterTurn of [false, true]) {
    const bounds = getTrofastPositionBounds(panel, item, quarterTurn)
    if (!bounds) continue
    const halfWidth = (quarterTurn ? item.depth : item.width) / 2, halfHeight = (quarterTurn ? item.width : item.depth) / 2
    const envelope = getTrofastInsertLocalBounds(panel, { id, itemId, colorId: item.colors[0], x: panel.width / 2, y: panel.height / 2, quarterTurn, face: getTrofastFace(panel) })!
    const nearby = obstacles.filter(box => box.min.z <= envelope.max[2] && box.max.z >= envelope.min[2])
    // Obstacle edges find narrow off-grid slots. The bounded search is an initial
    // suggestion, never proof of impossibility; users can enter exact offsets.
    const xs = [...new Set([panel.width / 2, ...Array.from({ length: 9 }, (_, i) => bounds.minX + (bounds.maxX - bounds.minX) * i / 8),
      ...nearby.flatMap(box => [panel.width / 2 + box.min.x - halfWidth - 0.1, panel.width / 2 + box.max.x + halfWidth + 0.1])])]
      .filter(x => x >= bounds.minX && x <= bounds.maxX).sort((a, b) => Math.abs(a - panel.width / 2) - Math.abs(b - panel.width / 2))
    const ys = [...new Set([panel.height / 2, ...Array.from({ length: 9 }, (_, i) => bounds.minY + (bounds.maxY - bounds.minY) * i / 8),
      ...nearby.flatMap(box => [panel.height / 2 - box.max.y - halfHeight - 0.1, panel.height / 2 - box.min.y + halfHeight + 0.1])])]
      .filter(y => y >= bounds.minY && y <= bounds.maxY).sort((a, b) => Math.abs(a - panel.height / 2) - Math.abs(b - panel.height / 2))
    let checked = 0
    for (const y of ys) for (const x of xs) {
      if (++checked > 2048) break
      const insert: TrofastInsert = { id, itemId, colorId: item.colors[0], x, y, quarterTurn, face: getTrofastFace(panel) }
      if (!placementIssues(panel, insert, context).length) return insert
    }
  }
  return null
}

function setPanelInserts(project: Project, panelId: string, inserts: TrofastInsert[]): Project {
  if (!project.panels.some(panel => panel.id === panelId)) throw new Error('Choose an existing panel.')
  if (project.assemblies?.instances.some(instance => Object.values(instance.panelIds).includes(panelId))) throw new Error('Edit TROFAST inserts in the shared assembly design, or disassemble the instance first.')
  if (inserts.length > MAX_TROFAST_INSERTS) throw new Error(`A panel supports up to ${MAX_TROFAST_INSERTS} TROFAST inserts.`)
  return assertNoNewTrofastIssues(project, { ...project, panels: project.panels.map(panel => panel.id === panelId ? { ...panel, trofastInserts: inserts.map(insert => ({ ...insert })) } : panel) })
}

export function addTrofastInsert(project: Project, panelId: string, insert: TrofastInsert): Project {
  const existing = project.panels.find(panel => panel.id === panelId)?.trofastInserts ?? []
  if (existing.some(item => item.id === insert.id)) throw new Error('TROFAST insert IDs must be unique within a panel.')
  return setPanelInserts(project, panelId, [...existing, insert])
}

export function updateTrofastInsert(project: Project, panelId: string, insertId: string, patch: Partial<Omit<TrofastInsert, 'id'>>): Project {
  const existing = project.panels.find(panel => panel.id === panelId)?.trofastInserts ?? []
  if (!existing.some(item => item.id === insertId)) throw new Error('Choose an existing TROFAST insert.')
  return setPanelInserts(project, panelId, existing.map(insert => insert.id === insertId ? { ...insert, ...patch } : insert))
}

export function removeTrofastInsert(project: Project, panelId: string, insertId: string): Project {
  return setPanelInserts(project, panelId, (project.panels.find(panel => panel.id === panelId)?.trofastInserts ?? []).filter(insert => insert.id !== insertId))
}
