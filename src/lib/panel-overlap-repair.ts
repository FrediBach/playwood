import { Euler, Vector3 } from 'three'
import { resolvePanels, validateProject } from './model'
import { movePanels, resizePanelEdge } from './structure-edit'
import { assertNoNewTrofastIssues } from './trofast'
import type { Panel, Project, Vec3 } from './types'

const axes = (panel: Panel) => [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(axis => axis.applyEuler(new Euler(...panel.rotation)))
const extent = (panel: Panel, axis: Vector3) => axes(panel).reduce((sum, own, index) => sum + Math.abs(own.dot(axis)) * [panel.width, panel.height, panel.thickness][index] / 2, 0)

/** Bounded, conservative search through ordinary joint-preserving commands.
 * Every step must remove a collision and introduce no validation diagnostics. */
export function repairPanelOverlaps(source: Project, panelId: string): Project {
  let current = source
  for (let step = 0; step < 8; step++) {
    const issues = validateProject(current)
    const collisions = issues.filter(issue => issue.id.startsWith('collision-') && issue.panelIds.includes(panelId))
    if (!collisions.length) return current
    const known = new Set(issues.map(issue => issue.id))
    const panels = resolvePanels(current)
    const proposals: { candidate: Project; cost: number }[] = []
    for (const issue of collisions.slice(0, 4)) {
      const pair = issue.panelIds.map(id => panels.find(panel => panel.id === id)!)
      for (const moving of pair) {
        const fixed = pair.find(panel => panel.id !== moving.id)!
        axes(moving).forEach((axis, index) => {
          const center = new Vector3(...fixed.position).sub(new Vector3(...moving.position)).dot(axis)
          for (const side of [-1, 1] as const) {
            const distance = extent(moving, axis) + extent(fixed, axis) - side * center + 0.1
            if (distance <= 0) continue
            const operations = [() => movePanels(current, [moving.id], axis.clone().multiplyScalar(-side * distance).toArray() as Vec3)]
            if (index < 2) operations.unshift(() => resizePanelEdge(current, moving.id, index === 0 ? 'width' : 'height', side, -distance, true))
            for (const operation of operations) {
              try {
                const candidate = assertNoNewTrofastIssues(current, operation())
                const remaining = validateProject(candidate)
                if (remaining.some(item => !known.has(item.id)) || remaining.some(item => item.id === issue.id)) continue
                const after = resolvePanels(candidate)
                const cost = after.reduce((sum, panel, i) => sum + new Vector3(...panel.position).distanceTo(new Vector3(...panels[i].position))
                  + Math.abs(panel.width - panels[i].width) + Math.abs(panel.height - panels[i].height), 0)
                proposals.push({ candidate, cost })
              } catch { /* A blocked direction leaves the source untouched. */ }
            }
          }
        })
      }
    }
    proposals.sort((a, b) => a.cost - b.cost)
    if (!proposals.length) break
    current = proposals[0].candidate
  }
  if (validateProject(current).some(issue => issue.id.startsWith('collision-') && issue.panelIds.includes(panelId))) {
    throw new Error('No automatic repair was found that preserves the joints and design rules. Try moving or resizing the overlapping panels manually, or edit their shared assembly design.')
  }
  return current
}
