import optimizedTower from '../../resources/library-3d/user-projects/cat-tower.json' with { type: 'json' }
import { parseProject } from './model'
import type { Project } from './types'

/** Preserve the user-optimized materials, finishes, construction, and hardware. */
export function catTowerProject(): Project {
  return parseProject(structuredClone(optimizedTower))
}
