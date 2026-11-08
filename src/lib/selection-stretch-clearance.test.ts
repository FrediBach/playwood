import { describe, expect, it } from 'vitest'
import { Euler, Matrix3, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { installedHardware } from './connector-hardware-test-helpers'
import { gridProject } from './example-geometry'
import { createPanel, validateProject } from './model'
import { moveSelectionStretch, prepareSelectionStretch } from './selection-stretch'
import { stretchPanelSelection, type SelectionStretchEdge } from './structure-edit'
import type { Project } from './types'

describe('selection stretch continuous clearance', () => {
  it('catches hardware passing an obstacle when a corner-radius clamp changes the rail path', () => {
    const source = gridProject('Rounded supports', [350], [300, 300], { depth: 800 })
    const spans = source.panels.filter(panel => ['Upright 1.1', 'Upright 2.1'].includes(panel.name))
    const ids = source.panels.filter(panel => ['Shelf 1.2', 'Shelf 1.3', 'Upright 1.2', 'Upright 2.2'].includes(panel.name)).map(panel => panel.id)
    const obstacle = createPanel({ name: 'Outside obstacle', width: 40, height: 40, thickness: 3, position: [-225, 444, 160], visible: false })
    const project: Project = { ...source, panels: [...source.panels.map(panel => spans.some(span => span.id === panel.id)
      ? { ...panel, cornerRadius: 200 } : panel), obstacle] }
    const edges: SelectionStretchEdge[] = spans.map(panel => ({ panelId: panel.id, dimension: 'width',
      side: new Vector3(1, 0, 0).applyEuler(new Euler(...panel.rotation)).y > 0 ? 1 : -1 }))
    const halfway = stretchPanelSelection(project, ids, edges, [0, 100, 0])
    const endpoint = stretchPanelSelection(project, ids, edges, [0, 200, 0])
    const obstacleBox = new OBB(new Vector3(...obstacle.position), new Vector3(19.5, 19.5, 1), new Matrix3())
    const hitsObstacle = (value: Project) => installedHardware(value).some(piece => piece.boxes.some(box => box.intersectsOBB(obstacleBox)))
    expect(validateProject(project)).toEqual([])
    expect(validateProject(endpoint)).toEqual([])
    expect(hitsObstacle(project)).toBe(false)
    expect(hitsObstacle(endpoint)).toBe(false)
    expect(hitsObstacle(halfway)).toBe(true)
    // The supports grow from 300 to 500 mm; their effective radius stops
    // growing at 400 mm. The T hardware consequently bends its path at +100.
    const plan = prepareSelectionStretch(project, ids).find(item => item.direction[1] > .99999)!
    expect(plan.blocked).toBeUndefined()
    expect(() => moveSelectionStretch(project, ids, plan, 50)).not.toThrow()
    expect(() => moveSelectionStretch(project, ids, plan, 200)).toThrow(/connector hardware/)
  })
})
