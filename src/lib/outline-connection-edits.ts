import { getConnectorSeam, resolvePanels } from './model'
import { outlineConnectionAligned } from './outline-closures'
import { getOutlineError } from './panel-shape'
import type { Connection, Panel, Project } from './types'

const geometry = (panel: Panel | undefined) => panel && [panel.width, panel.height, panel.thickness, panel.position, panel.rotation, panel.customOutline, panel.cornerRadius]
const jointGeometry = (connection: Connection) => [connection.parentId, connection.childId, connection.type, connection.role, connection.partial, connection.side, connection.flip, connection.inset, connection.quarterTurn, connection.outlineEdge, connection.count]

/** Prevent direct inspector edits from leaving persisted edge references invalid.
 * Imported problems may remain while their referenced geometry is unchanged;
 * explicit detach removes the relationship and keeps the cut shape editable.
 */
export function assertOutlineConnectionEdit(before: Project, candidate: Project): Project {
  const joints = candidate.connections.filter(connection => connection.outlineEdge !== undefined)
  if (!joints.length) return candidate
  const previousPanels = new Map(resolvePanels(before).map(panel => [panel.id, panel]))
  const panels = new Map(resolvePanels(candidate).map(panel => [panel.id, panel]))
  const previousConnections = new Map(before.connections.map(connection => [connection.id, connection]))
  for (const connection of joints) {
    const parent = panels.get(connection.parentId), child = panels.get(connection.childId)
    const group = candidate.connections.filter(item => item.id.replace(/:\d+$/, '') === connection.id.replace(/:\d+$/, ''))
    const quantity = Math.max(...group.map(item => item.count))
    const seams = parent && group.flatMap(item => {
      const member = panels.get(item.childId)
      return member ? [getConnectorSeam(item, parent, member)] : []
    })
    const span = seams?.length === group.length ? Math.min(...seams.map(seam => seam.upper)) - Math.max(...seams.map(seam => seam.lower)) : -Infinity
    const minimumThickness = connection.type === 't' ? 18 : 16
    if (parent && child && !getOutlineError(child.customOutline) && outlineConnectionAligned(parent, child, connection)
      && [parent, child].every(panel => panel.thickness >= minimumThickness && panel.thickness <= 19)
      && span >= (quantity - 1) * 40 - 1e-5) continue
    const previous = previousConnections.get(connection.id)
    if (previous && JSON.stringify(jointGeometry(previous)) === JSON.stringify(jointGeometry(connection))
      && JSON.stringify(geometry(previousPanels.get(connection.parentId))) === JSON.stringify(geometry(parent))
      && JSON.stringify(geometry(previousPanels.get(connection.childId))) === JSON.stringify(geometry(child))) continue
    throw new Error('This edit would break a fitted outline joint. Resize the surrounding panels, or detach the fitted panel before editing its outline or placement.')
  }
  return candidate
}
