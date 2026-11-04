import { Euler, Vector3 } from 'three'
import { isPanelConnectedToAssembly } from './assemblies'
import { resolvePanels, validateProject } from './model'
import { movePanelsToPositions } from './structure-edit'
import { assertNoNewTrofastIssues } from './trofast'
import type { Panel, Project, Vec3 } from './types'

/** Equal clear gaps along the common face normal, with both end panels fixed. */
export function panelDistribution(panels: readonly Panel[]) {
  if (panels.length < 3) return undefined
  const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...panels[0].rotation))
  if (panels.some(panel => Math.abs(new Vector3(0, 0, 1).applyEuler(new Euler(...panel.rotation)).dot(normal)) < 1 - 1e-8)) return undefined
  const ordered = panels.map(panel => ({ panel, distance: new Vector3(...panel.position).dot(normal) })).sort((a, b) => a.distance - b.distance)
  const first = ordered[0], last = ordered[ordered.length - 1]
  const innerThickness = ordered.slice(1, -1).reduce((sum, item) => sum + item.panel.thickness, 0)
  const gap = (last.distance - last.panel.thickness / 2 - first.distance - first.panel.thickness / 2 - innerThickness) / (panels.length - 1)
  if (gap < -1e-6) return undefined
  const targets: Record<string, Vec3> = Object.create(null)
  let edge = first.distance + first.panel.thickness / 2
  ordered.forEach(({ panel, distance }, index) => {
    const target = index === 0 || index === ordered.length - 1 ? distance : edge + Math.max(0, gap) + panel.thickness / 2
    targets[panel.id] = new Vector3(...panel.position).addScaledVector(normal, target - distance).toArray() as Vec3
    edge = target + panel.thickness / 2
  })
  return { gap: Math.max(0, gap), targets }
}

export function distributePanels(project: Project, ids: readonly string[]): Project {
  const wanted = new Set(ids)
  const panels = resolvePanels(project).filter(panel => wanted.has(panel.id))
  if (panels.length !== wanted.size) throw new Error('The selection contains a missing panel.')
  const distribution = panelDistribution(panels)
  if (!distribution) throw new Error('Select at least three parallel panels with enough space between the outer panels.')
  if (panels.some(panel => isPanelConnectedToAssembly(project, panel.id))) throw new Error('Disassemble and disconnect linked assemblies before distributing their panels.')
  const next = assertNoNewTrofastIssues(project, movePanelsToPositions(project, distribution.targets))
  const previous = new Set(validateProject(project).map(issue => issue.id))
  const collision = validateProject(next).find(issue => issue.id.startsWith('collision-') && !previous.has(issue.id))
  if (collision) throw new Error(collision.message)
  return next
}
