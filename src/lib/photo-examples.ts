import { gridProject, groundProject } from './example-geometry'
import { rotateProject } from './model'
import type { Project } from './types'

/** Photo-inspired proportions: five shared bays, white square panels, black hardware. */
export function diamondShelfProject(): Project {
  // A five-cell cross becomes two upper diamonds, one center diamond, and
  // two lower diamonds after the same whole-creation turn offered by the editor.
  const upright = gridProject('Diamond shelf', [350, 350, 350], [350, 350, 350], {
    cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
    depth: 350,
    color: '#eeede7',
    connectorColor: '#292b27',
  })
  return rotateProject(groundProject(upright), 'z', 45)
}
