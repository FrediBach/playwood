import { writeFileSync } from 'node:fs'
import { getPhysicalConnectors } from './connector-selection'
import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { resizeIntentCorpus, targetPanel } from '../test/resize-intent-corpus'
import { createResizeIntent } from './resize-intent'
import { planResizeShadow } from './resize-planner'
import { analyzeResizeEvidence } from './resize-evidence'
import { attachPanel, createPanel, resolvePanels, validateProject } from './model'
import type { Project } from './types'

const scenario = (id: string) => resizeIntentCorpus.find(item => item.id === id)!
function run(id: string, reverse = false) {
  const item = scenario(id), source = item.source()
  if (reverse) { source.panels.reverse(); source.connections.reverse(); source.constraints?.reverse() }
  const intent = createResizeIntent(source, { kind: 'selection-dimensions', panelIds: [targetPanel(source, item).id], dimensions: { [item.target.dimension]: item.target.value } })
  return planResizeShadow(intent)
}

describe('shadow numeric resize planner', () => {
  it.each(['overlap-199.99', 'overlap-200', 'overlap-200.01', 'occupancy-319.99', 'occupancy-320', 'occupancy-320.01', 'setback-139.99', 'setback-140.01'])('%s retains fixed and fitted interpretations across legacy thresholds', id => {
    const result = run(id)
    expect(result.status).toBe('complete')
    expect(result.candidates.map(c => c.interpretation)).toContain('fitted-clearances')
    expect(result.candidates[0].interpretation).not.toBe('fitted-clearances')
    if (id.startsWith('setback-')) expect(result.candidates[0].interpretation).toBe('positive-end')
    expect(result.ambiguous).toBe(true)
    expect(result.numericalSolves).toBeLessThanOrEqual(32)
    const item = scenario(id), target = targetPanel(result.source, item)
    for (const candidate of result.candidates) {
      expect(resolvePanels(candidate.project).find(p => p.id === target.id)![item.target.dimension]).toBeCloseTo(item.target.value, 4)
      expect(validateProject(candidate.project).filter(issue => !validateProject(result.source).some(old => old.id === issue.id))).toEqual([])
      expect(candidate.explanations.length).toBeGreaterThan(0)
    }
    const reversed = run(id, true)
    expect(reversed.candidates.map(c => c.interpretation)).toEqual(result.candidates.map(c => c.interpretation))
    expect(reversed.candidates.map(c => c.score)).toEqual(result.candidates.map(c => c.score))
  })
  it('retains both locked-child end options, never softening the authored lock', () => {
    const result = run('locked-child')
    expect(result.legacy.status).not.toBe('solved')
    expect(result.candidates.map(c => c.interpretation)).toEqual(expect.arrayContaining(['negative-end', 'positive-end']))
    expect(result.attempts.find(a => a.interpretation === 'fitted-clearances')!.status).not.toBe('solved')
    for (const candidate of result.candidates) expect(candidate.project.panels.find(p => p.id === 'child')!.height).toBeCloseTo(300, 4)
  })
  it.each(['stock-limit', 'locked-target'])('%s never offers an invalid candidate', id => {
    expect(run(id).candidates).toEqual([])
  })
  it('keeps an unrelated equal numeric cut and source untouched', () => {
    const source = scenario('unrelated-equal-cut').source(), before = JSON.stringify(source)
    const result = planResizeShadow(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['parent'], dimensions: { height: 500 } }))
    for (const candidate of result.candidates) expect(candidate.project.panels.find(p => p.id === 'peer')).toEqual(result.source.panels.find(p => p.id === 'peer'))
    expect(JSON.stringify(result.source)).toBe(before)
    expect(Object.isFrozen(result.analysis.evidence)).toBe(true)
    expect(Object.isFrozen(result.source)).toBe(false)
  })
  it('carries the real angled trays and stoppers with unchanged cuts', () => {
    const result = run('angled-trays')
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.analysis.sections).toHaveLength(3)
    const before = new Map(resolvePanels(result.source).map(panel => [panel.id, panel]))
    const allowed = new Set(scenario('angled-trays').allowedAdaptingCuts)
    for (const candidate of result.candidates) {
      const after = new Map(resolvePanels(candidate.project).map(panel => [panel.id, panel]))
      for (const panel of after.values()) for (const dimension of ['width', 'height'] as const) {
        if (!allowed.has(`${panel.name}.${dimension}`)) expect(panel[dimension]).toBeCloseTo(before.get(panel.id)![dimension], 4)
      }
      for (const section of result.analysis.sections) {
        const deltas = section.panelIds.map(id => after.get(id)!.position.map((value, axis) => value - before.get(id)!.position[axis]))
        for (const delta of deltas) delta.forEach((value, axis) => expect(value).toBeCloseTo(deltas[0][axis], 4))
      }
    }
    const reversed = run('angled-trays', true)
    expect(reversed.candidates.map(c => c.score)).toEqual(result.candidates.map(c => c.score))
  })
  it('reports budget exhaustion separately, including zero budget', () => {
    const item = scenario('overlap-200'), source = item.source()
    const intent = createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['parent'], dimensions: { height: 500 } })
    const zero = planResizeShadow(intent, { maxSolves: 0 })
    expect(zero.status).toBe('search-budget-exhausted')
    expect(zero.candidates).toEqual([])
    expect(zero.numericalSolves).toBe(0)
    const one = planResizeShadow(intent, { maxSolves: 1 })
    expect(one.numericalSolves).toBe(1)
    expect(one.status).toBe('search-budget-exhausted')
  })
  it('recognizes and translates a multi-panel dependent section without recutting', () => {
    let source = scenario('overlap-200.01').source()
    source = attachPanel(source, 'child', createPanel({ id: 'stopper', name: 'Stopper', width: 80, height: 200.01 }),
      { type: '90', side: 'left', offset: 0, inset: 0, flip: false, color: '#292b27', count: 1 })
    const result = planResizeShadow(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['parent'], dimensions: { height: 500 } }))
    expect(result.analysis.sections.some(section => section.panelIds.includes('child') && section.panelIds.includes('stopper'))).toBe(true)
    const candidate = result.candidates.find(c => c.interpretation === 'positive-end')!
    expect(candidate, JSON.stringify(result.attempts)).toBeDefined()
    const before = new Map(resolvePanels(source).map(p => [p.id, p]))
    const after = new Map(resolvePanels(candidate.project).map(p => [p.id, p]))
    for (const id of ['child', 'stopper']) {
      expect(after.get(id)!.width).toBeCloseTo(before.get(id)!.width)
      expect(after.get(id)!.height).toBeCloseTo(before.get(id)!.height)
    }
    const delta = (id: string) => after.get(id)!.position.map((v, i) => v - before.get(id)!.position[i])
    delta('child').forEach((v, i) => expect(v).toBeCloseTo(delta('stopper')[i], 4))
  })
})

function opening(): Project {
  // Orthogonal walls are structurally attached to a back; loose insert rests
  // against that back and spans the opening with 2 mm side clearances.
  const back = createPanel({ id: 'back', width: 600, height: 400, position: [0, 800, 0] })
  let project: Project = { version: 1, name: 'Opening', panels: [back], connections: [] }
  for (const side of ['left', 'right'] as const) project = attachPanel(project, 'back', createPanel({ id: side, width: 300, height: 400 }),
    { type: '90', side, offset: 0, inset: 0, flip: false, color: '#292b27', count: 1 })
  const walls = resolvePanels(project).filter(p => p.id !== 'back')
  const lo = Math.min(...walls.map(p => p.position[0])) + 9
  const hi = Math.max(...walls.map(p => p.position[0])) - 9
  project.panels.push(createPanel({ id: 'insert', width: hi - lo - 4, height: 200, position: [(lo + hi) / 2, 800, 18] }))
  return project
}

it('measures opposed faces in a construction-local frame, including whole-build rotation', () => {
  const source = opening()
  const original = analyzeResizeEvidence(source, ['back'])
  const fits = original.evidence.filter(e => e.detector === 'opposing-faces')
  expect(fits.length).toBeGreaterThan(0)
  expect(fits[0].residuals[0]).toBeCloseTo(2)
  const rotation = new Quaternion().setFromEuler(new Euler(0.3, 0.7, 0.2))
  const rotated = { ...source, panels: resolvePanels(source).map(p => ({ ...p,
    position: new Vector3(...p.position).applyQuaternion(rotation).toArray() as [number, number, number],
    rotation: new Euler().setFromQuaternion(rotation.clone().multiply(new Quaternion().setFromEuler(new Euler(...p.rotation)))).toArray().slice(0, 3) as [number, number, number],
  })) }
  const rotatedFits = analyzeResizeEvidence(rotated, ['back']).evidence.filter(e => e.detector === 'opposing-faces')
  expect(rotatedFits.length).toBe(fits.length)
  rotatedFits.forEach((fit, i) => fit.residuals.forEach((value, j) => expect(value).toBeCloseTo(fits[i].residuals[j], 4)))
})

it('rejects unsupported gesture policy and never guesses oblique compartments', () => {
  const source = opening()
  const intent = createResizeIntent(source, { kind: 'panel-edge', edge: { panelId: 'back', dimension: 'width', side: 1, distance: 100 }, local: false })
  expect(() => planResizeShadow(intent)).toThrow(/ordinary numeric/)
  const oblique = { ...source, panels: source.panels.map(panel => panel.id === 'insert' ? { ...panel, rotation: [0, 0, 0.2] as [number, number, number] } : panel) }
  expect(analyzeResizeEvidence(oblique, ['back']).evidence.filter(e => e.detector === 'opposing-faces')).toEqual([])
})

it('finds a valid fitted compartment candidate with exact clearances', () => {
  const source = opening()
  const result = planResizeShadow(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['back'], dimensions: { width: 700 } }))
  const candidate = result.candidates.find(c => c.interpretation === 'fitted-clearances')
  expect(candidate, JSON.stringify(result.attempts)).toBeDefined()
  expect(result.candidates[0].interpretation).toBe('fitted-clearances')
  const fits = analyzeResizeEvidence(candidate!.project, ['back']).evidence.filter(e => e.detector === 'opposing-faces')
  expect(fits.length).toBeGreaterThan(0)
  fits.forEach(fit => fit.residuals.forEach(value => expect(value).toBeCloseTo(2, 4)))
})

it('compares the numeric corpus with immutable sources and stable physical identities', () => {
  const report = resizeIntentCorpus.filter(item => item.operation === 'numeric').map(item => {
    const source = item.source(), before = JSON.stringify(source)
    const intent = createResizeIntent(source, { kind: 'selection-dimensions', panelIds: [targetPanel(source, item).id], dimensions: { [item.target.dimension]: item.target.value } })
    const start = performance.now(), result = planResizeShadow(intent), elapsedMs = performance.now() - start
    expect(JSON.stringify(source)).toBe(before)
    for (const candidate of result.candidates) {
      expect(candidate.project.panels.map(p => p.id).sort()).toEqual(source.panels.map(p => p.id).sort())
      expect(candidate.project.connections.map(c => c.id).sort()).toEqual(source.connections.map(c => c.id).sort())
      expect(getPhysicalConnectors(candidate.project).map(c => c.id).sort()).toEqual(getPhysicalConnectors(source).map(c => c.id).sort())
      expect(validateProject(candidate.project).filter(issue => !validateProject(source).some(old => old.id === issue.id))).toEqual([])
    }
    return { id: item.id, elapsedMs, legacy: result.legacy.status, status: result.status, numericalSolves: result.numericalSolves,
      ambiguous: result.ambiguous, attempts: result.attempts, candidates: result.candidates.map(candidate => ({
        interpretation: candidate.interpretation, score: candidate.score, explanations: candidate.explanations,
        cuts: candidate.project.panels.map(p => ({ name: p.name, width: p.width, height: p.height })),
      })) }
  })
  if (process.env.RESIZE_SHADOW_REPORT) writeFileSync(process.env.RESIZE_SHADOW_REPORT, JSON.stringify(report, null, 2))
})

it('keeps per-component average anchors for multiple numeric targets', () => {
  const source: Project = { version: 1, name: 'Separate panels', connections: [], panels: [
    createPanel({ id: 'a', width: 400, height: 300, position: [0, 800, 0] }),
    createPanel({ id: 'b', width: 400, height: 300, position: [2000, 800, 0] }),
  ] }
  const intent = createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['a', 'b'], dimensions: { width: 500 } })
  const result = planResizeShadow(intent)
  expect(result.candidates).toHaveLength(1)
  for (const panel of result.candidates[0].project.panels) expect(panel.position).toEqual(source.panels.find(p => p.id === panel.id)!.position)
  const limited = planResizeShadow(intent, { maxSolves: 1 })
  expect(limited.status).toBe('search-budget-exhausted')
  expect(limited.candidates).toEqual([])
  expect(limited.numericalSolves).toBe(1)
})
