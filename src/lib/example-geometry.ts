import { Euler, Quaternion, Vector3 } from 'three'
import { attachPanel, createPanel, getProjectBounds, resolvePanels } from './model'
import type { Connection, Panel, Project, Vec3 } from './types'

const HALF_PI = Math.PI / 2
const seat = 17.5
const uid = () => crypto.randomUUID()
const rotation = (turn: number): Vec3 => {
  const q = new Quaternion().setFromEuler(new Euler(-HALF_PI, 0, 0))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn * HALF_PI))
  const e = new Euler().setFromQuaternion(q)
  return [e.x, e.y, e.z]
}
const samePose = (a: Panel, b: Panel) => new Vector3(...a.position).distanceTo(new Vector3(...b.position)) < 0.01
  && Math.abs(new Quaternion().setFromEuler(new Euler(...a.rotation)).dot(new Quaternion().setFromEuler(new Euler(...b.rotation)))) > 0.99999

export interface GridOptions {
  depth?: number
  color?: string
  connectorColor?: string
  cells?: [number, number][]
  omitShelves?: [number, number][]
  /** Override the depth of an individual structural edge (h:column:row or v:column:row). */
  edgeDepths?: Record<string, number>
}

/** A grid of separate cut panels, with the real 35 mm inline connector clearance. */
export function gridProject(name: string, columns: number[], rows: number[], options: GridOptions = {}): Project {
  const xs = [0], ys = [9]
  columns.forEach(size => xs.push(xs.at(-1)! + size + 2 * seat))
  rows.forEach(size => ys.push(ys.at(-1)! + size + 2 * seat))
  const cells = options.cells ?? columns.flatMap((_, x) => rows.map((_, y): [number, number] => [x, y]))
  type Edge = { key: string; horizontal: boolean; x: number; y: number; a: string; b: string; panel: Panel }
  const edges = new Map<string, Edge>()
  const add = (horizontal: boolean, x: number, y: number) => {
    const key = `${horizontal ? 'h' : 'v'}:${x}:${y}`
    if (edges.has(key)) return
    const length = horizontal ? columns[x] : rows[y]
    const position: Vec3 = [horizontal ? (xs[x] + xs[x + 1]) / 2 : xs[x], horizontal ? ys[y] : (ys[y] + ys[y + 1]) / 2, 0]
    const panel = createPanel({ name: `${horizontal ? 'Shelf' : 'Upright'} ${x + 1}.${y + 1}`, width: length,
      height: options.edgeDepths?.[key] ?? options.depth ?? 350, material: 'painted', color: options.color ?? '#e8e7df', position })
    edges.set(key, { key, horizontal, x, y, a: `${x}:${y}`, b: horizontal ? `${x + 1}:${y}` : `${x}:${y + 1}`, panel })
  }
  for (const [x, y] of cells) { add(true, x, y); add(true, x, y + 1); add(false, x, y); add(false, x + 1, y) }
  for (const [x, y] of options.omitShelves ?? []) edges.delete(`h:${x}:${y}`)
  // Removing an intermediate shelf leaves a single full-height side panel.
  for (let changed = true; changed;) {
    changed = false
    const all = [...edges.values()]
    for (const a of all) {
      const touching = all.filter(edge => edge.a === a.b || edge.b === a.b)
      if (touching.length !== 2) continue
      const b = touching.find(edge => edge !== a)!
      if (b.a !== a.b || b.horizontal !== a.horizontal) continue
      const axis = a.horizontal ? 0 : 1
      const start = a.panel.position[axis] - a.panel.width / 2
      const end = b.panel.position[axis] + b.panel.width / 2
      a.panel.width = end - start
      a.panel.position[axis] = (start + end) / 2
      a.b = b.b
      edges.delete(b.key)
      changed = true
      break
    }
  }
  const list = [...edges.values()]
  const nodes = new Map<string, { edge: number; end: number }[]>()
  list.forEach((edge, index) => {
    for (const [node, end] of [[edge.a, 1], [edge.b, -1]] as const) nodes.set(node, [...nodes.get(node) ?? [], { edge: index, end }])
  })
  // A shared joint has one incoming slot and one, two, or three outgoing slots.
  // Solve panel direction signs once so every support uses exactly the same
  // local orientation as the driving attachment, including closed grid loops.
  const signs = Array<number>(list.length).fill(0)
  const constraints = [...nodes.values()].filter(node => node.length > 1)
  const possible = () => constraints.every(node => {
    if (node.length === 3) {
      const inline = node.filter(item => node.some(other => other !== item && list[other.edge].horizontal === list[item.edge].horizontal))
      const a = signs[inline[0].edge] * inline[0].end, b = signs[inline[1].edge] * inline[1].end
      if (a && b && a === b) return false
    }
    const positive = node.filter(item => signs[item.edge] * item.end > 0).length
    const unknown = node.filter(item => signs[item.edge] === 0).length
    return [1, node.length - 1].some(target => positive <= target && positive + unknown >= target)
  })
  const solve = (index: number): boolean => {
    if (index === list.length) return true
    for (const sign of [1, -1]) { signs[index] = sign; if (possible() && solve(index + 1)) return true }
    signs[index] = 0
    return false
  }
  if (!solve(0)) throw new Error(`Could not orient the ${name} panel grid.`)
  list.forEach((edge, i) => { edge.panel.rotation = rotation(edge.horizontal ? (signs[i] > 0 ? 0 : 2) : (signs[i] > 0 ? 3 : 1)) })
  const connections: Connection[] = []
  for (const node of constraints) {
    const type = node.length === 4 ? 'cross' : node.length === 3 ? 't' : '90'
    let group: Connection[] | undefined
    for (const entry of node) {
      const parent = list[entry.edge].panel
      const rest = node.filter(item => item !== entry).map(item => list[item.edge].panel)
      const side = entry.end * signs[entry.edge] > 0 ? 'left' : 'right'
      for (const flip of [false, true]) {
        const id = uid(), candidates: Connection[] = []
        const remaining = new Set(rest)
        for (let branch = 0; branch < rest.length; branch++) {
          for (const child of remaining) {
            const c: Connection = { id: `${id}:${branch}`, parentId: parent.id, childId: child.id,
              type, side, flip, offset: 0, inset: 0, count: branch === 0 ? 2 : 0, color: options.connectorColor ?? '#e75a35', role: 'support' }
            const expected = resolvePanels({ version: 1, name, panels: [parent, child], connections: [{ ...c, role: undefined }] })[1]
            if (samePose(expected, child)) { candidates.push(c); remaining.delete(child); break }
          }
        }
        if (!remaining.size) { group = candidates; break }
      }
      if (group) break
    }
    if (!group) throw new Error(`Could not connect a joint in ${name}.`)
    connections.push(...group)
  }
  // Use complete joints as driving trees whenever they do not give a panel
  // multiple parents or introduce a cycle; remaining joints provide supports.
  const parents = new Map<string, string>()
  const groups = new Map<string, Connection[]>()
  connections.forEach(c => groups.set(c.id.split(':')[0], [...groups.get(c.id.split(':')[0]) ?? [], c]))
  for (const group of groups.values()) {
    const parentId = group[0].parentId
    const safe = group.every(c => {
      if (parents.has(c.childId)) return false
      let ancestor: string | undefined = parentId
      while (ancestor) { if (ancestor === c.childId) return false; ancestor = parents.get(ancestor) }
      return true
    })
    if (safe) group.forEach(c => { delete c.role; parents.set(c.childId, parentId) })
  }
  const panels = list.map(edge => edge.panel)
  const center = xs.at(-1)! / 2
  panels.forEach(panel => { panel.position[0] -= center })
  return { version: 1, name, panels, connections }
}

/** Return an independent factory result with its lowest panel resting on the floor. */
export function groundProject(project: Project): Project {
  const panels = resolvePanels(project)
  const { min } = getProjectBounds(panels)
  return { ...project, panels: panels.map(panel => ({ ...panel, position: [panel.position[0], panel.position[1] - min[1], panel.position[2]] })) }
}

/** The source H-table's central spine and two split end legs. */
export function hTableProject(name: string, length: number): Project {
  const depth = length === 1200 ? 600 : 800
  const spineHeight = 721, wingHeight = 712.5, wingWidth = (depth - 35) / 2
  const wingOffset = wingWidth / 2 + seat
  const halfSpan = length / 2 + seat
  const wing = (label: string, x: number, z: number, angle: number) => createPanel({ name: label,
    width: wingWidth, height: wingHeight, material: 'painted', position: [x, spineHeight / 2, z], rotation: [0, angle, 0] })
  const left = wing('Left front leg', -halfSpan, -wingOffset, HALF_PI)
  const spine = createPanel({ name: 'Central spine', width: length, height: spineHeight, material: 'painted' })
  const opts = { side: 'left' as const, type: 't' as const, offset: 0, inset: 0, flip: false, color: '#e75a35', count: 2 }
  let project = attachPanel({ version: 1, name, panels: [left], connections: [] }, left.id, spine, opts)
  const leftRearId = project.panels.at(-1)!.id
  project.panels = project.panels.map(p => p.id === leftRearId ? { ...p, name: 'Left rear leg', width: wingWidth, height: wingHeight } : p)
  project.panels = resolvePanels(project)
  const right = wing('Right front leg', halfSpan, -wingOffset, -HALF_PI)
  const rightRear = wing('Right rear leg', halfSpan, wingOffset, -HALF_PI)
  project.panels.push(right, rightRear)
  const id = uid()
  project.connections.push(
    { ...opts, id: `${id}:0`, parentId: right.id, childId: spine.id, side: 'right', role: 'support' },
    { ...opts, id: `${id}:1`, parentId: right.id, childId: rightRear.id, side: 'right', role: 'support', count: 0 },
  )
  const desktop = createPanel({ name: 'Desktop', width: depth, height: length, material: 'painted' })
  project = attachPanel(project, left.id, desktop, { ...opts, type: '90', side: 'top', offset: -wingOffset, count: 1 })
  for (const [parentId, offset, flip] of [[leftRearId, wingOffset, false], [right.id, wingOffset, false], [rightRear.id, -wingOffset, false]] as const) {
    project.connections.push({ ...opts, id: `${uid()}:0`, parentId, childId: desktop.id, type: '90', side: 'top', offset, flip, count: 1, role: 'support' })
  }
  return groundProject(project)
}
