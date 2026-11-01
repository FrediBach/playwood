import { COLORS, MATERIALS } from './materials'
import type { PaletteColor, Panel, Project } from './types'

/** Limit explicit additions; adopting colors from existing projects is unrestricted. */
export const MAX_CUSTOM_COLORS = 100
const MAX_COLOR_NAME_LENGTH = 60
const stockOptions = [...COLORS, ...MATERIALS.map(({ name, color }) => ({ name, color })),
  { name: 'Birch', color: '#d9bd8c' }, { name: 'Oak', color: '#b88b54' },
  { name: 'Walnut', color: '#76523b' }, { name: 'MDF', color: '#ae9677' },
  { name: 'Warm white', color: '#e8e7df' },
]
const STOCK_COLORS: PaletteColor[] = stockOptions.filter((option, index) => stockOptions.findIndex(item => item.color === option.color) === index)
  .map(option => ({ id: `stock:${option.color}`, ...option }))

function hexColor(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Colors must be six-digit hex values.')
  return value.toLowerCase()
}

function colorName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_COLOR_NAME_LENGTH) throw new Error(`Color names must contain 1–${MAX_COLOR_NAME_LENGTH} characters.`)
  return value.trim()
}

function adoptedColor(color: string, ids: Set<string>): PaletteColor {
  let id = `custom:${color}`
  for (let suffix = 2; ids.has(id); suffix++) id = `custom:${color}:${suffix}`
  ids.add(id)
  return { id, name: `Custom ${color}`, color }
}

export function getProjectPalette(project: Pick<Project, 'customColors'>): PaletteColor[] {
  return [...STOCK_COLORS, ...project.customColors ?? []]
}

export function parseCustomColors(value: unknown): PaletteColor[] {
  if (!Array.isArray(value)) throw new Error('Invalid custom colors: expected a list of colors.')
  const ids = new Set(STOCK_COLORS.map(option => option.id))
  const colors = new Set(STOCK_COLORS.map(option => option.color))
  // Earlier project files stored unnamed hex swatches. Keep their first order.
  if (value.every(item => typeof item === 'string')) return value.flatMap(item => {
    const color = hexColor(item)
    if (colors.has(color)) return []
    colors.add(color)
    return [adoptedColor(color, ids)]
  })
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid custom color.')
    const raw = item as Record<string, unknown>
    if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 120 || raw.id.startsWith('stock:') || ids.has(raw.id)) throw new Error('Custom color IDs must be unique and valid.')
    const color = hexColor(raw.color)
    if (colors.has(color)) throw new Error('This color is already in the palette.')
    const name = colorName(raw.name)
    ids.add(raw.id)
    colors.add(color)
    return { id: raw.id, name, color }
  })
}

export function getColorUsage(project: Project, value: string) {
  const color = value.toLowerCase()
  const matches = (panel: Panel) => panel.color.toLowerCase() === color
  const panelCount = project.panels.filter(matches).length
  const definitionPanelCount = project.assemblies?.definitions.reduce((sum, definition) => sum + definition.panels.filter(matches).length, 0) ?? 0
  const instanceCount = project.assemblies?.instances.filter(instance => instance.finish?.color?.toLowerCase() === color).length ?? 0
  return { panelCount, definitionPanelCount, instanceCount, inUse: panelCount + definitionPanelCount + instanceCount > 0 }
}

/** Include old and imported panel finishes without changing their appearance. */
export function ensureProjectPalette(project: Project): Project {
  const palette = getProjectPalette(project)
  const colors = new Set(palette.map(option => option.color.toLowerCase()))
  const ids = new Set(palette.map(option => option.id))
  const missing: PaletteColor[] = []
  const include = (value: string) => {
    const color = hexColor(value)
    if (colors.has(color)) return
    colors.add(color)
    missing.push(adoptedColor(color, ids))
  }
  project.panels.forEach(panel => include(panel.color))
  project.assemblies?.definitions.forEach(definition => definition.panels.forEach(panel => include(panel.color)))
  project.assemblies?.instances.forEach(instance => { if (instance.finish?.color) include(instance.finish.color) })
  return missing.length ? { ...project, customColors: [...project.customColors ?? [], ...missing] } : project
}

function availableColor(project: Project, value: string, exceptId?: string): string {
  const color = hexColor(value)
  if (getProjectPalette(project).some(option => option.id !== exceptId && option.color.toLowerCase() === color)) throw new Error('This color is already in the palette.')
  return color
}

export function addCustomColor(project: Project, value: Pick<PaletteColor, 'name' | 'color'>): Project {
  const name = colorName(value.name), color = availableColor(project, value.color)
  if ((project.customColors?.length ?? 0) >= MAX_CUSTOM_COLORS) throw new Error(`Projects support up to ${MAX_CUSTOM_COLORS} custom colors. Edit or remove an existing color first.`)
  const entry = { id: crypto.randomUUID(), name, color }
  return { ...project, customColors: [...project.customColors ?? [], entry] }
}

function replaceColor(project: Project, previous: string, color: string): Project {
  const matches = (value: string) => value.toLowerCase() === previous.toLowerCase()
  const replacePanel = (panel: Panel) => matches(panel.color) ? { ...panel, color } : panel
  return { ...project,
    panels: project.panels.map(replacePanel),
    ...(project.assemblies ? { assemblies: { ...project.assemblies,
      definitions: project.assemblies.definitions.map(definition => ({ ...definition, panels: definition.panels.map(replacePanel) })),
      instances: project.assemblies.instances.map(instance => instance.finish?.color && matches(instance.finish.color)
        ? { ...instance, finish: { ...instance.finish, color } } : instance),
    } } : {}),
  }
}

export function updateCustomColor(project: Project, id: string, patch: Partial<Pick<PaletteColor, 'name' | 'color'>>): Project {
  const previous = project.customColors?.find(option => option.id === id)
  if (!previous) throw new Error('Choose a custom color to edit.')
  const name = patch.name === undefined ? previous.name : colorName(patch.name)
  const color = patch.color === undefined ? previous.color : availableColor(project, patch.color, id)
  if (name === previous.name && color === previous.color) return project
  const next = color === previous.color ? project : replaceColor(project, previous.color, color)
  return { ...next, customColors: project.customColors!.map(option => option.id === id ? { ...option, name, color } : option) }
}

export function removeCustomColor(project: Project, id: string, replacementColor?: string): Project {
  const previous = project.customColors?.find(option => option.id === id)
  if (!previous) throw new Error('Choose a custom color to remove.')
  const used = getColorUsage(project, previous.color).inUse
  let next = project
  if (used) {
    if (replacementColor === undefined) throw new Error('Choose a replacement for this color before removing it.')
    const color = hexColor(replacementColor)
    if (!getProjectPalette(project).some(option => option.id !== id && option.color.toLowerCase() === color)) throw new Error('Choose a replacement color from the remaining palette.')
    next = replaceColor(project, previous.color, color)
  }
  return { ...next, customColors: project.customColors!.filter(option => option.id !== id) }
}
