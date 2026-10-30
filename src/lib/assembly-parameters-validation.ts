import type { AssemblyParameter, Panel } from './types'

export function assemblyParametersError(parameters: AssemblyParameter[], panels: Panel[]): string | undefined {
  const panelsById = new Map(panels.map(panel => [panel.id, panel]))
  const names = new Set<string>(), targets = new Set<string>()
  for (const parameter of parameters) {
    const name = parameter.name.trim()
    if (!name) return 'Give each editable value a name.'
    if (names.has(name.toLowerCase())) return 'Use a different name for each editable value.'
    names.add(name.toLowerCase())
    if (!Number.isFinite(parameter.defaultValue) || parameter.defaultValue < 0.01 || parameter.defaultValue > 10000) return `Enter a default between 0.01 and 10,000 mm for ${name}.`
    if (!parameter.bindings.length) return `Choose at least one panel dimension for ${name}.`
    for (const binding of parameter.bindings) {
      const panel = panelsById.get(binding.panelId)
      if (!panel) return 'A selected panel is no longer available. Remove its editable value and try again.'
      const key = `${binding.panelId}/${binding.dimension}`
      if (targets.has(key)) return 'Each panel dimension can be controlled by only one value.'
      targets.add(key)
      const computed = parameter.defaultValue * binding.scale + binding.offset
      const min = binding.dimension === 'thickness' ? 3 : 40, max = binding.dimension === 'thickness' ? 100 : 4000
      if (!Number.isFinite(binding.scale) || binding.scale <= 0 || !Number.isFinite(binding.offset) || !Number.isFinite(computed) || computed < min || computed > max) {
        return `${panel.name} ${binding.dimension} must be ${min}–${max} mm. Adjust the default or relationship.`
      }
    }
  }
}

