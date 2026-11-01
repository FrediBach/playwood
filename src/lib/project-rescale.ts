import { getProjectBounds, moveProject, parseProject, resolvePanels, validateProject } from './model'
import { resizePanelDimensions } from './structure-edit'
import { rescaleAssemblies } from './assembly-rescale'
import { getAssemblyParameterRange } from './assembly-parameters'
import type { AssemblyParameter, Panel, Project, Vec3 } from './types'

export type RescaleValueKind = 'dimension' | 'thickness' | 'cornerRadius' | 'holeSize' | 'holeSpacing'
export interface RescaleValue {
  id: string
  kind: RescaleValueKind
  label: string
  value: number
  /** Number of matching measurements, including both axes of square panels. */
  count: number
  min: number
  max: number
  step: number
}

const EPSILON = 1e-6
const kinds: RescaleValueKind[] = ['dimension', 'thickness', 'cornerRadius', 'holeSize', 'holeSpacing']
const settings: Record<RescaleValueKind, { label: string; min: number; max: number; step: number }> = {
  dimension: { label: 'Panel dimension', min: 40, max: 4000, step: 1 },
  thickness: { label: 'Panel thickness', min: 3, max: 100, step: 0.1 },
  cornerRadius: { label: 'Corner radius', min: 0, max: 2000, step: 1 },
  holeSize: { label: 'Hole diameter', min: 2, max: 200, step: 1 },
  holeSpacing: { label: 'Hole spacing', min: 15, max: 500, step: 1 },
}
const rounded = (value: number) => Math.round(value * 1e6) / 1e6
const key = (kind: RescaleValueKind, value: number) => `${kind}:${rounded(value)}`

function measurements(panel: Panel): { kind: RescaleValueKind; field: 'width' | 'height' | 'thickness' | 'cornerRadius' | 'holeSize' | 'holeSpacing'; value: number }[] {
  return [
    { kind: 'dimension' as const, field: 'width' as const, value: panel.width },
    { kind: 'dimension' as const, field: 'height' as const, value: panel.height },
    { kind: 'thickness' as const, field: 'thickness' as const, value: panel.thickness },
    ...((panel.cornerRadius ?? 0) > 0 ? [{ kind: 'cornerRadius' as const, field: 'cornerRadius' as const, value: panel.cornerRadius! }] : []),
    ...(panel.pattern !== 'solid' ? [
      { kind: 'holeSize' as const, field: 'holeSize' as const, value: panel.holeSize },
      { kind: 'holeSpacing' as const, field: 'holeSpacing' as const, value: panel.holeSpacing },
    ] : []),
  ]
}

/** Repeated physical measurements; materials, coordinates and hardware are not scale factors. */
export function getRescaleValues(project: Project): RescaleValue[] {
  const groups = new Map<string, RescaleValue>()
  const thicknessLimits = new Map<string, { min: number; max: number }>()
  const controlledLimits = new Map<string, { min: number; max: number }>()
  for (const connection of project.connections) for (const id of [connection.parentId, connection.childId]) {
    const min = connection.type === 't' || connection.type === 'cross' ? 18 : 16
    thicknessLimits.set(id, { min: Math.max(min, thicknessLimits.get(id)?.min ?? 3), max: 19 })
  }
  for (const instance of project.assemblies?.instances ?? []) {
    const definition = project.assemblies!.definitions.find(item => item.id === instance.definitionId)
    for (const parameter of definition?.parameters ?? []) {
      const range = getAssemblyParameterRange(parameter)
      for (const binding of parameter.bindings) if (binding.dimension === 'thickness') {
        const limits = thicknessLimits.get(instance.panelIds[binding.panelId])
        if (limits) {
          range.min = Math.max(range.min, (limits.min - binding.offset) / binding.scale)
          range.max = Math.min(range.max, (limits.max - binding.offset) / binding.scale)
        }
      }
      for (const binding of parameter.bindings) controlledLimits.set(JSON.stringify([instance.panelIds[binding.panelId], binding.dimension]), {
        min: range.min * binding.scale + binding.offset, max: range.max * binding.scale + binding.offset,
      })
    }
  }
  for (const panel of project.panels) for (const { kind, field, value } of measurements(panel)) {
    const id = key(kind, value)
    let group = groups.get(id)
    if (!group) {
      group = { id, kind, value: rounded(value), count: 0, ...settings[kind] }
      groups.set(id, group)
    }
    group.count++
    const controlled = controlledLimits.get(JSON.stringify([panel.id, field]))
    if (controlled) { group.min = Math.max(group.min, controlled.min); group.max = Math.min(group.max, controlled.max) }
    if (kind === 'thickness') {
      const limits = thicknessLimits.get(panel.id)
      if (limits) { group.min = Math.max(group.min, limits.min); group.max = Math.min(group.max, limits.max) }
    }
    if (kind === 'cornerRadius') group.max = Math.min(group.max, panel.width / 2, panel.height / 2)
  }
  return [...groups.values()].filter(group => group.count > 1)
    .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.value - b.value)
}

/**
 * Apply all replacements against the original measurements in one solve. This
 * lets dependent cuts and inserts adapt without sequential replacement cascades.
 * No saved objects are modified until the complete result has passed validation.
 */
export function rescaleProject(project: Project, changes: Record<string, number>): Project {
  const values = new Map(getRescaleValues(project).map(value => [value.id, value]))
  const replacements = new Map<string, number>()
  for (const [id, amount] of Object.entries(changes)) {
    const value = values.get(id)
    if (!value) throw new Error('A repeated value is no longer available. Close and reopen Rescale creation.')
    if (!Number.isFinite(amount) || amount < value.min || amount > value.max) {
      throw new Error(`${value.label}: enter a value between ${value.min} and ${value.max} mm.`)
    }
    if (Math.abs(amount - value.value) > EPSILON) replacements.set(id, amount)
  }
  if (!replacements.size) return project

  const resize = (source: Project, parameters: readonly AssemblyParameter[] = [], trofastWorld = true): Project => {
    const dimensions: Record<string, Partial<Pick<Panel, 'width' | 'height' | 'thickness'>>> = Object.create(null)
    const details = new Map<string, Partial<Panel>>()
    for (const panel of source.panels) for (const { kind, field, value } of measurements(panel)) {
      const target = replacements.get(key(kind, value))
      if (target === undefined) continue
      if (field === 'width' || field === 'height' || field === 'thickness') (dimensions[panel.id] ??= {})[field] = target
      else details.set(panel.id, { ...details.get(panel.id), [field]: target })
    }
    // A repeated cut may drive other, unique cuts through an assembly control.
    // Infer the control from explicit replacements, then constrain every bound
    // dimension in the same solve, respecting its scale and fixed allowance.
    for (const parameter of parameters) {
      let requested: number | undefined
      for (const binding of parameter.bindings) {
        const target = dimensions[binding.panelId]?.[binding.dimension]
        if (target === undefined) continue
        const amount = (target - binding.offset) / binding.scale
        if (requested !== undefined && Math.abs(amount - requested) > EPSILON) {
          throw new Error(`These values conflict with the editable value “${parameter.name}”. Adjust its related measurements together.`)
        }
        requested = amount
      }
      const amount = requested ?? parameter.defaultValue
      for (const binding of parameter.bindings) {
        (dimensions[binding.panelId] ??= {})[binding.dimension] = amount * binding.scale + binding.offset
      }
    }
    // Validate the whole draft together: increasing hole spacing can make a
    // larger perforated panel valid, and smaller radii can preserve its clamps.
    const prepared = details.size ? { ...source, panels: source.panels.map(panel => details.has(panel.id) ? { ...panel, ...details.get(panel.id) } : panel) } : source
    return resizePanelDimensions(prepared, dimensions, { trofastWorld })
  }

  let next: Project
  try {
    next = project.assemblies?.instances.length ? rescaleAssemblies(project, resize) : resize(project)
  } catch (error) {
    // The same solver powers directional panel moves. Keep its specific joint
    // errors, but make its general advice relevant to this project-wide edit.
    const message = error instanceof Error ? [
      ['These panels cannot move in that direction', 'These values conflict with the existing connections or fitted inserts. Adjust related measurements together to keep the creation connected.'],
      ['This move would exceed the panel size limits', 'Rescaling would make a connected panel smaller than 40 mm or larger than 4,000 mm. Try values closer to the original measurements.'],
      ['This move would exceed the project placement limits', 'Rescaling would exceed the project placement limits. Try values closer to the original measurements.'],
      ['This move would leave an insert unsupported', 'Rescaling would leave an insert unsupported. Try values closer to the original measurements or adjust its supporting dimensions together.'],
    ].find(([prefix]) => error.message.startsWith(prefix))?.[1] : undefined
    if (message) throw new Error(message, { cause: error })
    throw error
  }
  const before = getProjectBounds(resolvePanels(project)), after = getProjectBounds(resolvePanels(next))
  const shift: Vec3 = [(before.min[0] + before.max[0] - after.min[0] - after.max[0]) / 2,
    before.min[1] - after.min[1], (before.min[2] + before.max[2] - after.min[2] - after.max[2]) / 2]
  if (shift.some(value => Math.abs(value) > EPSILON)) next = moveProject(next, shift)
  const previousIssues = new Set(validateProject(project).map(issue => issue.id))
  const issue = validateProject(next).find(item => !previousIssues.has(item.id)
    && (item.severity === 'error' || item.id.startsWith('collision-')))
  if (issue) throw new Error(`These values cannot keep the creation connected: ${issue.message}`)
  parseProject(next)
  return next
}
