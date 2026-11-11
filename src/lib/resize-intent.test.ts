import { describe, expect, it } from 'vitest'
import { createAssembly } from './assemblies'
import { synthShelfProject } from './synth-shelf'
import { createResizeIntent, acceptResizeResult, unwrapResizeResult } from './resize-intent'
import { solveResizeIntent, resizePanels, resizePanelEdge, resizePanelEdges, resizePanelDimensions, StructureEditError } from './structure-edit'
import { attachPanel, createPanel, resolvePanels } from './model'
import { inspectResizeAnalysis } from './resize-analysis'
import { resizeIntentCorpus, targetPanel } from '../test/resize-intent-corpus'
import type { Project } from './types'

function corner(type: '90' | 't' | 'cross' = '90'): Project {
  const parent = createPanel({ id: 'parent', width: 400, height: 400, position: [0, 800, 0] })
  return attachPanel({ version: 1, name: 'Adapter corner', panels: [parent], connections: [] }, parent.id,
    createPanel({ id: 'child', width: 400, height: 400 }),
    { type, side: 'right', offset: 0, inset: 0, flip: false, count: 2, color: '#292b27' })
}

describe('resize request adapters preserve the stage 0 behavior', () => {
  for (const scenario of resizeIntentCorpus) it(scenario.id, () => {
    const source = scenario.source(), before = structuredClone(source), panel = targetPanel(source, scenario)
    const intent = createResizeIntent(source, scenario.operation === 'numeric'
      ? { kind: 'selection-dimensions', panelIds: [panel.id], dimensions: { [scenario.target.dimension]: scenario.target.value } }
      : { kind: 'panel-edge', edge: { panelId: panel.id, dimension: scenario.target.dimension, side: 1,
        distance: scenario.target.value - panel[scenario.target.dimension] }, local: scenario.operation === 'local-edge' })
    const result = solveResizeIntent(intent, { inspect: true })
    const direct = () => scenario.operation === 'numeric'
      ? resizePanels(source, [panel.id], { [scenario.target.dimension]: scenario.target.value })
      : resizePanelEdge(source, panel.id, scenario.target.dimension, 1, scenario.target.value - panel[scenario.target.dimension], scenario.operation === 'local-edge')
    if (scenario.current.rejected) {
      expect(result.status).not.toBe('solved')
      if (result.status === 'solved') throw new Error('Expected rejection')
      expect(direct).toThrow(result.diagnostic.message)
      expect(() => unwrapResizeResult(result)).toThrow(result.error as Error)
      if (scenario.id === 'stock-limit') expect(result.status).toBe('invalid-request')
      else {
        expect(result.error).toBeInstanceOf(StructureEditError)
        // The iterative solver has not certified that the authored rules conflict.
        expect(result.status).toBe('numerical-failure')
        expect(result.diagnostic.numerical?.termination).toBe('residual-check-failed')
      }
    } else {
      expect(result.status).toBe('solved')
      const candidate = unwrapResizeResult(result)
      expect(candidate).toEqual(direct())
      expect(acceptResizeResult(source, result)).toBe(candidate)
      expect(result.problems.length).toBeGreaterThan(0)
      expect(JSON.stringify(candidate)).not.toContain('selected-average-per-component-preference')
    }
    expect(result.analysis?.source).toBe(source)
    expect(result.analysis?.panels.map(item => item.id)).toEqual(source.panels.map(item => item.id))
    expect(source).toEqual(before)
  })
})

it('keeps the selected average center, allowing individual centers to move', () => {
  const source = corner(), before = resolvePanels(source), ids = before.map(panel => panel.id)
  const intent = createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ids, dimensions: { width: 500 } })
  const result = solveResizeIntent(intent, { inspect: true }), after = resolvePanels(unwrapResizeResult(result))
  for (let axis = 0; axis < 3; axis++) expect(after.reduce((sum, panel) => sum + panel.position[axis], 0))
    .toBeCloseTo(before.reduce((sum, panel) => sum + panel.position[axis], 0), 5)
  expect(after.every(panel => panel.width === 500)).toBe(true)
  expect(after.some((panel, index) => Math.abs(panel.position[0] - before[index].position[0]) > 1)).toBe(true)
  const anchors = result.problems[0].rows.filter(row => row.provenance.kind === 'placement-preference')
  expect(anchors).toHaveLength(3)
  expect(anchors.every(row => row.provenance.panelIds?.length === 2)).toBe(true)
})

it('preserves independent component centers for numeric multiselection', () => {
  const source: Project = { version: 1, name: 'Separate panels', connections: [], panels: [
    createPanel({ id: 'a', width: 400, position: [-1000, 800, 0] }), createPanel({ id: 'b', width: 600, position: [1000, 800, 0] }),
  ] }
  const result = solveResizeIntent(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['a', 'b'], dimensions: { width: 500 } }), { inspect: true })
  expect(result.problems).toHaveLength(2)
  unwrapResizeResult(result).panels.forEach((panel, index) => expect(panel.position).toEqual(source.panels[index].position))
})

it('preserves simultaneous mixed-axis/thickness targets and the assembly validation context', () => {
  const source = corner(), patches = { parent: { width: 500, thickness: 19 }, child: { width: 450, thickness: 19 } }
  const intent = createResizeIntent(source, { kind: 'panel-dimensions', patches }, { origin: 'assembly-parameters', trofastWorld: false })
  const result = solveResizeIntent(intent, { inspect: true }), project = unwrapResizeResult(result)
  expect(project).toEqual(resizePanelDimensions(source, patches, { trofastWorld: false }))
  expect(intent.validation.trofastWorld).toBe(false)
  expect(project.panels[0].width).toBe(500)
  expect(project.panels[1].width).toBe(450)
  expect(project.panels.map(panel => panel.thickness)).toEqual([19, 19])
  // Unspecified cuts in per-panel targets stay free of explicit target rows.
  const targets = result.problems[0].rows.filter(row => row.provenance.kind === 'target')
  expect(targets).toHaveLength(2)
})

it('carries simultaneous opposite-edge anchors and local scope through the rim adapter', () => {
  const source: Project = { version: 1, name: 'Rims', connections: [], panels: [
    createPanel({ id: 'a', width: 400, position: [-1000, 800, 0] }), createPanel({ id: 'b', width: 400, position: [1000, 800, 0] }),
  ] }
  const edges = [{ panelId: 'a', dimension: 'width' as const, side: 1 as const, distance: 100 },
    { panelId: 'b', dimension: 'width' as const, side: -1 as const, distance: 50 }]
  const intent = createResizeIntent(source, { kind: 'panel-edges', edges, refitOutlinePanelIds: [] })
  const result = solveResizeIntent(intent, { inspect: true }), next = unwrapResizeResult(result)
  expect(next).toEqual(resizePanelEdges(source, edges))
  expect(next.panels.map(panel => panel.position[0])).toEqual([-950, 975])
  expect(intent.anchor).toBe('exact-opposite-edges')
  expect(intent.hardware).toBe('fixed-world-positions')
  expect(createResizeIntent(source, { kind: 'panel-edges', edges, refitOutlinePanelIds: ['cap'] }).hardware).toBe('fixed-except-refitted-outlines')
  expect(result.problems.flatMap(problem => problem.rows).filter(row => row.provenance.kind === 'anchor')).toHaveLength(6)
})

it('snapshots request drafts and rejects stale source/session acceptance', () => {
  const source = corner(), dimensions = { width: 500 }, ids = ['parent'], session = { id: 'gesture', revision: 2 }
  const intent = createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ids, dimensions }, { session })
  dimensions.width = 800; ids.push('child'); session.revision++
  const result = solveResizeIntent(intent), next = unwrapResizeResult(result)
  expect(next.panels[0].width).toBe(500)
  expect(Object.isFrozen(source)).toBe(false)
  expect(acceptResizeResult(source, result, { id: 'gesture', revision: 2 })).toBe(next)
  expect(() => acceptResizeResult({ ...source }, result, { id: 'gesture', revision: 2 })).toThrow(/changed/)
  expect(() => acceptResizeResult(source, result, session)).toThrow(/changed/)
  expect(() => acceptResizeResult(source, result)).toThrow(/changed/)
  const unsupported = solveResizeIntent({ ...intent, anchor: 'exact-opposite-edge' })
  expect(unsupported.status).toBe('invalid-request')
})

it('retains no-op identity and existing missing-target behavior', () => {
  const source = corner()
  expect(resizePanels(source, ['parent'], { width: 400 })).toBe(source)
  expect(resizePanels(source, ['missing'], { width: 500 })).toBe(source)
  expect(resizePanelEdge(source, 'missing', 'width', 1, 10)).toBe(source)
  expect(resizePanelEdge(source, 'parent', 'width', 1, 0)).toBe(source)
  expect(resizePanelDimensions(source, {})).toBe(source)
  expect(resizePanelEdges(source, [])).toBe(source)
  expect(() => resizePanelDimensions(source, { missing: { width: 500 } })).toThrow(/missing panel/)
  expect(() => resizePanels(source, [], { width: NaN })).toThrow(/size limits/)
  expect(() => resizePanelEdge(source, 'missing', 'width', 1, NaN)).toThrow(/finite/)
})

it('separates authored, physical, inferred, stock, target and preference provenance', () => {
  const source = resizeIntentCorpus.find(item => item.id === 'locked-child')!.source()
  const result = solveResizeIntent(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['parent'], dimensions: { height: 500 } }), { inspect: true })
  const rows = result.problems.flatMap(problem => [...problem.rows, ...problem.bounds])
  expect(new Set(rows.map(row => row.provenance.kind))).toEqual(new Set(['authored-rule', 'stock-bound', 'joint', 'inferred', 'cut-preference', 'target', 'placement-preference']))
  expect(rows.find(row => row.provenance.kind === 'authored-rule')?.provenance.ruleId).toBe('child-lock')
  const inferred = rows.filter(row => row.provenance.kind === 'inferred')
  expect(inferred).toHaveLength(2)
  expect(inferred.every(row => row.relationship?.kind === 'setback' && row.relationship.description.includes('preserve setback'))).toBe(true)
  expect(rows.filter(row => row.provenance.kind === 'joint').every(row => row.provenance.connectionId === source.connections[0].id)).toBe(true)
})

it('keeps detected contacts protected and excludes removed hardware from analysis', () => {
  const source = resizeIntentCorpus.find(item => item.id === 'occupancy-320.01')!.source()
  const result = solveResizeIntent(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['support'], dimensions: { width: 500 } }), { inspect: true })
  expect(result.status).toBe('solved')
  expect(result.analysis?.contacts).toHaveLength(1)
  expect(result.analysis?.contacts[0].protected).toBe(true)
  expect(result.problems[0].rows.some(row => row.provenance.kind === 'protected-contact')).toBe(true)
  expect(result.problems[0].rows.some(row => row.relationship?.kind === 'compartment-fit')).toBe(true)
  const joint = corner('cross'), first = inspectResizeAnalysis(joint)
  const removed = { ...joint, connectorOverrides: { [first.installedConnectorIds[0]]: { removed: true } } }
  const analysis = inspectResizeAnalysis(removed)
  expect(analysis.joints).toHaveLength(1)
  expect(analysis.joints[0].connectionIds).toHaveLength(3)
  expect(analysis.joints[0].panelIds).toHaveLength(4)
  expect(analysis.installedConnectorIds).not.toContain(first.installedConnectorIds[0])
  expect(Object.isFrozen(analysis.panels[0].position)).toBe(true)
})


it('retains assembly ownership rejection and reports it separately from numerical failure', () => {
  const loose = corner(), source = createAssembly(loose, loose.panels.map(panel => panel.id), 'Corner')
  const result = solveResizeIntent(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: [source.panels[0].id], dimensions: { width: 500 } }), { inspect: true })
  expect(result.status).toBe('rejected')
  if (result.status === 'solved') throw new Error('Expected ownership rejection')
  expect(result.diagnostic.message).toMatch(/assembly source/)
  expect(result.analysis?.ownership[0].panelIds).toEqual(Object.values(source.assemblies!.instances[0].panelIds))
  expect(result.problems).toEqual([])
})

it('classifies post-solve hardware crowding as an invalid candidate and retains the source', () => {
  const source = synthShelfProject(), before = structuredClone(source)
  const result = solveResizeIntent(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: [source.panels[0].id], dimensions: { width: 200 } }))
  expect(result.status).toBe('candidate-invalid')
  if (result.status === 'solved') throw new Error('Expected hardware rejection')
  expect(result.diagnostic.message).toMatch(/crowd connectors/)
  expect(result.analysis).toBeUndefined()
  expect(result.problems).toEqual([])
  expect(source).toEqual(before)
})


it('classifies a later component compilation failure without exposing the earlier partial candidate', () => {
  const source: Project = { version: 1, name: 'Independent components', connections: [], panels: [
    createPanel({ id: 'plain', width: 400, position: [-1000, 800, 0] }),
    createPanel({ id: 'angled', width: 400, position: [1000, 800, 0], rotation: [0, 0, 0.2] }),
  ], constraints: [{ id: 'unsupported-floor', kind: 'floor', enabled: true, panelId: 'angled', reference: 'min', value: 0 }] }
  const before = structuredClone(source)
  const result = solveResizeIntent(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['plain', 'angled'], dimensions: { width: 500 } }))
  expect(result.status).toBe('rejected')
  if (result.status === 'solved') throw new Error('Expected rule compilation rejection')
  expect(result.diagnostic.message).toMatch(/aligned with the world axes/)
  expect(source).toEqual(before)
  expect(() => unwrapResizeResult(result)).toThrow(result.error as Error)
})
