import type { GuideId } from './build-guide-types'
import type { AttachmentOptions, Panel, Project, Vec3 } from './types'
import { attachPanel, createPanel, createStarterProject, getProjectBounds, resolvePanels, rotateProject } from './model'
import { gridProject } from './example-geometry'
import { autoConnect } from './auto-connect'
import { closePanelHole, findPanelHoles } from './close-holes'
import { splitParallelPanels } from './parallel-panels'
import { createAssembly, disconnectAssembly, duplicateAssembly, getAssemblyAttachmentTargets, makeAssemblyIndependent, updateAssemblyDefinition, updateAssemblyFinish, updateAssemblyParameterValues } from './assemblies'
import { ASSEMBLY_LIBRARY, insertAssemblyDefinition } from './assembly-library'
import { createAssemblyFile, parseAssemblyFile } from './assembly-file'
import { movePanels, resizePanels } from './structure-edit'
import { rotateSelection } from './selection-rotation'
import { editConnectors, getPhysicalConnectors } from './connector-selection'

export interface GuideScene {
  project: Project
  selected: string[]
  ghost: string[]
  labels: { text: string; panelId?: string; point?: Vec3 }[]
  note: string
  view?: 'front' | 'side' | 'top'
  dimensions?: boolean
  selectedConnectors?: string[]
  outlinePoints?: boolean
  room?: boolean
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
const finish = (project: Project, selected: string[], color: string): Project => ({ ...project, panels: project.panels.map(panel => selected.includes(panel.id) ? { ...panel, color } : panel) })

function buildScenes(id: GuideId): GuideScene[] {
  switch (id) {
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
    case 'close-hole': {
      const p = box(), hole = findPanelHoles(resolvePanels(p)).find(item => item.label === 'Back')!
      const closed = closePanelHole(p, ids(p), hole.id)
      const preview = { ...p, panels: [...p.panels, hole.panel] }
      return [scene(p, 'Four panels enclose a rectangular opening.', { labels: [{ text: 'Open back', point: [0, 201.5, -175] }] }),
        scene(p, 'Select the complete frame around the opening.', { selected: ids(p) }),
        scene(preview, 'Choose Back to close the rear face of this box.', { ghost: [hole.panel.id], labels: [label(hole.panel, 'Fitted back panel')] }),
        scene(closed.project, 'The closing panel and compatible hardware are added together.', { selected: [closed.panelId], labels: [label(closed.project.panels.find(panel => panel.id === closed.panelId)!, 'Back closed')] })]
    }
    case 'split-panels': {
      const p = box()
      const pair = p.panels.filter(panel => panel.name.startsWith('Shelf'))
      const result = splitParallelPanels(p, pair.map(panel => panel.id))
      const added = result.project.panels.filter(panel => !ids(p).includes(panel.id))
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
      const wider = resizePanels(p, [top.id], { width: 450 })
      const taller = movePanels(wider, [top.id], [0, 100, 0])
      return [scene(p, 'Select the top panel to edit its cut dimensions.', { selected: [top.id], dimensions: true, labels: [label(top, 'Width: 350 mm')] }),
        scene(wider, 'Changing the top width adjusts the connected frame.', { selected: [top.id], dimensions: true, labels: [label(top, 'Width: 450 mm')] }),
        scene(taller, 'Moving the top upward extends its connected side panels.', { selected: [top.id], dimensions: true, labels: [label(top, 'Moved up 100 mm')] }),
        scene(taller, 'The resized frame keeps its joints aligned. Undo lets you compare.', { selected: [top.id], dimensions: true, view: 'side' })]
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
        scene(pasted, 'Hover or focus a + to preview the copied panel.', { selected: [parent.id], ghost: ['guide-copy'], labels: [label(pasted.panels[2], 'Paste preview at +')] }),
        scene(pasted, 'Click the + to commit the copy and its connection.', { selected: ['guide-copy'], labels: [label(pasted.panels[2], 'New independent panel')] })]
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
        scene(duplicated, 'Duplicate creates another instance of the same source design.', { selected: ids(duplicated).filter(panelId => !ids(p).includes(panelId)), document: { title: 'My box', lines: ['One shared design', 'Two linked instances'] } })]
    }
    case 'assembly-attach': {
      const original = box(), p = createAssembly(original, ids(original), 'My box'), first = p.assemblies!.instances[0]
      const joined = getAssemblyAttachmentTargets(p, first.id).find(target => target.label === 'Top right' && target.project)!.project!
      const copy = joined.assemblies!.instances[1], copyIds = Object.values(copy.panelIds)
      return [scene(p, 'Select a whole instance to build outward from its corners.', { selected: ids(p) }),
        scene(joined, 'Attach a copy previews a second instance at a compatible +.', { selected: ids(p), ghost: copyIds, labels: [{ text: 'Copy preview', point: copy.position }] }),
        scene(joined, 'A shared corner replaces the original hardware with cross connectors.', { selected: copyIds }),
        scene(disconnectAssembly(joined, copy.id), 'Disconnect from neighbors separates the copy while keeping its source link.', { selected: copyIds })]
    }
    case 'assembly-values': {
      const p = ASSEMBLY_LIBRARY.find(example => example.id === 'assembly-cube')!.create(), instance = p.assemblies!.instances[0]
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
      const original = ASSEMBLY_LIBRARY.find(example => example.id === 'assembly-cube')!.create(), first = original.assemblies!.instances[0]
      const configured = updateAssemblyFinish(updateAssemblyParameterValues(original, first.id, { 'side-length': 450 }), first.id, { color: '#91a7b2' })
      const file = createAssemblyFile(configured, first.id)
      const imported = insertAssemblyDefinition({ version: 1, name: 'New project', panels: [], connections: [] }, parseAssemblyFile(file))
      const instance = imported.assemblies!.instances[0]
      const joined = getAssemblyAttachmentTargets(imported, instance.id).find(target => target.label === 'Top right' && target.project)!.project!
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
        scene(p, 'Import project restores a saved JSON build.', { document: { title: 'Import project', lines: ['Open your JSON file', 'Continue editing the model'] } })]
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
