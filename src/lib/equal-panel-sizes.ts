import { getAssemblyInstance } from './assemblies'
import { assertNoNewTrofastIssues } from './trofast'
import { resizePanelDimensions } from './structure-edit'
import type { Panel, Project } from './types'

const dimensions = ['width', 'height', 'thickness'] as const
export function differingPanelDimension(panels: readonly Panel[]) {
  if (panels.length < 2) return null
  const differing = dimensions.filter(field => panels.some(panel => Math.abs(panel[field] - panels[0][field]) > 1e-6))
  return differing.length === 1 ? differing[0] : null
}

export function equalizePanelSizes(project: Project, ids: readonly string[], value: number): Project {
  const panels = [...new Set(ids)].map(id => project.panels.find(panel => panel.id === id))
  if (panels.some(panel => !panel)) throw new Error('A selected panel no longer exists.')
  const selected = panels as Panel[]
  const dimension = differingPanelDimension(selected)
  if (!dimension) throw new Error('Select at least two panels with exactly one differing dimension.')
  if (selected.some(panel => getAssemblyInstance(project, panel.id))) throw new Error('Disassemble these panels before making their sizes equal.')
  const next = resizePanelDimensions(project, Object.fromEntries(selected.map(panel => [panel.id, { [dimension]: value }])))
  if (next.panels.some(panel => ids.includes(panel.id) && Math.abs(panel[dimension] - value) > 1e-6)) throw new Error('These panels cannot reach the same size while preserving their joints.')
  return assertNoNewTrofastIssues(project, next)
}
