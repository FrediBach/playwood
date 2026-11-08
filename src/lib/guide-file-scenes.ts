import type { GuideScene } from './guide-scenes'
import { gridProject } from './example-geometry'
import { createStarterProject, resolvePanels } from './model'
import { connectorOrderGroups, createConnectorOrder, formatEuros } from './connector-order'
import { getPhysicalConnectors } from './connector-selection'
import { detectPreviewFurnishings } from './preview-furnishings'
import type { Project } from './types'

export type FileGuideId = 'folder-sync' | 'connector-order' | 'blender-export'

/** Stable decoration choices keep teaching pictures independent of generated panel UUIDs. */
export function guideFurnishings(project: Project) {
  const panels = resolvePanels(project)
  const studyIds = new Map(panels.map((panel, index) => [`guide-furnishing-${index}`, panel.id]))
  return detectPreviewFurnishings(panels.map((panel, index) => ({ ...panel, id: `guide-furnishing-${index}` })))
    .map(item => ({ ...item, panelId: studyIds.get(item.panelId)! }))
}

export function buildFileGuideScenes(id: FileGuideId): GuideScene[] {
  const project = id === 'connector-order' ? gridProject('Practice box', [350], [350], { color: '#d7bd91' }) : createStarterProject('shelf')
  const scene = (note: string, title: string, lines: string[], extra: Partial<GuideScene> = {}): GuideScene =>
    ({ project, note, selected: [], ghost: [], labels: [], document: { title, lines }, ...extra })
  switch (id) {
    case 'folder-sync': return [
      scene('Sync connects a local directory while the browser recovery save continues independently.', 'Connect a folder', ['Sync → Choose folder', 'Allow file access']),
      scene('Save project associates this build with a file; folder autosave remains an explicit choice.', 'Save or duplicate', ['Save project', 'Autosave to folder', 'Duplicate project']),
      scene('Folder sync cards in the Library and Open in Sync use the same saved project.', 'Synced projects', ['Search name or file', 'Open saved project', 'Save first if prompted']),
      scene('Resync refreshes the file listing without replacing the current workspace.', 'Reconnect', ['Resync after reload', 'Review conflicts', 'Duplicate to preserve']),
    ]
    case 'connector-order': {
      const hardware = getPhysicalConnectors(project).map(piece => piece.id)
      const groups = connectorOrderGroups(project)
      const order = createConnectorOrder(project, Object.fromEntries(groups.map(group => [group.key, 'Black'])))
      return [scene('The order list counts installed physical pieces rather than structural connections.', 'Installed hardware', [`${hardware.length} connectors`, 'Buy → review list'], { selectedConnectors: hardware }),
        scene('Choosing Black resolves the order color without changing the illustrated hardware finishes.', 'Shop colors', ['Choose alternatives', 'Design stays unchanged']),
        scene('The estimate comes from the bundled catalogue; confirm current prices and availability at the shop.', 'Estimated total', [formatEuros(order.totalCents), 'VAT included', 'Shipping excluded']),
        scene('A downloaded text list combines quantities and product links; no order is placed.', 'Order list · TXT', [`${hardware.length} × 90° · Black`, 'Product links', 'Estimated total']),
      ]
    }
    case 'blender-export': return [
      scene('Restore solid visibility for the parts you want to export and keep an editable JSON backup.', 'Export project', ['Construction · GLB', 'Realistic scene · GLB']),
      scene('The furniture-only GLB contains the assembled visible geometry, materials, and a camera.', 'Construction', ['Panels and hardware', 'Embedded textures', 'Dimensions in meters']),
      scene('The room-scene option can include auto furnishings independently of the viewport setting.', 'Realistic scene', ['Room and decor', 'Optional furnishings', 'Static docked vacuum'], { room: true, furnishings: guideFurnishings(project) }),
      scene('Import the GLB in Blender, then refine lighting and materials and save your scene separately.', 'Blender import', ['File → Import', 'glTF 2.0', 'Save as .blend']),
    ]
  }
}
