import optimizedShelf from '../../resources/library-3d/user-projects/three-tier-synth-shelf.json' with { type: 'json' }
import { parseProject } from './model'
import type { Project } from './types'

/** Preserve the user-optimized cuts, placement, finishes, and individual hardware. */
export function synthShelfProject(): Project {
  return parseProject(structuredClone(optimizedShelf))
}
