import { synthStorageShelfProject } from './synth-storage-shelf'
import { synthShelfProject } from './synth-shelf'
import { catTowerProject } from './cat-tower'
import { connectedExample } from './connected-examples'
import { ASSEMBLY_LIBRARY } from './assembly-library'
import { createStarterProject, parseProject } from './model'
import monitorSpeakerTable from '../../resources/library-3d/user-projects/h-table-monitor-speaker-stand.json' with { type: 'json' }
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
  { id: 'cat-tower', name: 'Cat tower', description: 'Six levels in walnut and warm white on a 2×2 cube footprint, with rotating climbing openings and corner lookouts. 300×300 and 635×300 mm panels, with 50 mm-wide central braces.', category: 'Shelving', create: catTowerProject },
  { id: 'synth-shelf', name: 'Three-tier synth shelf', description: 'Three 900 mm wide trays tilted 30°, with front stops, a compact base, and five 150° connectors per tray.', category: 'Shelving', source: 'user-projects/three-tier-synth-shelf.json', create: synthShelfProject },
  { id: 'synth-shelf-storage', name: 'Synth shelf with 2×2 storage', description: 'The optimized three-tier synth stand above four regular storage cells. Two columns, two rows, and 300 mm upright cuts.', category: 'Shelving', source: 'user-projects/three-tier-synth-shelf.json', create: synthStorageShelfProject },
  { id: 'diamond-shelf', name: 'Diamond shelf', description: 'Five diamond compartments, white panels, and black connectors. Rotated 45°.', category: 'Shelving', create: diamondShelfProject },
  { id: 'h-table-monitor-speaker-stand', name: 'H-table with monitor and speaker stand', description: 'An H-table workstation with raised monitor and speaker stands and black connectors.', category: 'Tables', source: 'user-projects/h-table-monitor-speaker-stand.json', create: () => ({ ...parseProject(structuredClone(monitorSpeakerTable)), name: 'H-table with monitor and speaker stand' }) },
  ...[...CAD_EXAMPLES, ...PDF_EXAMPLES].map(example => ({
    ...example, description: example.description.replace(/doors/gi, 'fixed fronts').replace(/divider inserts/g, 'connected dividers'), create: () => connectedExample(example.id, example.create()),
  })),
]

export function createExampleProject(id: string): Project {
  if (id === 'blank') return createStarterProject('blank')
  const example = [...EXAMPLE_LIBRARY, ...ASSEMBLY_LIBRARY].find(item => item.id === id)
  if (!example) throw new Error(`Unknown library example: ${id}`)
  return example.create()
}
