import { createAssembly, instantiateAssembly } from './assemblies'
import { gridProject } from './example-geometry'
import type { ExampleDefinition } from './example-library'
import type { Project } from './types'

function module(id: string, name: string, description: string, category: string, columns: number[], rows: number[], depth = 350, cells?: [number, number][]): ExampleDefinition {
  return { id: `assembly-${id}`, name, description, category, create: () => {
    const project = gridProject(name, columns, rows, { depth, cells })
    return createAssembly(project, project.panels.map(panel => panel.id), name)
  } }
}

/** Cut lengths are in millimeters; the grid adds connector clearances. */
export const ASSEMBLY_LIBRARY: readonly ExampleDefinition[] = [
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
