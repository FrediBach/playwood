import { ANGLED_ASSEMBLIES } from './angled-assemblies'
import { createAssembly, instantiateAssembly } from './assemblies'
import { gridProject } from './example-geometry'
import type { ExampleDefinition } from './example-library'
import type { AssemblyParameter, Panel, Project } from './types'

/** Grid panels use their width for the cut span and height for the shared depth. */
function moduleParameters(id: string, panels: Panel[], columns: number[], rows: number[], depth: number): AssemblyParameter[] {
  const bind = (panel: Panel, dimension: 'width' | 'height') => ({ panelId: panel.id, dimension, scale: 1, offset: 0 })
  if (id === 'cube') return [{ id: 'side-length', name: 'Side length', defaultValue: columns[0],
    bindings: panels.flatMap(panel => [bind(panel, 'width'), bind(panel, 'height')]) }]
  return [
    ...columns.map((length, index) => ({ id: columns.length === 1 ? 'width' : `width-${index + 1}`, name: columns.length === 1 ? 'Width' : `Column ${index + 1} width`, defaultValue: length,
      bindings: panels.filter(panel => panel.name.startsWith(`Shelf ${index + 1}.`)).map(panel => bind(panel, 'width')) })),
    ...rows.map((length, index) => ({ id: rows.length === 1 ? 'height' : `height-${index + 1}`, name: rows.length === 1 ? 'Height' : `Row ${index + 1} height`, defaultValue: length,
      bindings: panels.filter(panel => panel.name.startsWith('Upright ') && panel.name.endsWith(`.${index + 1}`)).map(panel => bind(panel, 'width')) })),
    { id: 'depth', name: 'Depth', defaultValue: depth, bindings: panels.map(panel => bind(panel, 'height')) },
  ]
}

function module(id: string, name: string, description: string, category: string, columns: number[], rows: number[], depth = 350, cells?: [number, number][]): ExampleDefinition {
  return { id: `assembly-${id}`, name, description, category, create: () => {
    const project = gridProject(name, columns, rows, { depth, cells })
    return createAssembly(project, project.panels.map(panel => panel.id), name, moduleParameters(id, project.panels, columns, rows, depth))
  } }
}

/** Cut lengths are in millimeters; the grid adds connector clearances. */
export const ASSEMBLY_LIBRARY: readonly ExampleDefinition[] = [
  ...ANGLED_ASSEMBLIES,
  module('cube', 'Cube module', 'A versatile open box for stacking and linking at its corners.', 'Boxes', [350], [350]),
  module('wide-box', 'Wide shelf module', 'A low, wide compartment for books, media, or display.', 'Boxes', [700], [250]),
  module('tall-box', 'Tall box module', 'An upright compartment for tall books and display objects.', 'Boxes', [350], [700]),
  module('shallow-box', 'Shallow display module', 'A compact box with 200 mm deep panels for smaller objects.', 'Boxes', [350], [350], 200),
  module('double-cubby', 'Double cubby', 'Two compartments sharing a central divider and T connectors.', 'Cubbies', [350, 350], [350]),
  module('stacked-cubby', 'Stacked cubby', 'Two stacked compartments with a shared middle shelf.', 'Cubbies', [350], [350, 350]),
  module('four-cubby', 'Four cubby module', 'A two-by-two grid with a shared cross joint in the center.', 'Cubbies', [350, 350], [350, 350]),
  module('stepped', 'Stepped module', 'Three compartments in an L shape for stepped shelving.', 'Cubbies', [350, 350], [350, 350], 350, [[0, 0], [1, 0], [0, 1]]),
]

/** Import a fresh source, then use normal instance placement to keep existing work. */
export function insertLibraryAssembly(project: Project, id: string): Project {
  const example = ASSEMBLY_LIBRARY.find(item => item.id === id)
  if (!example) throw new Error(`Unknown library assembly: ${id}`)
  const definition = example.create().assemblies!.definitions[0]
  const data = project.assemblies ?? { definitions: [], instances: [], links: [] }
  return instantiateAssembly({ ...project, assemblies: { ...data, definitions: [...data.definitions, definition] } }, definition.id)
}
