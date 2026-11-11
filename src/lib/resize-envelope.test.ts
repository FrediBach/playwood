import { describe, expect, it } from 'vitest'
import { createAssembly } from './assemblies'
import { createPanel, createStarterProject, getProjectBounds, resolvePanels, rotateProject, validateProject } from './model'
import { createResizeIntent, unwrapResizeResult, type PanelResizeDimensions } from './resize-intent'
import { createResizePlacementIntent } from './resize-placement'
import { assertCompiledResizeEnvelope, createResizeEnvelopeCandidate } from './resize-envelope'
import { resizePanelDimensions, solveResizeIntent } from './structure-edit'
import type { Project } from './types'

function boundaries(source: Project) {
  const panels = resolvePanels(source), placement = createResizePlacementIntent(source, 'world')
  return ([0, 1, 2] as const).flatMap(axis => {
    if (placement.references[axis] === 'authored') return []
    const ordered = (side: 'min' | 'max') => [...panels].sort((a, b) => getProjectBounds([a])[side][axis] - getProjectBounds([b])[side][axis])
    return [{ axis, minPanelId: ordered('min')[0].id,
      ...(placement.references[axis] === 'center' ? { maxPanelId: ordered('max').at(-1)!.id } : {}) }]
  })
}
function request(source: Project, patches: Record<string, PanelResizeDimensions>, selected = boundaries(source), local = false) {
  const envelope = createResizeEnvelopeCandidate(createResizePlacementIntent(source, local ? 'assembly-local' : 'world'), selected)
  return createResizeIntent(source, { kind: 'panel-dimensions', patches }, { origin: local ? 'assembly-parameters' : 'project-rescale', envelope, trofastWorld: !local })
}
const pair = (): Project => ({ version: 1, name: 'Two cuts', connections: [], panels: [
  createPanel({ id: 'a', width: 200, height: 200, position: [-400, 200, 0] }),
  createPanel({ id: 'b', width: 200, height: 200, position: [400, 400, 0] }),
] })

describe('explicit compiled resize envelopes', () => {
  it.each([0, 27, 90])('solves world grounding and centering with rotation %i and prescribed thickness', angle => {
    const panel = createPanel({ id: 'panel', width: 400, height: 200, position: [100, 600, -80] })
    const source = rotateProject({ version: 1, name: 'Rotated', panels: [panel], connections: [] }, 'z', angle)
    const saved = structuredClone(source)
    const intent = request(source, { panel: { width: 500, height: 300, thickness: 30 } })
    const result = solveResizeIntent(intent, { inspect: true })
    const next = unwrapResizeResult(result)
    expect(next.panels[0]).toMatchObject({ width: 500, height: 300, thickness: 30 })
    expect(() => assertCompiledResizeEnvelope(intent.envelope!, next)).not.toThrow()
    expect(result.problems[0].rows.filter(row => row.provenance.kind === 'anchor')).toHaveLength(3)
    expect(validateProject(next)).toEqual([])
    expect(source).toEqual(saved)
  })

  it('couples disconnected components and enforces all nominated-extremum inequalities', () => {
    const source = pair(), selected = boundaries(source)
    selected.find(boundary => boundary.axis === 1)!.minPanelId = 'b'
    const intent = request(source, { a: { height: 1000 }, b: { height: 1000 } }, selected)
    const result = solveResizeIntent(intent, { inspect: true }), next = unwrapResizeResult(result)
    const before = getProjectBounds(source.panels), after = getProjectBounds(resolvePanels(next))
    expect(after.min[1]).toBeCloseTo(before.min[1], 5)
    // Without the extremum inequality, a's unconstrained bottom would fall below b.
    expect(getProjectBounds([next.panels[0]]).min[1]).toBeGreaterThanOrEqual(before.min[1] - 1e-4)
    expect(getProjectBounds([next.panels[1]]).min[1]).toBeCloseTo(before.min[1], 5)
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0].bounds.filter(row => row.provenance.kind === 'anchor')).toHaveLength(5)
    expect(validateProject(next)).toEqual([])
  })

  it('uses the original envelope once across a connected shelf and preserves joints and IDs', () => {
    const source = createStarterProject(), saved = structuredClone(source)
    const patches = Object.fromEntries(source.panels.map(panel => [panel.id, { height: panel.height + 40 }]))
    const intent = request(source, patches), next = unwrapResizeResult(solveResizeIntent(intent))
    expect(() => assertCompiledResizeEnvelope(intent.envelope!, next)).not.toThrow()
    expect(next.connections.map(connection => connection.id)).toEqual(source.connections.map(connection => connection.id))
    expect(next.panels.map(panel => panel.id)).toEqual(source.panels.map(panel => panel.id))
    expect(validateProject(next)).toEqual([])
    expect(source).toEqual(saved)
  })

  it('leaves authored axes under their saved position rules', () => {
    const source = pair()
    source.constraints = [{ id: 'x', kind: 'position', enabled: true, panelId: 'a', axis: 'x', reference: 'min', value: -500 }]
    const intent = request(source, { a: { width: 400 }, b: { width: 400 } })
    expect(intent.envelope!.boundaries.map(boundary => boundary.axis)).toEqual([1, 2])
    const next = unwrapResizeResult(solveResizeIntent(intent))
    expect(getProjectBounds([next.panels[0]]).min[0]).toBeCloseTo(-500, 5)
    expect(validateProject(next)).toEqual([])
  })

  it('supports isolated source-local coordinates without grounding a world assembly', () => {
    const source = pair(), intent = request(source, { a: { height: 300 } }, boundaries(source), true)
    expect(() => assertCompiledResizeEnvelope(intent.envelope!, unwrapResizeResult(solveResizeIntent(intent)))).not.toThrow()
    const base = createStarterProject(), assembly = createAssembly(base, base.panels.map(panel => panel.id), 'Shelf')
    expect(() => request(assembly, {})).toThrow(/assembly ownership/)
  })

  it('rejects stale snapshots, incomplete boundary sets and gesture use', () => {
    const source = pair(), intent = request(source, { a: { height: 300 } })
    expect(solveResizeIntent({ ...intent, source: structuredClone(source) })).toMatchObject({ status: 'invalid-request' })
    expect(() => request(source, {}, boundaries(source).slice(1))).toThrow(/Every default/)
    const gesture = createResizeIntent(source, { kind: 'panel-edge', edge: { panelId: 'a', dimension: 'height', side: 1, distance: 100 }, local: false }, { envelope: intent.envelope })
    expect(solveResizeIntent(gesture)).toMatchObject({ status: 'invalid-request' })
  })

  it('keeps candidate definitions immutable and rejects final geometry outside the nominated envelope', () => {
    const source = pair(), selected = boundaries(source), intent = request(source, { a: { height: 300 } }, selected)
    const next = unwrapResizeResult(solveResizeIntent(intent))
    selected[0].minPanelId = 'missing'
    expect(intent.envelope!.boundaries[0].minPanelId).toBe('a')
    const swapped = { ...next, panels: next.panels.map(panel => ({ ...panel, position: [ -panel.position[0], panel.position[1], panel.position[2] ] as [number, number, number] })) }
    // The outside center/base stay the same, but a/b swap their nominated X faces.
    expect(() => assertCompiledResizeEnvelope(intent.envelope!, swapped)).toThrow(/nominated envelope/)
  })

  it('rejects an impossible boundary nomination instead of releasing the anchor', () => {
    const source = pair()
    source.constraints = [{ id: 'gap', kind: 'gap', enabled: true, panelIds: ['a', 'b'], axis: 'x', relation: 'exact', value: 600 }]
    const saved = structuredClone(source), selected = boundaries(source)
    selected[0] = { axis: 0, minPanelId: 'b', maxPanelId: 'a' }
    const result = solveResizeIntent(request(source, { a: { width: 400 }, b: { width: 400 } }, selected))
    expect(result.status).not.toBe('solved')
    expect(source).toEqual(saved)
    expect(solveResizeIntent(request(source, { a: { width: 400 }, b: { width: 400 } })).status).toBe('solved')
  })

  it('rejects a grounded candidate that exceeds build space without translating away the anchor', () => {
    const source: Project = { version: 1, name: 'Elevated', panels: [createPanel({ id: 'a', width: 400, height: 200, position: [0, 900, 0] })], connections: [],
      spaceConstraint: { enabled: true, width: 1000, depth: 1000, height: 1100, centerX: 0, centerZ: 0 } }
    const saved = structuredClone(source)
    expect(validateProject(source)).toEqual([])
    expect(solveResizeIntent(request(source, { a: { height: 600 } }))).toMatchObject({ status: 'candidate-invalid' })
    expect(source).toEqual(saved)
  })

  it('keeps unrelated imported rule violations untouched when every axis is authored', () => {
    const source = pair()
    source.constraints = (['x', 'y', 'z'] as const).map(axis => ({ id: axis, kind: 'position' as const, enabled: true,
      panelId: 'a', axis, reference: 'center' as const, value: 0 }))
    const intent = request(source, { b: { width: 300 } })
    expect(intent.envelope!.boundaries).toEqual([])
    const next = unwrapResizeResult(solveResizeIntent(intent))
    expect(next.panels[0]).toEqual(source.panels[0])
    expect(next.panels[1].width).toBeCloseTo(300)
  })

  it('leaves ordinary simultaneous resizing on its established center policy', () => {
    const source: Project = { version: 1, name: 'Ordinary', panels: [createPanel({ id: 'a', height: 200, position: [0, 400, 0] })], connections: [] }
    const ordinary = resizePanelDimensions(source, { a: { height: 400 } })
    const compiled = unwrapResizeResult(solveResizeIntent(request(source, { a: { height: 400 } })))
    expect(ordinary.panels[0].position[1]).toBeCloseTo(400)
    expect(compiled.panels[0].position[1]).toBeCloseTo(500)
  })
})
