import { createStarterProject } from './model'
import { CAD_EXAMPLES } from './cad-examples'
import { PDF_EXAMPLES } from './pdf-examples'
import { diamondShelfProject } from './photo-examples'
import type { Project } from './types'

export interface ExampleDefinition {
  id: string
  name: string
  description: string
  category: string
  /** Resource path relative to resources/library-3d, when supplied. */
  source?: string
  create: () => Project
}

/** Each entry opens one object, even when its reference contains a collection. */
export const EXAMPLE_LIBRARY: readonly ExampleDefinition[] = [
  { id: 'shelf', name: 'Everyday shelf', description: 'A little space for everything.', category: 'Starter builds', create: () => createStarterProject('shelf') },
  { id: 'desk', name: 'Work table', description: 'Room for your next big idea.', category: 'Starter builds', create: () => createStarterProject('desk') },
  { id: 'display', name: 'Creative display', description: 'Put your creativity on display.', category: 'Starter builds', create: () => createStarterProject('display') },
  { id: 'diamond-shelf', name: 'Diamond shelf', description: 'Five diamond compartments, white panels, and black connectors. Rotated 45°.', category: 'Shelving', create: diamondShelfProject },
  ...CAD_EXAMPLES,
  ...PDF_EXAMPLES,
]

export function createExampleProject(id: string): Project {
  if (id === 'blank') return createStarterProject('blank')
  const example = EXAMPLE_LIBRARY.find(item => item.id === id)
  if (!example) throw new Error(`Unknown library example: ${id}`)
  return example.create()
}
