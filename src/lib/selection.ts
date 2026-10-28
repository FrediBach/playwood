import { resolvePanels } from './model'
import type { Connection, Panel, Project, Vec3 } from './types'

/** Ignore the floating-point noise introduced when resolving attached panels. */
export function panelValuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-7
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => panelValuesEqual(value, b[index]))
  }
  return a === b
}

export function getSharedPanelFields(panels: Panel[]): Set<keyof Panel> {
  if (!panels.length) return new Set()
  const first = panels[0]
  return new Set((Object.keys(first) as (keyof Panel)[]).filter(key => {
    if (key === 'id' && panels.length > 1) return false
    return panels.every(panel => key === 'color'
      ? panel.color.toLowerCase() === first.color.toLowerCase()
      : panelValuesEqual(panel[key], first[key]))
  }))
}

const scalarFields = ['name', 'width', 'height', 'thickness', 'material', 'color', 'pattern', 'visible', 'holeSize', 'holeSpacing'] as const

/**
 * Apply one bulk edit, preserving mixed fields even if a control includes a
 * dependent default (for example, a material's default finish color).
 * Attached positions belong to their connections and cannot be overwritten.
 */
export function updateSelectedPanels(project: Project, ids: string[], patch: Partial<Panel>): Project {
  const wanted = new Set(ids)
  const selected = resolvePanels(project).filter(panel => wanted.has(panel.id))
  if (!selected.length) return project
  const shared = getSharedPanelFields(selected)
  const scalarPatch: Partial<Panel> = {}
  for (const key of scalarFields) {
    if (shared.has(key) && patch[key] !== undefined) {
      Object.assign(scalarPatch, { [key]: patch[key] })
    }
  }
  const freePlacement = !project.connections.some(connection => wanted.has(connection.childId) && connection.role !== 'support')
  const vectorAxes = (['position', 'rotation'] as const).map(key => ({
    key,
    axes: [0, 1, 2].map(axis => freePlacement && Array.isArray(patch[key]) && patch[key]!.length === 3
      && Number.isFinite(patch[key]![axis])
      && selected.every(panel => panelValuesEqual(panel[key][axis], selected[0][key][axis]))),
  }))
  let changed = false
  const panels = project.panels.map(panel => {
    if (!wanted.has(panel.id)) return panel
    const next = { ...panel, ...scalarPatch }
    for (const { key, axes } of vectorAxes) {
      if (axes.some(Boolean)) {
        next[key] = panel[key].map((value, axis) => axes[axis] ? patch[key]![axis] : value) as Vec3
      }
    }
    // Preserve references when a patch is entirely disabled or repeats a value.
    if ((Object.keys(next) as (keyof Panel)[]).every(key => panelValuesEqual(next[key], panel[key]))) return panel
    changed = true
    return next
  })
  return changed ? { ...project, panels } : project
}

/** Plain click replaces; a modifier/checkbox toggles; modified empty clicks keep selection. */
export function selectPanelIds(currentIds: string[], id: string | null, additive = false): string[] {
  if (id === null) return additive ? currentIds : []
  if (!additive) return [id]
  return currentIds.includes(id) ? currentIds.filter(current => current !== id) : [...currentIds, id]
}


export type SharedConnectionPatch = Partial<Pick<Connection, 'side' | 'offset' | 'inset' | 'flip'>>

/** Edit shared connection values without breaking multi-branch hardware groups. */
export function updateSelectedConnections(project: Project, ids: string[], patch: SharedConnectionPatch): Project {
  const wanted = new Set(ids)
  const selected = project.panels.filter(panel => wanted.has(panel.id))
  if (!selected.length) return project
  const driving = selected.map(panel => project.connections.find(connection => connection.childId === panel.id && connection.role !== 'support'))
  if (driving.some(connection => !connection)) return project
  const connections = driving as Connection[]
  const allowed: SharedConnectionPatch = {}
  for (const key of ['side', 'offset', 'inset', 'flip'] as const) {
    if (patch[key] !== undefined && connections.every(connection => panelValuesEqual(connection[key], connections[0][key]))) {
      Object.assign(allowed, { [key]: patch[key] })
    }
  }
  const jointId = (id: string) => id.replace(/:\d+$/, '')
  const groups = new Set(connections.map(connection => jointId(connection.id)))
  let changed = false
  const next = project.connections.map(connection => {
    if (!groups.has(jointId(connection.id)) || (Object.keys(allowed) as (keyof SharedConnectionPatch)[]).every(key => panelValuesEqual(allowed[key], connection[key]))) return connection
    changed = true
    return { ...connection, ...allowed }
  })
  return changed ? { ...project, connections: next } : project
}
