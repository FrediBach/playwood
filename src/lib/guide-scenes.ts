import { buildEditingGuideScenes } from './guide-editing-scenes'
import { buildFileGuideScenes, guideFurnishings } from './guide-file-scenes'
import { buildObjectGuideScenes } from './guide-object-scenes'
import type { ObjectSurface } from './object-geometry'
import type { GuideId } from './build-guide-types'
import type { AttachmentOptions, Panel, Project, Vec3 } from './types'
import { attachPanel, createPanel, createStarterProject, getProjectBounds, moveProject, resolvePanels, rotateProject } from './model'
import { gridProject } from './example-geometry'
import { autoConnect } from './auto-connect'
import { connectSelectedConnectors } from './connect-panel'
import { closePanelHole, findPanelHoles } from './close-holes'
import { splitParallelPanels } from './parallel-panels'
import { createAssembly, disconnectAssembly, duplicateAssembly, getAssemblyAttachmentTargets, makeAssemblyIndependent, updateAssemblyDefinition, updateAssemblyFinish, updateAssemblyParameterValues } from './assemblies'
import { ASSEMBLY_LIBRARY, insertAssemblyDefinition } from './assembly-library'
import { createAssemblyFile, parseAssemblyFile } from './assembly-file'
import { movePreviewResize, preparePreviewResize, type PreviewResizeHandle } from './preview-resize'
import { moveStructureRepeat, prepareStructureRepeat } from './structure-repeat'
import { rotateSelection } from './selection-rotation'
import { editConnectors, getPhysicalConnectors } from './connector-selection'
import { splitPanelGrid } from './grid-split'
import { getRescaleValues, rescaleProject } from './project-rescale'
import { addCustomColor, removeCustomColor, updateCustomColor } from './custom-colors'
import { snapPanelDelta } from './preview-snap'
import type { FurnishingPlacement } from './preview-furnishings'
import { setDesignConstraint } from './design-constraint-commands'

export interface GuideScene {
  project: Project
  objectSurfaces?: ObjectSurface[]
  selected: string[]
  ghost: string[]
  labels: { text: string; panelId?: string; point?: Vec3 }[]
  note: string
  view?: 'front' | 'side' | 'top'
  dimensions?: boolean
  selectedConnectors?: string[]
  ghostConnectors?: string[]
  resizeHandles?: (PreviewResizeHandle & { distance?: number })[]
  outlinePoints?: boolean
  room?: boolean
  selectionBox?: string[]
  gridSpacing?: number
  alignment?: [Vec3, Vec3][]
  swatches?: { name: string; color: string }[]
  furnishings?: FurnishingPlacement[]
  document?: { title: string; lines: string[] }
}

const options: AttachmentOptions = { side: 'right', type: '90', offset: 0, inset: 0, flip: false, color: '#c94727', count: 2 }
const ids = (project: Project) => project.panels.map(panel => panel.id)
const scene = (project: Project, note: string, extra: Partial<GuideScene> = {}): GuideScene => ({ project, note, selected: [], ghost: [], labels: [], ...extra })
const label = (panel: Panel, text: string) => ({ panelId: panel.id, text })
const box = () => gridProject('Practice box', [350], [350], { color: '#d7bd91' })
const base = () => createPanel({ id: 'guide-base', name: 'Base panel', width: 600, height: 360, position: [0, 70, 0], rotation: [-Math.PI / 2, 0, 0] })
const single = (panel = base()): Project => ({ version: 1, name: 'Practice panel', panels: [panel], connections: [] })
const corner = (type: AttachmentOptions['type'] = '90', extra: Partial<AttachmentOptions> = {}) => {
  const project = single()
  return attachPanel(project, project.panels[0].id, createPanel({ id: 'guide-side', name: 'Side panel', width: 350, height: 360 }), { ...options, type, ...extra })
}
const frozen = (project: Project): Project => ({ ...project, panels: resolvePanels(project), connections: [] })
const finish = (project: Project, selected: string[], color: string): Project => {
  const selectedIds = new Set(selected)
  return { ...project, panels: project.panels.map(panel => selectedIds.has(panel.id) ? { ...panel, color } : panel) }
}
const addedPanels = (original: Project, updated: Project) => {
  const originalIds = new Set(ids(original))
  return updated.panels.filter(panel => !originalIds.has(panel.id))
}

function libraryAssembly(id: string): Project {
  const example = ASSEMBLY_LIBRARY.find(example => example.id === id)
  if (!example) throw new Error(`Guide assembly is missing from the library: ${id}`)
  return example.create()
}

function attachedGuideCopy(project: Project, instanceId: string): Project {
  const targets = getAssemblyAttachmentTargets(project, instanceId)
  const target = targets.find(target => target.label === 'Top right' && target.project)
  if (!target?.project) throw new Error(`Guide assembly cannot attach at Top right: ${targets.find(target => target.label === 'Top right')?.error ?? 'no target'}`)
  return target.project
}

function buildScenes(id: GuideId): GuideScene[] {
  switch (id) {
    case 'draw-connectors':
    case 'selection-stretch':
    case 'equal-sizes':
    case 'merge-panels':
    case 'reference-rules':
    case 'repair-overlaps': return buildEditingGuideScenes(id)
    case 'folder-sync':
    case 'connector-order':
    case 'blender-export': return buildFileGuideScenes(id)
    case 'boolean-objects': return buildObjectGuideScenes(false)
    case 'object-solver': return buildObjectGuideScenes(true)
    case 'constraints': {
      const lower = createPanel({ id: 'guide-constraint-lower', name: 'Lower shelf', width: 600, height: 300, position: [0, 600, 0], rotation: [-Math.PI / 2, 0, 0] })
      const upper = createPanel({ ...lower, id: 'guide-constraint-upper', name: 'Upper shelf', position: [0, 850, 0] })
      const p: Project = { ...single(lower), panels: [lower, upper] }
      const raised = setDesignConstraint(p, { id: 'guide-floor', kind: 'floor', enabled: true, panelId: lower.id, reference: 'max', value: 800 })
      const spaced = setDesignConstraint(raised, { id: 'guide-gap', kind: 'gap', enabled: true, panelIds: [lower.id, upper.id], axis: 'y', relation: 'minimum', value: 200 }, lower.id)
      const matched = setDesignConstraint(spaced, { id: 'guide-equal', kind: 'equal-dimension', enabled: true, panelIds: [lower.id, upper.id], dimension: 'height' }, lower.id)
      const finished = setDesignConstraint(matched, { id: 'guide-width', kind: 'dimension', enabled: true, panelId: lower.id, dimension: 'width', value: 600 })
      return [scene(p, 'Choose a placement measurement or a panel cut dimension before adding a rule.', { selected: [lower.id], document: { title: 'Design rules', lines: ['Height above floor', 'Fixed cut size', 'Equal cut sizes', 'Same level', 'Exact or min gap'] } }),
        scene(raised, 'Preview the lower shelf with its top surface 800 mm above the floor.', { ghost: [lower.id], document: { title: 'Height above floor', lines: ['Top surface / edge', '800 mm = 80 cm', 'Add constraint · Cancel'] }, labels: [label(raised.panels[0], 'Top surface: 800 mm')] }),
        scene(spaced, 'The upper shelf moves until its bottom is at least 200 mm above the lower shelf’s top.', { ghost: [upper.id], selected: [lower.id], alignment: [[[330, 800, 0], [330, 1000, 0]]], document: { title: 'Gap between panels', lines: ['Vertical · Y', 'At least 200 mm', 'Keep Lower shelf in place'] } }),
        scene(finished, 'Both cut heights match while the shelves keep their different elevations and clear opening.', { selected: ids(finished), document: { title: '4 active rules', lines: ['Top: 800 mm', 'Gap: ≥200 mm', 'Cut heights: equal', 'Cut width: 600 mm'] } })]
    }
    case 'projects': {
      const p = createStarterProject('shelf'), cube = box()
      const module = libraryAssembly('assembly-cube').assemblies!.definitions[0]
      const added = insertAssemblyDefinition(cube, module)
      return [scene(p, 'Export a project file before replacing the current build if you want a separate backup.', { document: { title: 'Project file · JSON', lines: ['Editable backup', 'Keep your current build'] } }),
        scene(p, 'The current build remains until you confirm Start new project in the dialog.', { document: { title: 'Start a new project?', lines: ['Export current project', 'Start new project', 'Cancel'] } }),
        scene(cube, 'A full build replaces the workspace. Undo restores the previous project.', { labels: [{ text: 'Cube · full build', point: [0, 200, 0] }] }),
        scene(added, 'An assembly adds a reusable module beside the existing build when nothing is selected.', { selected: addedPanels(cube, added).map(panel => panel.id) })]
    }
    case 'box-select': {
      const p = box(), hardware = getPhysicalConnectors(p).map(piece => piece.id)
      const bottom = p.panels.find(panel => panel.name === 'Shelf 1.1')!
      return [scene(p, 'Use Front view to make a rectangle around the frame easier to draw.', { view: 'front' }),
        scene(p, 'Press B, then drag until the complete parts are enclosed by the rectangle.', { view: 'front', selected: ids(p), selectedConnectors: hardware, selectionBox: ids(p) }),
        scene(p, 'Hold Shift while drawing to add the bottom board to the parts already selected.', { view: 'front', selected: ids(p), selectedConnectors: hardware, selectionBox: [bottom.id] }),
        scene(p, 'For a mixed selection, choose Panels or Connectors to show its inspector.', { selected: ids(p), selectedConnectors: hardware, document: { title: 'Assembly', lines: ['Panels · 4 selected', 'Connectors · 8 selected'] } })]
    }
    case 'snap-settings': {
      const panel = createPanel({ id: 'guide-snap', width: 150, height: 150, position: [-122, 125, 0] })
      const other = createPanel({ id: 'guide-snap-target', width: 150, height: 150, position: [175, 175, 0] })
      const p: Project = { ...single(panel), panels: [panel, other] }
      const shifted = (project: Project, delta: Vec3): Project => ({ ...project, panels: project.panels.map(item => item.id === panel.id ? { ...item, position: item.position.map((value, axis) => value + delta[axis]) as Vec3 } : item) })
      const gridded = shifted(p, snapPanelDelta(p.panels, [panel.id], [51, 0, 0], { grid: true, geometry: false, spacing: 50, tolerance: 10 }))
      const aligned = shifted(gridded, snapPanelDelta(gridded.panels, [panel.id], [0, 46, 0], { grid: false, geometry: true, spacing: 50, tolerance: 10 }))
      const resize = preparePreviewResize(aligned, { panelId: panel.id })!
      return [scene(p, 'Grid and geometry snapping are independent settings in the Snap menu.', { selected: [panel.id], view: 'front' }),
        scene(gridded, 'The 50 mm grid begins at world zero. A nearby panel boundary snaps to a grid line.', { selected: [panel.id], view: 'front', gridSpacing: 50 }),
        scene(aligned, 'Geometry alignment matches the upper and lower boundaries of the other board.', { selected: [panel.id], view: 'front', alignment: [[[-175, 100, 0], [250, 100, 0]], [[-175, 250, 0], [250, 250, 0]]] }),
        scene(aligned, 'The same snap preferences apply to resize arrows and keyboard movement.', { selected: [panel.id], view: 'front', gridSpacing: 50, resizeHandles: resize.handles })]
    }
    case 'grid-split': {
      const p = box(), divided = splitPanelGrid(p, ids(p), 1, 1).project
      const added = addedPanels(p, divided).map(panel => panel.id)
      return [scene(p, 'A rectangular opening has two pairs of matching opposite panels.', { view: 'front' }),
        scene(p, 'Select all four frame panels to offer Divide into a grid.', { selected: ids(p), view: 'front' }),
        scene(divided, 'One X divider and one Y divider create two columns and two rows.', { ghost: added, view: 'front', document: { title: 'Divide into a grid', lines: ['X dividers: 1', 'Y dividers: 1', '2 × 2 compartments'] } }),
        scene(divided, 'The completed grid includes T joints at its edges and a cross joint at its center.', { dimensions: true, labels: [{ text: 'Cross at the intersection', point: [0, 201.5, 0] }] })]
    }
    case 'palette': {
      const p = single(), green = addCustomColor(p, { name: 'Meadow', color: '#8d9e7e' }), colorId = green.customColors![0].id
      const applied = finish(green, ids(green), '#8d9e7e')
      const blue = updateCustomColor(applied, colorId, { name: 'Lake', color: '#6f88a5' })
      const replaced = removeCustomColor(blue, colorId, '#d9bd8c')
      return [scene(p, 'Select a panel and open Material & finish to choose its color.', { selected: ids(p) }),
        scene(green, 'Save color adds a named swatch. Click that swatch to apply it to the panel.', { swatches: [{ name: 'Meadow · saved swatch', color: '#8d9e7e' }] }),
        scene(blue, 'Editing an applied palette color updates every matching use throughout the project.', { selected: ids(blue), swatches: [{ name: 'Lake · edited color', color: '#6f88a5' }] }),
        scene(replaced, 'Removing an in-use custom color replaces its uses with your chosen remaining swatch.', { swatches: [{ name: 'Birch · replacement', color: '#d9bd8c' }] })]
    }
    case 'move-creation': {
      const p = box(), moved = moveProject(p, [200, 100, 0])
      const bounds = getProjectBounds(resolvePanels(moved))
      const grounded = moveProject(moved, [-(bounds.min[0] + bounds.max[0]) / 2, -bounds.min[1], 0])
      return [scene(p, 'Move creation moves every panel and connector together, including hidden parts.', { gridSpacing: 100, view: 'front' }),
        scene(p, 'Enter distances along the fixed world axes before applying the move.', { view: 'front', document: { title: 'Move creation', lines: ['X: 200 mm', 'Y: 100 mm', 'Z: 0 mm'] } }),
        scene(moved, 'Applying the move shifts the whole frame right and up while preserving every joint.', { gridSpacing: 100, view: 'front' }),
        scene(grounded, 'Center horizontally and Place on floor set the distances for the next move.', { gridSpacing: 100, view: 'front', labels: [{ text: 'Lowest panel at Y = 0', point: [0, 0, 0] }] })]
    }
    case 'rescale': {
      const p = box(), value = getRescaleValues(p).find(value => value.kind === 'dimension' && value.value === 350)!
      const scaled = rescaleProject(p, { [value.id]: 500 })
      return [scene(p, 'Repeated measurements combine matching widths and heights across the whole project.', { dimensions: true }),
        scene(p, 'Change the repeated 350 mm cut length to 500 mm; thickness stays at 18 mm.', { document: { title: 'Rescale creation', lines: [`350 mm · ${value.count} uses`, 'New value: 500 mm', 'Thickness: 18 mm'] } }),
        scene(scaled, 'Apply rescale updates the matching cuts and connected spans together.', { selected: ids(scaled), dimensions: true }),
        scene(scaled, 'The larger frame keeps its original hardware sizes and valid joints.', { dimensions: true, view: 'side' })]
    }
    case 'room-preview': {
      const p = createStarterProject('shelf')
      return [scene(p, 'Inspect the assembled shelf in Studio before opening Realistic preview.', { dimensions: true }),
        scene(p, 'The 165 cm floor lamp gives the furniture a familiar reference in the room.', { room: true }),
        scene(p, 'Auto furnish places books and decor on suitable visible shelves without adding project parts.', { room: true, furnishings: guideFurnishings(p) }),
        scene(p, 'Return to Studio to keep editing the same panels, dimensions, and connections.', { dimensions: true, selected: [p.panels[4].id] })]
    }
    case 'workspace': {
      const p = createStarterProject('shelf'), shelf = p.panels[4]
      return [scene(p, 'The same editable shelf you can open from the Library.', { labels: [label(p.panels[0], 'Panels'), label(p.panels[1], 'Connectors join edges')] }),
        scene(p, 'Orbit changes your viewpoint; your furniture stays in place.', { view: 'side' }),
        scene(p, 'Front view makes shelf heights easy to compare.', { view: 'front', dimensions: true }),
        scene(p, 'One selected panel · its settings appear in the inspector.', { selected: [shelf.id], labels: [label(shelf, 'Middle shelf selected')] })]
    }
    case 'first-panel': {
      const upright = createPanel({ id: 'guide-first', name: 'My panel', width: 600, height: 360, position: [0, 220, 0] })
      const p = single(upright), flat = single({ ...upright, rotation: [-Math.PI / 2, 0, 0], position: [0, 70, 0] })
      return [scene(p, 'A single panel is the starting point for a new build.', { ghost: [upright.id], labels: [label(upright, 'New panel draft')] }),
        scene(p, '600 × 360 × 18 mm · width, height, thickness.', { dimensions: true, view: 'front' }),
        scene(flat, 'Horizontal · the same panel laid flat.', { ghost: [upright.id], labels: [label(upright, 'Orientation preview')] }),
        scene(flat, 'Your first panel is ready to select, edit, and connect.', { selected: [upright.id], labels: [label(upright, 'Added to the workspace')] })]
    }
    case 'attach': {
      const p = corner(), parent = p.panels[0], child = p.panels[1]
      const offset = corner('90', { offset: 50 })
      return [scene(single(parent), 'Start by selecting the panel you want to build from.', { selected: [parent.id], labels: [label(parent, 'Parent panel')] }),
        scene(p, 'The transparent panel shows the proposed attachment.', { selected: [parent.id], ghost: [child.id], labels: [label(child, 'New panel preview')] }),
        scene(offset, 'Offset moves the new panel along the shared edge.', { ghost: [child.id], labels: [label(offset.panels[1], 'Offset: 50 mm')] }),
        scene(p, 'The connection positions both panels and their hardware.', { selected: [child.id], labels: [label(p.panels[1], 'Attached with two 90° connectors')] })]
    }
    case 'angles': {
      const right = corner(), angled = corner('105'), t = corner('t'), cross = corner('cross')
      return [scene(right, '90° · a square corner joins two panel edges.', { labels: [label(right.panels[1], '90° corner')] }),
        scene(angled, '105° · a more open corner. 150° opens it further.', { selected: [angled.panels[1].id], labels: [label(angled.panels[1], '105° opening')] }),
        scene(t, 'T · three separate panels meet at one seam.', { selected: ids(t).slice(1), labels: [label(t.panels[2], 'Continuation panel')] }),
        scene(cross, 'Cross · four separate panels share one joint.', { selected: ids(cross).slice(1), labels: [label(cross.panels[2], 'Opposite branch'), label(cross.panels[3], 'Continuation panel')] })]
    }
    case 'auto-connect': {
      const joined = box(), loose = frozen(joined)
      const fitted = autoConnect(loose, ids(loose)).project
      const t = corner('t')
      return [scene(loose, 'Correct angle and edge clearance come before hardware.', { labels: [label(loose.panels[1], 'Aligned, unconnected panel')] }),
        scene(loose, 'Select the panels whose compatible edges should join.', { selected: ids(loose) }),
        scene(fitted, 'Auto-add connectors fits the joints at their current positions.', { selected: ids(fitted), labels: [{ text: 'Eight fitted connectors', point: [192.5, 9, 155] }] }),
        scene(t, 'Adding a continuation can upgrade a corner into a complete T joint.', { selected: [t.panels[2].id], labels: [label(t.panels[2], 'Third panel completes the T')] })]
    }
    case 'connect-panel': {
      const p = corner(), hardware = getPhysicalConnectors(p).map(piece => piece.id)
      const open = editConnectors(p, hardware, { type: 't' })
      const fitted = connectSelectedConnectors(open, hardware)
      const panel = fitted.project.panels.find(panel => panel.id === fitted.panelId)!
      return [scene(p, 'Select two physical connectors along the existing corner.', { selectedConnectors: hardware }),
        scene(open, 'T hardware provides matching free openings without moving the boards.', { selectedConnectors: hardware, document: { title: 'Connector type · T', lines: ['Two occupied branches', 'One free opening per clamp'] } }),
        scene(fitted.project, 'Connect with a panel fills both openings with one fitted board.', { selected: [panel.id], labels: [label(panel, 'New continuation panel')] }),
        scene(fitted.project, 'The corner keeps its position; the open end extends 360 mm.', { selected: [panel.id], view: 'side', labels: [label(panel, '360 × 360 × 18 mm')] })]
    }
    case 'close-hole': {
      const p = box(), hole = findPanelHoles(resolvePanels(p)).find(item => item.label === 'Back')!
      const closed = closePanelHole(p, ids(p), hole.id)
      const preview = { ...p, panels: [...p.panels, hole.panel] }
      return [scene(p, 'Four panels enclose a rectangular opening.', { labels: [{ text: 'Open back', point: [0, 201.5, -175] }] }),
        scene(p, 'Select the complete frame around the opening.', { selected: ids(p) }),
        scene(preview, 'Choose Back to close the rear face of this box.', { ghost: [hole.panel.id], labels: [label(hole.panel, 'Fitted back panel')] }),
        scene(closed.project, 'The fitted back and its hardware follow compatible frame resizing.', { selected: [closed.panelId], labels: [label(closed.project.panels.find(panel => panel.id === closed.panelId)!, 'Back closed')] })]
    }
    case 'split-panels': {
      const p = box()
      const pair = p.panels.filter(panel => panel.name.startsWith('Shelf'))
      const result = splitParallelPanels(p, pair.map(panel => panel.id))
      const added = addedPanels(p, result.project)
      return [scene(p, 'Start with a compartment and matching top and bottom.', { labels: [label(pair[0], '350 mm cut length')] }),
        scene(p, 'Only the two parallel panels are selected.', { selected: pair.map(panel => panel.id) }),
        scene(result.project, 'Split in the middle adds a divider and space for T bodies.', { ghost: added.map(panel => panel.id), labels: [label(added.find(panel => panel.name === 'Center divider')!, 'Center divider')] }),
        scene(result.project, 'Two compartments, with the original outside dimensions.', { selected: added.map(panel => panel.id), dimensions: true })]
    }
    case 'move-snap': {
      const attached = corner(), child = attached.panels[1]
      const makeLoose = (delta: Vec3) => ({ ...frozen(attached), panels: resolvePanels(attached).map(panel => panel.id === child.id ? { ...panel, position: panel.position.map((value, i) => value + delta[i]) as Vec3 } : panel) })
      const loose = makeLoose([190, 80, 0]), near = makeLoose([45, 0, 0])
      return [scene(loose, 'A separate panel can be moved toward a compatible edge.', { labels: [label(child, 'Loose panel')] }),
        scene(loose, 'Select the panel, then hold Control and drag it.', { selected: [child.id] }),
        scene(near, 'As you approach an edge, watch for the snap preview.', { ghost: [child.id], labels: [label(child, 'Move toward the edge')] }),
        scene(attached, 'Release on a valid snap to place the panel and fit hardware.', { selected: [child.id], labels: [label(child, 'Snapped into place')] })]
    }
    case 'resize': {
      const p = box(), top = p.panels.find(panel => panel.name === 'Shelf 1.2')!
      const panelResize = preparePreviewResize(p, { panelId: top.id })!
      const edge = panelResize.handles.find(handle => handle.id === 'panel-width-positive')!
      const widthChange = movePreviewResize(panelResize, edge.id, 100)
      const wider = widthChange.project
      const connector = getPhysicalConnectors(wider).find(piece => piece.connection.parentId === top.id || piece.connection.childId === top.id)!
      const connectorResize = preparePreviewResize(wider, { connectorId: connector.id })!
      const upward = connectorResize.handles.find(handle => handle.direction[1] > .999)!
      const heightChange = movePreviewResize(connectorResize, upward.id, 100)
      const repeat = prepareStructureRepeat(heightChange.project, top.id, edge.direction)
      const repeated = moveStructureRepeat(repeat, repeat.pitch * 2)
      const repeatedEdge = preparePreviewResize(heightChange.project, { panelId: top.id })!.handles.find(handle => handle.id === edge.id)!
      const originalIds = new Set(heightChange.project.panels.map(panel => panel.id))
      const movedHandle = (handle: PreviewResizeHandle, distance: number) => ({ ...handle,
        position: handle.position.map((value, axis) => value + handle.direction[axis] * distance) as Vec3, distance })
      return [scene(p, 'One selected panel reveals the directions you can pull or push.', { selected: [top.id], dimensions: true, resizeHandles: panelResize.handles }),
        scene(wider, 'Pulling this edge by 100 mm widens the frame; the opposite edge stays fixed.', { selected: [top.id], dimensions: true, resizeHandles: [movedHandle(edge, widthChange.distance)] }),
        scene(heightChange.project, 'Pulling one connector upward by 100 mm extends the side panels and keeps the corners joined.', { selectedConnectors: [connector.id], dimensions: true, resizeHandles: [movedHandle(upward, heightChange.distance)] }),
        scene(repeated.project, 'Control-pull adds complete bays. Pull back to retract the preview; Escape cancels every addition.', {
          selected: repeat.panelIds, ghost: repeated.project.panels.filter(panel => !originalIds.has(panel.id)).map(panel => panel.id),
          resizeHandles: [movedHandle(repeatedEdge, repeated.distance)],
          document: { title: 'Repeat', lines: ['2 bays', 'Shared walls and fitted connectors', 'Release to apply · Esc to cancel'] },
        })]
    }
    case 'rotate': {
      const p = box()
      const turned = rotateSelection(p, ids(p), 'x')
      return [scene(p, 'Select every connected panel before rotating the group.', { selected: ids(p) }),
        scene(p, 'X tips, Y turns, and Z tilts around the selection center.', { selected: ids(p), labels: [{ text: 'Selection center', point: [0, 201.5, 0] }] }),
        scene(turned, 'Here, X tips the whole selection 90° around its center.', { selected: ids(p), labels: [{ text: 'X · 90°', point: [0, 201.5, 0] }] }),
        scene(rotateProject(p, 'z', 45), 'Rotate creation can tilt the entire build by 45°.', { labels: [{ text: 'Whole creation · 45°', point: [0, 300, 0] }] })]
    }
    case 'copy-paste': {
      const p = corner(), parent = p.panels[0], copied = p.panels[1]
      const pasted = attachPanel(p, parent.id, createPanel({ ...copied, id: 'guide-copy', name: 'Copied side' }), { ...options, side: 'left' })
      return [scene(p, 'Copy one panel to reuse its dimensions and finish.', { selected: [copied.id], labels: [label(copied, 'Copy this panel')] }),
        scene(p, 'Select the destination panel before pasting.', { selected: [parent.id], labels: [label(parent, 'Destination panel')] }),
        scene(pasted, 'Choose a location, then preview an arrangement.', { selected: [parent.id], ghost: ['guide-copy'], labels: [label(pasted.panels[2], 'Arrangement preview')] }),
        scene(pasted, 'Choose Attach copy to keep the panels and their connections.', { selected: ['guide-copy'], labels: [label(pasted.panels[2], 'New independent panel')] })]
    }
    case 'multi-select': {
      const p = box(), pair = p.panels.filter(panel => panel.name.startsWith('Shelf')).map(panel => panel.id)
      return [scene(p, 'Click the first panel.', { selected: [pair[0]], labels: [label(p.panels[0], 'First selected panel')] }),
        scene(p, 'Shift-click the second panel to add it to the selection.', { selected: pair }),
        scene(p, 'Matching boards share editable properties in the inspector.', { selected: pair, labels: [label(p.panels[0], 'Two matching panels')] }),
        scene(finish(p, pair, '#8d9e7e'), 'A shared finish change applies to both selected panels.', { selected: pair, labels: [label(p.panels[0], 'Shared color applied')] })]
    }
    case 'finishes': {
      const panel = createPanel({ id: 'guide-finish', width: 600, height: 360, position: [0, 200, 0] })
      const oak = { ...panel, material: 'oak' as const, color: '#bb8f59' }
      const rounded = { ...oak, cornerRadius: 25 }
      const perforated = { ...rounded, pattern: 'pegboard' as const, holeSize: 18, holeSpacing: 60 }
      return [scene(single(panel), 'Start with one selected solid panel.', { selected: [panel.id] }),
        scene(single(oak), 'Material and finish change the appearance of the panel.', { labels: [label(panel, 'Oak finish')] }),
        scene(single(rounded), 'Corner radius rounds the actual panel outline.', { labels: [label(panel, '25 mm corner radius')], view: 'front' }),
        scene(single(perforated), 'Pegboard holes are openings through the panel.', { labels: [label(panel, '18 mm holes · 60 mm spacing')], view: 'front' })]
    }
    case 'custom-outline': {
      const panel = createPanel({ id: 'guide-outline', width: 600, height: 360, position: [0, 200, 0] })
      const trapezoid = { ...panel, customOutline: [{ x: .15, y: 0 }, { x: .85, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
      const cut = { ...panel, customOutline: [{ x: 0, y: 0 }, { x: .55, y: 0 }, { x: .55, y: .45 }, { x: 1, y: .45 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
      return [scene(single(panel), 'The outline editor works inside the panel’s rectangular bounds.', { view: 'front', outlinePoints: true, dimensions: true }),
        scene(single(trapezoid), 'Move corner points to shape the perimeter.', { view: 'front', outlinePoints: true }),
        scene(single(cut), 'Add points to create an inward corner or a stepped edge.', { view: 'front', outlinePoints: true }),
        scene(single({ ...cut, cornerRadius: 25 }), 'Apply the rounded outline to the panel.', { labels: [label(panel, 'Applied outline · 25 mm radius')] })]
    }
    case 'groups': {
      const p = createStarterProject('shelf'), pair = [p.panels[1].id, p.panels[5].id]
      return [scene(p, 'List groups organize parts without changing their physical joints.'),
        scene(p, 'Select the panels you want to keep together in the list.', { selected: pair, labels: [label(p.panels[1], 'Left side panels')] }),
        scene(p, 'Group selected creates a named folder for those rows.', { selected: pair, document: { title: '▾ Left sides', lines: ['✓ Left side', '✓ Left upper side'] } }),
        scene(p, 'The group checkbox selects every member, even while collapsed.', { selected: pair, document: { title: '✓ ▸ Left sides', lines: ['2 panels selected', 'Geometry stays unchanged'] } })]
    }
    case 'assemblies': {
      const p = box(), assembly = createAssembly(p, ids(p), 'My box'), instance = assembly.assemblies!.instances[0]
      const duplicated = duplicateAssembly(assembly, instance.id)
      return [scene(p, 'Begin with a connected box made from separate panels.'),
        scene(p, 'Select every panel that belongs to the reusable design.', { selected: ids(p) }),
        scene(assembly, 'Create assembly turns this selection into its first instance.', { selected: ids(p), labels: [{ text: 'My box · linked instance', point: [0, 200, 0] }] }),
        scene(duplicated, 'Duplicate creates another instance of the same source design.', { selected: addedPanels(p, duplicated).map(panel => panel.id), document: { title: 'My box', lines: ['One shared design', 'Two linked instances'] } })]
    }
    case 'assembly-attach': {
      const original = box(), p = createAssembly(original, ids(original), 'My box'), first = p.assemblies!.instances[0]
      const joined = attachedGuideCopy(p, first.id)
      const copy = joined.assemblies!.instances[1], copyIds = Object.values(copy.panelIds)
      return [scene(p, 'Select a whole instance to build outward from its corners.', { selected: ids(p) }),
        scene(joined, 'Attach a copy previews a second instance at a compatible +.', { selected: ids(p), ghost: copyIds, labels: [{ text: 'Copy preview', point: copy.position }] }),
        scene(joined, 'A shared corner replaces the original hardware with cross connectors.', { selected: copyIds }),
        scene(disconnectAssembly(joined, copy.id), 'Disconnect from neighbors separates the copy while keeping its source link.', { selected: copyIds })]
    }
    case 'assembly-values': {
      const p = libraryAssembly('assembly-cube'), instance = p.assemblies!.instances[0]
      const two = duplicateAssembly(p, instance.id), copy = two.assemblies!.instances[1], selected = Object.values(copy.panelIds)
      const larger = updateAssemblyParameterValues(two, copy.id, { 'side-length': 450 })
      return [scene(two, 'Both instances start with the same 350 mm cut lengths.'),
        scene(two, 'Select only the instance you want to configure.', { selected }),
        scene(larger, 'Side length changes this instance; the source and its sibling stay at 350 mm.', { selected, labels: [{ text: 'Side length: 450 mm', point: larger.assemblies!.instances[1].position }] }),
        scene(updateAssemblyFinish(larger, copy.id, { color: '#8d9e7e' }), 'Instance panel color also belongs only to the selected copy.', { selected })]
    }
    case 'assembly-controls': {
      const p = box(), parameters = [{ id: 'side', name: 'Side length', defaultValue: 350,
        bindings: p.panels.flatMap(panel => (['width', 'height'] as const).map(dimension => ({ panelId: panel.id, dimension, scale: 1, offset: 0 }))) }]
      const assembly = createAssembly(p, ids(p), 'My box', parameters), first = assembly.assemblies!.instances[0]
      const two = duplicateAssembly(assembly, first.id), second = two.assemblies!.instances[1]
      const resized = updateAssemblyParameterValues(two, second.id, { side: 450 })
      return [scene(p, 'Select the box panels and open Editable values in the creation form.', { selected: ids(p), document: { title: 'Create assembly', lines: ['My box', '▾ Editable values'] } }),
        scene(p, 'Add one named value for the cut lengths you want to control together.', { selected: ids(p), document: { title: 'Side length', lines: ['Default: 350 mm', 'Choose dimensions'] } }),
        scene(p, 'Each of the four boards contributes both Width and Height.', { selected: ids(p), document: { title: '8 dimensions', lines: ['4 × Width + Height', 'Multiplier 1', 'Offset 0 mm'] } }),
        scene(resized, 'The new shared control can configure each instance separately.', { selected: Object.values(second.panelIds), document: { title: 'Instance values', lines: ['Side length: 450', 'Other copy: 350'] } })]
    }
    case 'assembly-files': {
      const original = libraryAssembly('assembly-cube'), first = original.assemblies!.instances[0]
      const configured = updateAssemblyFinish(updateAssemblyParameterValues(original, first.id, { 'side-length': 450 }), first.id, { color: '#91a7b2' })
      const file = createAssemblyFile(configured, first.id)
      const imported = insertAssemblyDefinition({ version: 1, name: 'New project', panels: [], connections: [] }, parseAssemblyFile(file))
      const instance = imported.assemblies!.instances[0]
      const joined = attachedGuideCopy(imported, instance.id)
      const newIds = Object.values(joined.assemblies!.instances[1].panelIds)
      return [scene(configured, 'Select the configured instance whose size and finish should travel.', { selected: ids(configured), labels: [{ text: '450 mm · blue finish', point: first.position }] }),
        scene(configured, 'The assembly file keeps this instance’s settings as its new defaults.', { selected: ids(configured), document: { title: 'Assembly · JSON', lines: ['450 mm default', 'Blue panel finish', 'Editable controls'] } }),
        scene(imported, 'With no selection, Import assembly places a new independent design.', { selected: ids(imported), document: { title: 'My assemblies', lines: ['Imported Cube', 'Own shared design'] } }),
        scene(joined, 'With a selected target, imported modules offer attachment previews.', { selected: ids(imported), ghost: newIds, labels: [{ text: 'Preview at a +', point: joined.assemblies!.instances[1].position }] })]
    }
    case 'assembly-edit': {
      const original = box(), p = createAssembly(original, ids(original), 'My box'), first = p.assemblies!.instances[0]
      const two = duplicateAssembly(p, first.id), partId = two.assemblies!.definitions[0].panels[0].id
      const selected = two.assemblies!.instances.map(instance => instance.panelIds[partId])
      const changed = updateAssemblyDefinition(two, first.id, { cornerRadius: 25 }, [partId])
      const independent = makeAssemblyIndependent(changed, changed.assemblies!.instances[1].id)
      return [scene(two, 'Linked instances share one source design.'),
        scene(two, 'Edit assembly opens the shared source. Select one of its panels.', { selected: [selected[0]] }),
        scene(changed, 'A source panel edit appears in every linked instance.', { selected, document: { title: 'Editing My box', lines: ['2 instances update', 'Same source panel highlighted'] } }),
        scene(independent, 'Make independent gives one instance its own source design.', { selected: Object.values(independent.assemblies!.instances[1].panelIds), document: { title: 'Independent instance', lines: ['Own design', 'Physical connections retained'] } })]
    }
    case 'connectors': {
      const p = box(), hardware = getPhysicalConnectors(p)[0].id
      const colored = editConnectors(p, [hardware], { color: '#537b89' })
      return [scene(p, 'Each visible piece of hardware has its own row in Connectors.'),
        scene(p, 'Select one connector to inspect its type and finish.', { selectedConnectors: [hardware] }),
        scene(colored, 'Connector color affects only the selected hardware.', { selectedConnectors: [hardware] }),
        scene(editConnectors(colored, [hardware], { slide: 60 }), 'Slide moves a clamp along its permitted shared edge.', { selectedConnectors: [hardware] })]
    }
    case 'review': {
      const p = createStarterProject('shelf'), resolved = resolvePanels(p), bounds = getProjectBounds(resolved)
      const center = bounds.min.map((value, i) => (value + bounds.max[i]) / 2)
      const exploded = { ...p, connections: [], panels: resolved.map(panel => ({ ...panel, position: panel.position.map((value, i) => center[i] + (value - center[i]) * 1.35) as Vec3 })) }
      return [scene(p, 'Inspect the completed build from several viewpoints.'),
        scene(p, 'Overall dimensions include panel thickness and connector gaps.', { dimensions: true, view: 'front' }),
        scene(exploded, 'Exploded view separates parts visually for inspection.', { labels: [label(p.panels[4], 'Middle shelf')] }),
        scene(p, 'Realistic preview helps you judge the build’s scale in a room.', { room: true })]
    }
    case 'save-export': {
      const p = createStarterProject('shelf')
      return [scene(p, 'Changes autosave in this browser as you work.', { document: { title: 'Saved in this browser', lines: ['Panels and joints', 'Materials and assemblies'] } }),
        scene(p, 'Export project → Project file keeps an editable backup.', { document: { title: 'Project · JSON', lines: ['Editable furniture model', 'Save a separate copy'] } }),
        scene(p, 'Parts & cutting list describes the pieces in your build.', { document: { title: 'Cutting list · CSV', lines: ['Panel · width × height × thickness', 'Connector · type × quantity'] } }),
        scene(p, 'Import beside Export project in the header restores a saved JSON build.', { document: { title: 'Import project', lines: ['Open your JSON file', 'Continue editing the model'] } })]
    }
  }
}

const cache = new Map<GuideId, GuideScene[]>()

/** Small, read-only teaching projects, created only when their guide is opened. */
export function getGuideScene(id: GuideId, step: number): GuideScene {
  let scenes = cache.get(id)
  if (!scenes) {
    scenes = buildScenes(id)
    cache.set(id, scenes)
  }
  return scenes[Math.max(0, Math.min(3, step))]
}
