import { EXAMPLE_LIBRARY } from './example-library'
import { LEGACY_INSERT_SHAPES } from './legacy-example-inserts-data'
import { createPanel, resolvePanels } from './model'
import type { Connection, Panel, Project } from './types'

const geometry = (panel: Panel) => [panel.width, panel.height, panel.thickness, ...panel.position, ...panel.rotation]
const sameGeometry = (a: Panel, b: Panel) => geometry(a).every((value, index) => Math.abs(value - geometry(b)[index]) < 0.000001)
const connectionKey = (connection: Connection, names: Map<string, string>) => JSON.stringify([
  names.get(connection.parentId), names.get(connection.childId), connection.type,
  connection.role ?? '', connection.side, connection.offset, connection.inset,
  connection.flip, connection.count, Number(connection.id.match(/:(\d+)$/)?.[1] ?? 0),
])

/**
 * Fit only recognized, geometrically unmodified copies of the original library
 * inserts. Matching by shape and topology preserves renamed/reordered panels,
 * finishes and IDs. Any added, removed, moved or resized piece opts out.
 * The caller places the immutable repair in ordinary undo history.
 */
export function repairLegacyExampleInserts(project: Project): Project {
  const actual = resolvePanels(project)
  for (const [exampleId, shapes] of Object.entries(LEGACY_INSERT_SHAPES)) {
    const definition = EXAMPLE_LIBRARY.find(example => example.id === exampleId)
    if (!definition) continue
    const template = definition.create()
    const current = resolvePanels(template)
    const legacy = [...current.filter(panel => panel.thickness === 18), ...shapes.map(shape => createPanel(shape))]
    if (legacy.length !== actual.length || template.connections.length !== project.connections.length) continue

    const canonicalNames = new Map<string, string>()
    const remaining = new Set(legacy)
    for (const panel of actual) {
      const matches = [...remaining].filter(candidate => sameGeometry(panel, candidate))
      if (matches.length !== 1) break
      canonicalNames.set(panel.id, matches[0].name)
      remaining.delete(matches[0])
    }
    if (remaining.size) continue
    const templateNames = new Map(current.map(panel => [panel.id, panel.name]))
    const expectedConnections = template.connections.map(connection => connectionKey(connection, templateNames)).sort()
    const actualConnections = project.connections.map(connection => connectionKey(connection, canonicalNames)).sort()
    if (actualConnections.some((key, index) => key !== expectedConnections[index])) continue

    const byName = new Map(current.map(panel => [panel.name, panel]))
    const existingNames = new Set(canonicalNames.values())
    const changed = actual.some(panel => {
      const replacement = byName.get(canonicalNames.get(panel.id)!)
      return !replacement || !sameGeometry(panel, replacement)
    }) || current.some(panel => !existingNames.has(panel.name))
    if (!changed) return project

    const panels = project.panels.flatMap(panel => {
      const replacement = byName.get(canonicalNames.get(panel.id)!)
      if (!replacement) return []
      if (panel.thickness === 18) return [panel]
      return [{ ...panel, width: replacement.width, height: replacement.height,
        thickness: replacement.thickness, position: [...replacement.position] as Panel['position'],
        rotation: [...replacement.rotation] as Panel['rotation'] }]
    })
    const oldInsert = project.panels.find(panel => panel.thickness !== 18)
    for (const panel of current) if (!existingNames.has(panel.name)) {
      // New supporting sides use the existing insert's finish when available.
      panels.push(oldInsert ? { ...panel, material: oldInsert.material, color: oldInsert.color, visible: oldInsert.visible,
        ...(oldInsert.finishCoverage === undefined ? {} : { finishCoverage: oldInsert.finishCoverage }) } : panel)
    }
    return { ...project, panels }
  }
  return project
}
