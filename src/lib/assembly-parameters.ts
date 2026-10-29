import { getProjectBounds, resolvePanels, validateProject } from './model'
import { resizePanelDimensions } from './structure-edit'
import type { AssemblyDefinition, AssemblyParameter, AssemblyParameterBinding, Panel, Project, Vec3 } from './types'

const dimensionLimits = (dimension: AssemblyParameterBinding['dimension']): [number, number] => dimension === 'thickness' ? [3, 100] : [40, 4000]
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const validValue = (value: unknown): value is number => finite(value) && value >= 0.01 && value <= 10000
const targetKey = (binding: AssemblyParameterBinding) => JSON.stringify([binding.panelId, binding.dimension])

/** Bounds for a control after applying all its scale/offset relationships. */
export function getAssemblyParameterRange(parameter: AssemblyParameter): { min: number; max: number } {
  let min = 0.01, max = 10000
  for (const binding of parameter.bindings) {
    const [lower, upper] = dimensionLimits(binding.dimension)
    min = Math.max(min, (lower - binding.offset) / binding.scale)
    max = Math.min(max, (upper - binding.offset) / binding.scale)
  }
  return { min, max }
}

/** Validate and clone metadata so authoring drafts cannot mutate saved sources. */
export function parseAssemblyParameters(value: unknown, panels: readonly Panel[]): AssemblyParameter[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('An assembly supports up to 100 configurable values.')
  const ids = new Set<string>(), names = new Set<string>(), targets = new Set<string>()
  return value.map(raw => {
    if (!record(raw) || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 200 || ids.has(raw.id)) throw new Error('Configurable value identifiers must be unique.')
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 80 || names.has(raw.name.trim().toLowerCase())) throw new Error('Give each configurable value a unique name (up to 80 characters).')
    if (!validValue(raw.defaultValue)) throw new Error('Configurable values must be finite numbers between 0.01 and 10,000 mm.')
    if (!Array.isArray(raw.bindings) || !raw.bindings.length || raw.bindings.length > panels.length * 3) throw new Error('Choose at least one panel dimension for each configurable value.')
    ids.add(raw.id); names.add(raw.name.trim().toLowerCase())
    const bindings = raw.bindings.map((binding): AssemblyParameterBinding => {
      if (!record(binding) || typeof binding.panelId !== 'string' || !panels.some(panel => panel.id === binding.panelId)
        || !['width', 'height', 'thickness'].includes(binding.dimension as string)) throw new Error('A configurable value refers to a missing panel dimension.')
      if (!finite(binding.scale) || binding.scale <= 0 || binding.scale > 1000 || !finite(binding.offset) || Math.abs(binding.offset) > 100000) throw new Error('Dimension relationships need a positive scale and a finite offset.')
      const result = { panelId: binding.panelId, dimension: binding.dimension as AssemblyParameterBinding['dimension'], scale: binding.scale, offset: binding.offset }
      if (targets.has(targetKey(result))) throw new Error('Each panel dimension can be controlled by only one configurable value.')
      targets.add(targetKey(result))
      return result
    })
    const parameter = { id: raw.id, name: raw.name.trim(), defaultValue: raw.defaultValue, bindings }
    const { min, max } = getAssemblyParameterRange(parameter)
    if (parameter.defaultValue < min - 1e-8 || parameter.defaultValue > max + 1e-8) throw new Error(`${parameter.name}: the default makes a panel dimension exceed its limits.`)
    return parameter
  })
}

export function parseAssemblyParameterValues(value: unknown, parameters: readonly AssemblyParameter[]): Record<string, number> {
  if (!record(value)) throw new Error('Invalid assembly configurable values.')
  return Object.fromEntries(Object.entries(value).map(([id, amount]) => {
    const parameter = parameters.find(item => item.id === id)
    if (!parameter) throw new Error('An instance value refers to a missing configurable value.')
    const { min, max } = getAssemblyParameterRange(parameter)
    if (!validValue(amount) || amount < min - 1e-8 || amount > max + 1e-8) throw new Error(`${parameter.name}: choose a value between ${Math.ceil(min * 100) / 100} and ${Math.floor(max * 100) / 100} mm.`)
    return [id, amount]
  }))
}

const cache = new WeakMap<AssemblyDefinition, Map<string, AssemblyDefinition>>()

/** Resolve source-local geometry once for each configuration, keeping its floor. */
export function evaluateAssemblyDefinition(definition: AssemblyDefinition, values?: Record<string, number>): AssemblyDefinition {
  if (!definition.parameters?.length && !Object.keys(values ?? {}).length) return definition
  const parameters = definition.parameters ?? []
  const checked = parseAssemblyParameterValues(values ?? {}, parameters)
  const amountFor = (parameter: AssemblyParameter) => Object.hasOwn(checked, parameter.id) ? checked[parameter.id] : parameter.defaultValue
  const key = JSON.stringify(parameters.map(amountFor))
  const cached = cache.get(definition)?.get(key)
  if (cached) return cached
  const source: Project = { version: 1, name: definition.name, panels: resolvePanels({ version: 1, name: definition.name, panels: definition.panels, connections: definition.connections }), connections: definition.connections }
  const patches: Record<string, Partial<Pick<Panel, 'width' | 'height'>>> = Object.create(null)
  const thickness = new Map<string, number>()
  for (const parameter of parameters) {
    const value = amountFor(parameter)
    for (const binding of parameter.bindings) {
      const amount = value * binding.scale + binding.offset
      const [min, max] = dimensionLimits(binding.dimension)
      if (!Number.isFinite(amount) || amount < min - 1e-8 || amount > max + 1e-8) throw new Error(`${parameter.name}: the resulting ${binding.dimension} exceeds panel limits.`)
      const exact = Math.max(min, Math.min(max, amount))
      if (binding.dimension === 'thickness') thickness.set(binding.panelId, exact)
      else (patches[binding.panelId] ??= {})[binding.dimension] = exact
    }
  }
  let edited = resizePanelDimensions(source, patches)
  edited = { ...edited, panels: edited.panels.map(panel => thickness.has(panel.id) ? { ...panel, thickness: thickness.get(panel.id)! } : panel) }
  const before = getProjectBounds(source.panels), after = getProjectBounds(edited.panels)
  const shift: Vec3 = [(before.min[0] + before.max[0] - after.min[0] - after.max[0]) / 2,
    before.min[1] - after.min[1], (before.min[2] + before.max[2] - after.min[2] - after.max[2]) / 2]
  edited = { ...edited, panels: edited.panels.map(panel => ({ ...panel, position: panel.position.map((amount, axis) => amount + shift[axis]) as Vec3 })) }
  const issue = validateProject(edited).find(item => item.severity === 'error' || item.id.startsWith('collision-'))
  if (issue) throw new Error(`These values cannot keep the assembly connected: ${issue.message}`)
  const result = { ...definition, panels: edited.panels, connections: edited.connections }
  let entries = cache.get(definition)
  if (!entries) { entries = new Map(); cache.set(definition, entries) }
  // Attachment previews can explore many values over a long editing session.
  if (entries.size >= 100) entries.clear()
  entries.set(key, result)
  return result
}
