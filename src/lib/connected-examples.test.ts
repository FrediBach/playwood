import { Euler, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { EXAMPLE_LIBRARY } from './example-library'
import { CAD_EXAMPLES } from './cad-examples'
import { PDF_EXAMPLES } from './pdf-examples'
import { getPhysicalConnectors } from './connector-selection'
import { overlappingConnectorIds } from './connector-clearance'
import { validateProject } from './model'

const changed = [...CAD_EXAMPLES, ...PDF_EXAMPLES].filter(example => example.create().panels.some(panel => panel.thickness < 18))
describe('connected library stock', () => {
  it.each(changed)('$name replaces thin accessories with connected stock and keeps its colors', example => {
    const project = EXAMPLE_LIBRARY.find(item => item.id === example.id)!.create()
    expect(project.panels.every(panel => panel.thickness === 18)).toBe(true)
    expect(new Set(project.panels.map(panel => panel.color))).toEqual(new Set(example.create().panels.map(panel => panel.color)))
    for (const face of example.create().panels.filter(panel => example.id !== 'workstation' && panel.thickness < 18 && Math.abs(new Vector3(0, 0, 1).applyEuler(new Euler(...panel.rotation)).z) > .999)) {
      expect(project.panels.some(panel => panel.name.startsWith(face.name.replace(/door/gi, 'fixed front'))), face.name).toBe(true)
    }
    expect(validateProject(project)).toEqual([])
    expect(overlappingConnectorIds(project).size).toBe(0)
    const connected = new Set([project.panels[0].id])
    const installed = getPhysicalConnectors(project)
    expect(installed.length).toBeGreaterThan(0)
    for (let changed = true; changed;) {
      changed = false
      for (const connection of project.connections) {
        if (connected.has(connection.parentId) !== connected.has(connection.childId)) {
          connected.add(connection.parentId); connected.add(connection.childId); changed = true
        }
      }
    }
    expect(connected.size).toBe(project.panels.length)
  })
})
