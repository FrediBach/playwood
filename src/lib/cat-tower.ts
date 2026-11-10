import { autoConnect } from './auto-connect'
import { createPanel } from './model'
import type { Project } from './types'

/** Clockwise climbing openings; each opening has a landing directly below it. */
const CAT_TOWER_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const

export function catTowerProject(): Project {
  const project: Project = { version: 1, name: 'Cat tower', panels: [], connections: [] }
  const panel = (name: string, width: number, position: [number, number, number], rotation: [number, number, number]) => {
    project.panels.push(createPanel({ name, width, height: 300, thickness: 18,
      material: 'birch', color: '#e8d5b5', position, rotation }))
  }
  for (let level = 0; level <= 6; level++) {
    const [holeX, holeZ] = CAT_TOWER_CORNERS[level % 4]
    const [x, z] = CAT_TOWER_CORNERS[(level + 1) % 4]
    const label = level === 6 ? 'Roof' : `Level ${level + 1}`
    const y = 9 + level * 335
    panel(`${label} · long landing`, 635, [0, y, -holeZ * 167.5], [-Math.PI / 2, 0, 0])
    // A full base connects the entry platform to both surrounding walls.
    panel(`${label} · ${level === 0 ? 'entry landing' : 'corner landing'}`, level === 0 ? 635 : 300, [level === 0 ? 0 : -holeX * 167.5, y, holeZ * 167.5], [-Math.PI / 2, 0, 0])
    if (level === 6) continue
    // A narrow central wall bridges each tier at the landing seam, on the
    // floored side of its opening. The 50 mm edge accommodates a 40 mm clamp.
    panel(`Level ${level + 1} · center brace`, 50,
      [-holeX * 67.5, y + 167.5, 0], [0, 0, 0])
    // Omit both wall segments at the lookout corner. The opposite walls span
    // two bays; the two remaining half walls leave a full-width entry/lookout.
    panel(`Level ${level + 1} · back wall`, 635, [0, y + 167.5, -z * 335], [0, 0, 0])
    panel(`Level ${level + 1} · front half wall`, 300, [-x * 167.5, y + 167.5, z * 335], [0, 0, 0])
    panel(`Level ${level + 1} · side wall`, 635, [-x * 335, y + 167.5, 0], [0, Math.PI / 2, 0])
    panel(`Level ${level + 1} · side half wall`, 300, [x * 335, y + 167.5, -z * 167.5], [0, Math.PI / 2, 0])
  }
  const connected = autoConnect(project).project
  return { ...connected, connections: connected.connections.map(connection => ({ ...connection, color: '#292b27' })) }
}
