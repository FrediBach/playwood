import { writeFileSync } from 'node:fs'
import { validateResizeCandidate } from './resize-candidate-validation'
import { expect, it } from 'vitest'
import { resizeIntentCorpus } from '../test/resize-intent-corpus'
import { createPanel, resolvePanels, validateProject } from './model'
import { createResizeIntent } from './resize-intent'
import { planResizeCandidates, prepareResizeCandidates } from './resize-planner'
import { finishPreviewResize, movePreviewResize, preparePreviewResize, reviewPreviewResize, startPreviewResize } from './preview-resize'
import { ResizeReviewRequired, resizePanelsWithReview } from './numeric-resize'
import { acceptResizeAlternative } from './structure-edit'
import { snapDistanceReference } from './preview-snap'
import type { Project } from './types'

const fixture = (id: string) => resizeIntentCorpus.find(item => item.id === id)!.source()
const heightEdge = 'panel-height-positive'
it.each(['overlap-199.99', 'overlap-200', 'overlap-200.01'])('%s replays connected propagation from its source and retains the exact opposite edge', id => {
  const source = fixture(id), original = JSON.stringify(source)
  const session = preparePreviewResize(source, { panelId: 'parent' })!
  expect(session.handles.find(handle => handle.id === heightEdge)!.blocked).toBeUndefined()
  const chosen = startPreviewResize(session, heightEdge)!
  for (const distance of [16, 80, -16, 100]) {
    const result = movePreviewResize(session, heightEdge, distance)
    expect(result.limited).toBe(false)
    expect(result.interpretation).toBe(chosen.label)
    const parent = resolvePanels(result.project).find(p => p.id === 'parent')!
    expect(parent.position[1] - parent.height / 2).toBeCloseTo(600, 4)
    expect(result.project.panels.find(p => p.id === 'child')!.height).toBeCloseTo(source.panels.find(p => p.id === 'child')!.height + (id === 'overlap-200.01' ? distance : 0), 4)
  }
  const final = movePreviewResize(session, heightEdge, 100)
  const single = movePreviewResize(preparePreviewResize(source, { panelId: 'parent' })!, heightEdge, 100)
  expect(final).toEqual(single)
  expect(movePreviewResize(session, heightEdge, 0).project).toBe(source)
  expect(() => reviewPreviewResize(session, heightEdge, 100)).not.toThrow()
  expect(JSON.stringify(source)).toBe(original)
})
it('matches numeric resizing when an authored opposite edge supplies the same intent', () => {
  const source = fixture('single-edge')
  source.constraints = [{ id: 'anchor', kind: 'position', enabled: true, panelId: 'panel', axis: 'x', reference: 'min', value: -200 }]
  const numeric = resizePanelsWithReview(source, ['panel'], { width: 500 })
  const session = preparePreviewResize(source, { panelId: 'panel' })!
  expect(movePreviewResize(session, 'panel-width-positive', 100).project).toEqual(numeric)
})
it('nice values replay the same interpretation and anchor', () => {
  const source = { ...fixture('overlap-200.01'), niceValues: { enabled: true, step: 50 } }
  const session = preparePreviewResize(source, { panelId: 'parent' })!
  const result = movePreviewResize(session, heightEdge, 83)
  const finished = finishPreviewResize(session, heightEdge, result)
  expect(finished.interpretation).toBe(result.interpretation)
  expect(finished.distance).toBe(100)
  expect(finished.project.panels.find(p => p.id === 'child')!.height).toBeCloseTo(300.01, 4)
  expect(resolvePanels(finished.project).find(p => p.id === 'parent')!.position[1]).toBeCloseTo(850, 4)
})
it('reports stock blockers for ordinary edges and keeps the source intact on reversal', () => {
  const source = fixture('single-edge'), session = preparePreviewResize(source, { panelId: 'panel' })!
  const result = movePreviewResize(session, 'panel-width-positive', -500)
  expect(result.limited).toBe(true)
  expect(result.reason).toBeTruthy()
  expect(result.project.panels[0].width).toBeCloseTo(40, 3)
  expect(movePreviewResize(session, 'panel-width-positive', 0).project).toBe(source)
})
it('does not tunnel to a valid endpoint beyond an intervening collision', () => {
  const source = fixture('overlap-200')
  const child = resolvePanels(source).find(p => p.id === 'child')!
  const obstacle = createPanel({ id: 'obstacle', width: 40, height: 40, position: [child.position[0], child.position[1] + 160, child.position[2]], rotation: child.rotation })
  source.panels.push(obstacle)
  expect(validateProject(source)).toEqual([])
  const session = preparePreviewResize(source, { panelId: 'parent' })!
  const chosen = startPreviewResize(session, heightEdge)!
  expect(validateProject(chosen.solve(800))).toEqual([])
  const reached = movePreviewResize(session, heightEdge, 800)
  expect(reached.limited).toBe(true)
  expect(reached.distance).toBeLessThan(800)
  expect(reached.reason).toMatch(/overlap/i)
  expect(validateProject(reached.project)).toEqual([])
  try {
    reviewPreviewResize(session, heightEdge, reached.distance, false, 800)
    expect.fail('A different reachable interpretation should be offered explicitly.')
  } catch (error) {
    expect(error).toBeInstanceOf(ResizeReviewRequired)
    const review = (error as ResizeReviewRequired).review
    expect(review.requestedDimensions.height).toBe(1200)
    expect(review.alternatives.length).toBeGreaterThan(0)
    expect(() => acceptResizeAlternative({ ...source }, review, 0)).toThrow(/project changed/)
  }
})
it('bounds continuation work explicitly rather than claiming a global maximum', () => {
  const source = fixture('single-edge'), session = preparePreviewResize(source, { panelId: 'panel' })!
  const result = movePreviewResize(session, 'panel-width-positive', 2000)
  expect(result.limited).toBe(true)
  expect(result.distance).toBe(1024)
  expect(result.reason).toMatch(/search limit/)
})
it('retains source snap reference identity and the requested plane coordinate', () => {
  const settings = { geometry: true, grid: false, spacing: 50, tolerance: 10 }
  const result = snapDistanceReference([200, 0, 0], [1, 0, 0], 96, [[300, 20, 0]], settings)
  expect(result).toEqual({ distance: 100, reference: { kind: 'geometry', index: 0, axis: 0, value: 300 } })
})
it('reuses prepared evidence without accepting a different source or edge', () => {
  const source: Project = fixture('single-edge')
  const intent = createResizeIntent(source, { kind: 'panel-edge', local: false, edge: { panelId: 'panel', dimension: 'width', side: 1, distance: 10 } })
  const prepared = prepareResizeCandidates(intent, { hierarchy: true })
  const first = prepared(intent)
  const next = createResizeIntent(source, { ...intent.target, ...(intent.target.kind === 'panel-edge' ? { edge: { ...intent.target.edge, distance: 20 } } : {}) })
  expect(prepared(next).analysis).toBe(first.analysis)
  expect(prepared(next).candidates.map(candidate => candidate.project)).toEqual(planResizeCandidates(next, { hierarchy: true }).candidates.map(candidate => candidate.project))
  expect(() => prepared({ ...next, source: { ...source } })).toThrow(/source or target/)
  const reordered = createResizeIntent(source, { local: false, edge: { distance: 20, side: 1, dimension: 'width', panelId: 'panel' }, kind: 'panel-edge' })
  expect(prepared(reordered).candidates[0].project).toEqual(prepared(next).candidates[0].project)
  expect(() => prepared(createResizeIntent(source, { kind: 'panel-edge', local: false, edge: { panelId: 'panel', dimension: 'width', side: -1, distance: 20 } }))).toThrow(/source or target/)
  const numeric = prepareResizeCandidates(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['panel'], dimensions: { width: 500 } }))
  expect(() => numeric(createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ['panel'], dimensions: { height: 500 } }))).toThrow(/source or target/)

})

it('rechecks the fixed opposite edge at review acceptance', () => {
  const source = fixture('single-edge')
  const intent = createResizeIntent(source, { kind: 'panel-edge', local: false, edge: { panelId: 'panel', dimension: 'width', side: 1, distance: 100 } })
  const candidate = planResizeCandidates(intent, { hierarchy: true }).candidates[0]
  const shifted: Project = { ...candidate.project, panels: candidate.project.panels.map(p => ({ ...p, position: [p.position[0] + 1, p.position[1], p.position[2]] })) }
  expect(() => validateResizeCandidate(intent, shifted, candidate.equations, candidate.adaptingCuts)).toThrow(/opposite edge/)
})
it.runIf(!!process.env.RESIZE_GESTURE_REPORT)('records local preparation and warm gesture timings', () => {
  const reports = ['single-edge', 'overlap-200.01', 'angled-trays'].map(id => {
    const scenario = resizeIntentCorpus.find(item => item.id === id)!, source = scenario.source()
    const panel = source.panels.find(p => p.name === scenario.target.panel)!
    const begin = performance.now(), session = preparePreviewResize(source, { panelId: panel.id })!
    const handleId = `panel-${scenario.target.dimension}-positive`
    startPreviewResize(session, handleId)
    const preparationMs = performance.now() - begin
    const samples = Array.from({ length: 12 }, (_, i) => {
      const start = performance.now()
      const result = movePreviewResize(session, handleId, (i + 1) * 8)
      return { milliseconds: performance.now() - start, limited: result.limited }
    })
    return { id, panels: source.panels.length, preparationMs, samples }
  })
  writeFileSync(process.env.RESIZE_GESTURE_REPORT!, JSON.stringify({ runtime: process.version, platform: process.platform, architecture: process.arch, reports }, null, 2))
})

it('does not silently replace a blocked connected edit with fixed-cut resizing', () => {
  const source = fixture('locked-child'), session = preparePreviewResize(source, { panelId: 'parent' })!
  expect(session.handles.find(handle => handle.id === heightEdge)?.blocked).toBeDefined()
  expect(movePreviewResize(session, heightEdge, 100).project).toBe(source)
  expect(movePreviewResize(session, heightEdge, 100, true).project.panels.find(p => p.id === 'parent')!.height).toBeCloseTo(500, 4)
})
