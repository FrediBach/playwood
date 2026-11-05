import type { ConstructionObject, ConstructionObjects, ObjectBooleanOperation, Project, Vec3 } from './types'

export const MAX_CONSTRUCTION_OBJECTS = 200
export const MAX_CONSTRUCTION_OBJECT_DEPTH = 16
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new Error('Object names and IDs must contain 1–120 characters.')
  return value
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid construction object dimension or transform.')
  return value
}
function vector(value: unknown, rotation = false): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('Invalid construction object transform.')
  return value.map(item => {
    const result = number(item, rotation ? -100 * Math.PI : -100000, rotation ? 100 * Math.PI : 100000)
    if (rotation && Math.abs(result / (Math.PI / 2) - Math.round(result / (Math.PI / 2))) > 1e-8) {
      throw new Error('Construction objects rotate in 90° steps.')
    }
    return result
  }) as Vec3
}
function references(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CONSTRUCTION_OBJECTS) throw new Error('Invalid construction object references.')
  return value.map(text)
}

/** Validate untrusted files without evaluating geometry or accepting a shared/cyclic graph. */
export function parseConstructionObjects(value: unknown): ConstructionObjects {
  if (!record(value) || !Array.isArray(value.nodes) || value.nodes.length > MAX_CONSTRUCTION_OBJECTS) {
    throw new Error(`Construction objects support at most ${MAX_CONSTRUCTION_OBJECTS} nodes.`)
  }
  const roots = references(value.roots)
  const nodes = value.nodes.map((raw): ConstructionObject => {
    if (!record(raw) || typeof raw.visible !== 'boolean') throw new Error('Invalid construction object.')
    const base = { id: text(raw.id), name: text(raw.name), visible: raw.visible }
    if (raw.kind === 'box') return { ...base, kind: 'box', width: number(raw.width, 1, 10000),
      height: number(raw.height, 1, 10000), depth: number(raw.depth, 1, 10000),
      position: vector(raw.position), rotation: vector(raw.rotation, true) }
    if (raw.kind !== 'boolean' || typeof raw.operation !== 'string' || !['union', 'subtract', 'intersect'].includes(raw.operation)) throw new Error('Invalid construction object operation.')
    const children = references(raw.children)
    if (children.length < 2) throw new Error('A Boolean object needs at least two ordered operands.')
    return { ...base, kind: 'boolean', operation: raw.operation as ObjectBooleanOperation, children }
  })
  const byId = new Map(nodes.map(node => [node.id, node]))
  if (byId.size !== nodes.length) throw new Error('Construction object IDs must be unique.')
  const visited = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (depth > MAX_CONSTRUCTION_OBJECT_DEPTH) throw new Error(`Construction object trees support at most ${MAX_CONSTRUCTION_OBJECT_DEPTH} levels.`)
    const node = byId.get(id)
    if (!node) throw new Error('Construction object reference does not exist.')
    if (visited.has(id)) throw new Error('Construction objects cannot have cycles or shared operands.')
    visited.add(id)
    if (node.kind === 'boolean') node.children.forEach(child => visit(child, depth + 1))
  }
  roots.forEach(id => visit(id, 1))
  if (visited.size !== nodes.length) throw new Error('Every construction object must belong to a root tree.')
  return { roots, nodes }
}

const empty = (): ConstructionObjects => ({ roots: [], nodes: [] })
function withObjects(project: Project, objects: ConstructionObjects): Project {
  return { ...project, constructionObjects: parseConstructionObjects(objects) }
}

export function addConstructionBox(project: Project): { project: Project; objectId: string } {
  const objects = project.constructionObjects ?? empty(), objectId = crypto.randomUUID()
  return { objectId, project: withObjects(project, { roots: [...objects.roots, objectId], nodes: [...objects.nodes,
    { id: objectId, name: 'Box', visible: true, kind: 'box', width: 600, height: 600, depth: 400, position: [0, 300, 0], rotation: [0, 0, 0] }] }) }
}

/** Replace one node while retaining its identity and ownership; invalid edits are atomic. */
export function updateConstructionObject(project: Project, node: ConstructionObject): Project {
  const objects = project.constructionObjects
  if (!objects?.nodes.some(item => item.id === node.id)) throw new Error('Construction object no longer exists.')
  return withObjects(project, { ...objects, nodes: objects.nodes.map(item => item.id === node.id ? node : item) })
}

function selectedRoots(objects: ConstructionObjects, ids: readonly string[]): string[] {
  const roots = new Set(objects.roots)
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !roots.has(id))) {
    throw new Error('Select distinct top-level construction objects.')
  }
  return [...ids]
}

/** Operand order is supplied explicitly, never inferred from node storage order. */
export function combineConstructionObjects(project: Project, ids: readonly string[], operation: ObjectBooleanOperation): { project: Project; objectId: string } {
  const objects = project.constructionObjects ?? empty(), children = selectedRoots(objects, ids)
  const objectId = crypto.randomUUID(), selected = new Set(children)
  const roots = objects.roots.filter(id => !selected.has(id))
  roots.splice(objects.roots.findIndex(id => selected.has(id)), 0, objectId)
  return { objectId, project: withObjects(project, { roots, nodes: [...objects.nodes,
    { id: objectId, name: operation, visible: true, kind: 'boolean', operation, children }] }) }
}

/** Clipboard snapshot includes complete root trees; no panel or assembly state. */
export function copyConstructionObjects(project: Project, ids: readonly string[]): ConstructionObjects {
  const objects = project.constructionObjects ?? empty(), roots = selectedRoots(objects, ids)
  const byId = new Map(objects.nodes.map(node => [node.id, node])), included = new Set<string>()
  const visit = (id: string) => {
    included.add(id)
    const node = byId.get(id)!
    if (node.kind === 'boolean') node.children.forEach(visit)
  }
  roots.forEach(visit)
  return parseConstructionObjects({ roots, nodes: objects.nodes.filter(node => included.has(node.id)) })
}

export function removeConstructionObjects(project: Project, ids: readonly string[]): Project {
  const removed = new Set(copyConstructionObjects(project, ids).nodes.map(node => node.id))
  const objects = project.constructionObjects!
  return withObjects(project, { roots: objects.roots.filter(id => !removed.has(id)), nodes: objects.nodes.filter(node => !removed.has(node.id)) })
}

export function pasteConstructionObjects(project: Project, clipboard: ConstructionObjects, offset: Vec3 = [0, 0, 0]): { project: Project; objectIds: string[] } {
  const source = parseConstructionObjects(clipboard), translation = vector(offset)
  const objects = project.constructionObjects ?? empty()
  const ids = new Map(source.nodes.map(node => [node.id, crypto.randomUUID()]))
  const objectIds = source.roots.map(id => ids.get(id)!)
  const nodes = source.nodes.map((node): ConstructionObject => node.kind === 'boolean'
    ? { ...node, id: ids.get(node.id)!, children: node.children.map(id => ids.get(id)!) }
    : { ...node, id: ids.get(node.id)!, position: node.position.map((value, axis) => value + translation[axis]) as Vec3 })
  return { objectIds, project: withObjects(project, { roots: [...objects.roots, ...objectIds], nodes: [...objects.nodes, ...nodes] }) }
}

export function duplicateConstructionObjects(project: Project, ids: readonly string[], offset: Vec3 = [100, 0, 0]) {
  return pasteConstructionObjects(project, copyConstructionObjects(project, ids), offset)
}

/** Ordinary reconstructed edits retain sources. Explicit clearing uses an empty forest. */
export function preserveConstructionObjects(before: Project, candidate: Project): Project {
  return candidate.constructionObjects === undefined && before.constructionObjects !== undefined
    ? { ...candidate, constructionObjects: before.constructionObjects } : candidate
}
