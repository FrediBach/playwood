import { Vector3 } from 'three'
import type { GuideScene } from './guide-scenes'
import type { Project, Vec3 } from './types'
import { attachPanel, createPanel, createStarterProject, resolvePanels } from './model'
import { getConnectorRail } from './connector-movement'
import { getConnectStrokeCandidate } from './connect-stroke'
import { equalizePanelSizes } from './equal-panel-sizes'
import { mergePanels } from './panel-merge'
import { lockPanelSizes, setDesignConstraint } from './design-constraint-commands'
import { repairPanelOverlaps } from './panel-overlap-repair'
import { movePreviewResize, preparePreviewResize } from './preview-resize'

export type EditingGuideId = 'draw-connectors' | 'selection-stretch' | 'equal-sizes' | 'merge-panels' | 'reference-rules' | 'repair-overlaps'

const scene = (project: Project, note: string, extra: Partial<GuideScene> = {}): GuideScene => ({ project, note, selected: [], ghost: [], labels: [], ...extra })
const ids = (project: Project) => project.panels.map(panel => panel.id)
const pair = (widths: number[], centers: number[], height: number, y: number): Project => ({
  version: 1, name: 'Practice cuts', connections: [],
  panels: widths.map((width, index) => createPanel({ id: `guide-cut-${index}`, name: index ? 'Right panel' : 'Left panel', width, height, position: [centers[index], y, 0] })),
})

export function buildEditingGuideScenes(id: EditingGuideId): GuideScene[] {
  switch (id) {
    case 'draw-connectors': {
      const base = createPanel({ id: 'guide-connect-base', width: 600, height: 360, position: [0, 70, 0], rotation: [-Math.PI / 2, 0, 0] })
      const p = attachPanel({ version: 1, name: 'Practice corner', panels: [base], connections: [] }, base.id,
        createPanel({ id: 'guide-connect-side', width: 350, height: 360 }),
        { side: 'right', type: '90', offset: 0, inset: 0, flip: false, color: '#c94727', count: 2 })
      const connection = p.connections[0]
      const rail = getConnectorRail(connection, resolvePanels(p), p.connections)!
      const point = new Vector3(...rail.placements[0].position).addScaledVector(new Vector3(...rail.tangent), -rail.along[0]).toArray() as Vec3
      const result = getConnectStrokeCandidate(p, { startPanelId: connection.parentId, endPanelId: connection.childId, start: point, end: point })
      if (!result.candidate || !result.connectorId) throw new Error(`Guide connector cannot fit: ${result.reason}`)
      return [scene(p, 'The existing corner has two clamps and a clear interval between them.', { document: { title: 'Connect mode', lines: ['One piece per stroke', 'Panels stay fixed'] } }),
        scene(result.candidate, 'Only the middle connector is proposed; the panels and installed clamps remain fixed.', { selected: ids(p), ghostConnectors: [result.connectorId] }),
        scene(result.candidate, 'Releasing the valid stroke adds one physical connector in one undo step.', { selectedConnectors: [result.connectorId] }),
        scene(result.candidate, 'Two clicks or keyboard endpoints place the same piece. Escape exits Connect mode.', { selectedConnectors: [result.connectorId], document: { title: 'Choose endpoints', lines: ['Arrows: aim', 'Enter / Space: pick', 'Escape: cancel'] } })]
    }
    case 'selection-stretch': {
      const p = createStarterProject('shelf')
      const selected = p.panels.filter(panel => ['Middle shelf', 'Top shelf', 'Left upper side', 'Right upper side'].includes(panel.name)).map(panel => panel.id)
      const session = preparePreviewResize(p, { panelIds: selected })
      const handle = session?.handles.find(item => item.direction[1] > .999 && !item.blocked)
      if (!session || !handle) throw new Error('Guide upper compartment cannot stretch upward.')
      const moved = movePreviewResize(session, handle.id, 80)
      if (moved.limited) throw new Error(`Guide stretch is limited: ${moved.reason}`)
      return [scene(p, 'Select the middle and top shelves plus both upper sides; leave the lower structure outside the selection.', { selected, view: 'front' }),
        scene(p, 'The upward arrow moves the selection by lengthening its two lower connecting boards.', { selected, view: 'front', resizeHandles: [handle] }),
        scene(moved.project, 'The upper compartment rises 80 mm with unchanged cuts; only the lower uprights lengthen.', { selected, view: 'front', resizeHandles: [{ ...handle, position: handle.position.map((value, axis) => value + handle.direction[axis] * 80) as Vec3, distance: 80 }] }),
        scene(p, 'Undo restores the original lower opening and the entire connected selection.', { selected, view: 'front', document: { title: 'One gesture', lines: ['Release: save edit', 'Escape: cancel', 'Undo: restore'] } })]
    }
    case 'equal-sizes': {
      const p = pair([500, 520], [-350, 350], 300, 300)
      const equal = equalizePanelSizes(p, ids(p), 520)
      const locked = lockPanelSizes(equal, ids(equal))
      return [scene(p, 'Both boards have 300 mm cut heights and 18 mm thickness; only their widths differ.', { selected: ids(p), view: 'front', labels: [{ panelId: p.panels[0].id, text: '500 mm' }, { panelId: p.panels[1].id, text: '520 mm' }] }),
        scene(equal, 'The draft lengthens the first board to match the second; acceptance is still separate.', { ghost: [p.panels[0].id], view: 'front', document: { title: 'Shared width', lines: ['520 mm', 'Review all changes', 'Apply equal sizes'] } }),
        scene(equal, 'Both accepted widths are 520 mm. A one-time match does not add an equality rule.', { selected: ids(equal), view: 'front' }),
        scene(locked, 'Lock panel size adds a width rule and a height rule for each selected board.', { selected: ids(locked), view: 'front', document: { title: '4 size rules', lines: ['Width: 520 mm', 'Height: 300 mm', 'Pause to unlock'] } })]
    }
    case 'merge-panels': {
      const p = pair([300, 300], [0, 335], 300, 300), merged = mergePanels(p, ids(p))
      return [scene(p, 'Two aligned 300 mm cuts leave a 35 mm gap inside a 635 mm outside envelope.', { view: 'front', dimensions: true }),
        scene(p, 'Select the left panel first to retain its name and identity in the merged board.', { selected: ids(p), view: 'front' }),
        scene(merged, 'Merge fills the gap and retains both outside edges without moving other parts.', { selected: ids(merged), view: 'front', dimensions: true }),
        scene(merged, 'The parts list now contains one continuous cut. Undo restores the two original boards.', { view: 'front', document: { title: 'Combined cut', lines: ['Left panel', '635 × 300 × 18 mm', '1 board'] } })]
    }
    case 'reference-rules': {
      const p: Project = { version: 1, name: 'Reference panels', connections: [], panels: [-400, 0, 400].map((x, index) =>
        createPanel({ id: `guide-reference-${index}`, name: ['Left', 'Divider', 'Right'][index], width: 300, height: 600, position: [x, 300, 0], rotation: [0, Math.PI / 2, 0] })) }
      const [left, divider, right] = ids(p)
      const fixed = setDesignConstraint(p, { id: 'guide-fixed', kind: 'position', enabled: true, panelId: left, axis: 'x', reference: 'center', value: -400 })
      const aligned = setDesignConstraint(fixed, { id: 'guide-setback', kind: 'setback', enabled: true, panelIds: [left, divider], axis: 'z', references: ['min', 'min'], value: 0 })
      const openings = setDesignConstraint(aligned, { id: 'guide-openings', kind: 'opening-ratio', enabled: true, panelIds: [left, divider, divider, right], axis: 'x', ratio: 1 })
      return [scene(fixed, 'The left board’s center is anchored at world X −400 mm.', { selected: [left], document: { title: 'Fixed reference', lines: ['Horizontal · X', 'Center: −400 mm'] } }),
        scene(aligned, 'Both back edges sit at Z −150 mm, so their signed setback is zero.', { selected: [left, divider], alignment: [[[-400, 600, -150], [0, 600, -150]]], document: { title: 'Back-edge setback', lines: ['Second minus first', '0 mm = aligned'] } }),
        scene(openings, 'The 18 mm divider leaves equal 382 mm clear openings on its two sides.', { alignment: [[[-391, 300, 0], [-9, 300, 0]], [[9, 300, 0], [391, 300, 0]]], document: { title: 'Opening ratio', lines: ['First: 382 mm', 'Second: 382 mm', 'Ratio: 1'] } }),
        scene(openings, 'All constraints connects the saved references to measurements on the same panels.', { document: { title: '3 saved rules', lines: ['Fixed X center', 'Aligned back edges', 'Equal clear openings'] } })]
    }
    case 'repair-overlaps': {
      const p = pair([200, 200], [0, 190], 200, 200), repaired = repairPanelOverlaps(p, p.panels[0].id)
      const changed = repaired.panels.filter((panel, index) => JSON.stringify(panel) !== JSON.stringify(p.panels[index])).map(panel => panel.id)
      return [scene(p, 'The boards overlap by 10 mm; the panel list identifies this pair for review.', { selected: ids(p), view: 'front' }),
        scene(repaired, 'The candidate separates the boards. Review changed cuts and positions before accepting.', { ghost: changed, view: 'front', document: { title: 'Fix panel overlaps', lines: ['Review changes', 'Apply automatic fix', 'Cancel'] } }),
        scene(repaired, 'The accepted repair removes the overlap and preserves both panel identities.', { selected: changed, view: 'front' }),
        scene(repaired, 'Inspect the repaired geometry from another view and check the remaining parts-list issues.', { dimensions: true })]
    }
  }
}
