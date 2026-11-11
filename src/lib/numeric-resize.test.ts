import { writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { resizeIntentCorpus, targetPanel } from '../test/resize-intent-corpus'
import { ResizeReviewRequired, resizePanelsWithReview } from './numeric-resize'
import { acceptResizeAlternative } from './structure-edit'
import { resolvePanels, parseProject, validateProject, createPanel } from './model'
import { planResizeCandidates } from './resize-planner'
import { createResizeIntent } from './resize-intent'
import type { Project } from './types'

it.each(['overlap-199.99', 'overlap-200', 'overlap-200.01', 'occupancy-319.99', 'occupancy-320', 'occupancy-320.01', 'locked-child'])('%s reviews success and conflict with one source-bound transaction', id => {
  const scenario = resizeIntentCorpus.find(item => item.id === id)!, source = scenario.source(), original = JSON.stringify(source)
  let review: ResizeReviewRequired | undefined
  try { resizePanelsWithReview(source, [targetPanel(source, scenario).id], { [scenario.target.dimension]: scenario.target.value }) }
  catch (error) { expect(error).toBeInstanceOf(ResizeReviewRequired); review = error as ResizeReviewRequired }
  expect(review).toBeDefined()
  expect(review!.review.alternatives.length).toBeGreaterThan(1)
  expect(review!.review.incomplete).toBe(false)
  expect(JSON.stringify(source)).toBe(original)
  review!.review.alternatives.forEach((option, i) => {
    expect(option.candidate!.diagnostics.every(tier => tier.termination === 'optimal')).toBe(true)
    const accepted = acceptResizeAlternative(source, review!.review, i)
    expect(parseProject(JSON.parse(JSON.stringify(accepted)))).toEqual(accepted)
    expect(validateProject(accepted).filter(issue => !validateProject(source).some(old => old.id === issue.id))).toEqual([])
  })
  expect(() => acceptResizeAlternative({ ...source }, review!.review, 0)).toThrow(/project changed/)
})
it.each(['single-numeric', 'angled-trays'])('%s applies a high-confidence result directly', id => {
  const scenario = resizeIntentCorpus.find(item => item.id === id)!, source = scenario.source()
  const result = resizePanelsWithReview(source, [targetPanel(source, scenario).id], { [scenario.target.dimension]: scenario.target.value })
  expect(resolvePanels(result).find(p => p.id === targetPanel(source, scenario).id)![scenario.target.dimension]).toBeCloseTo(scenario.target.value, 4)
})
it.each(['locked-target', 'stock-limit'])('%s rejects atomically', id => {
  const scenario = resizeIntentCorpus.find(item => item.id === id)!, source = scenario.source(), before = JSON.stringify(source)
  expect(() => resizePanelsWithReview(source, [targetPanel(source, scenario).id], { [scenario.target.dimension]: scenario.target.value })).toThrow()
  expect(JSON.stringify(source)).toBe(before)
})
it('lets an authored position outrank default numeric centering', () => {
  const source: Project = { version: 1, name: 'Anchored edge', panels: [createPanel({ id: 'a', width: 400, height: 300, position: [0, 800, 0] })], connections: [],
    constraints: [{ id: 'left', kind: 'position', enabled: true, panelId: 'a', axis: 'x', reference: 'min', value: -200 }] }
  const result = resizePanelsWithReview(source, ['a'], { width: 500 })
  expect(result.panels[0].position[0]).toBeCloseTo(50, 4)
})
it('preserves every interpretation under panel/connection/rule order reversal', () => {
  const scenario = resizeIntentCorpus.find(item => item.id === 'angled-trays')!, source = scenario.source()
  const report = (project: Project) => planResizeCandidates(createResizeIntent(project, { kind: 'selection-dimensions', panelIds: [targetPanel(project, scenario).id], dimensions: { width: 400 } }), { hierarchy: true })
  const first = report(source)
  if (process.env.RESIZE_PRIORITY_REPORT) writeFileSync(process.env.RESIZE_PRIORITY_REPORT, JSON.stringify(first.candidates.map(c => c.diagnostics), null, 2))
  const second = report({ ...source, panels: [...source.panels].reverse(), connections: [...source.connections].reverse(), constraints: [...source.constraints ?? []].reverse() })
  expect(second.candidates.map(c => c.score)).toEqual(first.candidates.map(c => c.score))
})

it('adapts an explicitly equal peer cut without inferring equality from numbers', () => {
  const source: Project = { version: 1, name: 'Equal cuts', panels: [
    createPanel({ id: 'a', width: 400, height: 300, position: [0, 800, 0] }),
    createPanel({ id: 'b', width: 400, height: 300, position: [2000, 800, 0] }),
  ], connections: [], constraints: [{ id: 'equal', kind: 'equal-dimension', enabled: true, panelIds: ['a', 'b'], dimension: 'width' }] }
  const next = resizePanelsWithReview(source, ['a'], { width: 500, height: undefined })
  expect(next.panels.map(panel => panel.width)).toEqual([500, 500])
  expect(next.constraints).toEqual(source.constraints)
  expect(next.panels[1].position).toEqual(source.panels[1].position)
})
it('directly preserves an unambiguous full seam fit', () => {
  const source = resizeIntentCorpus.find(item => item.id === 'overlap-200')!.source()
  source.panels = source.panels.map(panel => panel.id === 'child' ? { ...panel, height: 400 } : panel)
  const next = resizePanelsWithReview(source, ['parent'], { height: 500 })
  expect(next.panels.map(panel => panel.height)).toEqual([500, 500])
})
it('rejects a worsened existing overlap even when its diagnostic ID stays the same', () => {
  const source: Project = { version: 1, name: 'Imported overlap', panels: [
    createPanel({ id: 'a', width: 400, height: 300, position: [0, 800, 0] }),
    createPanel({ id: 'b', width: 400, height: 300, position: [100, 800, 0] }),
  ], connections: [] }
  expect(validateProject(source).some(issue => issue.id.startsWith('collision-'))).toBe(true)
  expect(() => resizePanelsWithReview(source, ['a'], { width: 500 })).toThrow(/worsen.*overlap/)
  expect(resizePanelsWithReview(source, ['a'], { width: 300 }).panels[0].width).toBe(300)
})
it('rejects new overlaps and validates reviewed targets again at acceptance', () => {
  const source: Project = { version: 1, name: 'Collision', panels: [
    createPanel({ id: 'a', width: 400, height: 300, position: [0, 800, 0] }),
    createPanel({ id: 'b', width: 400, height: 300, position: [450, 800, 0] }),
  ], connections: [] }
  expect(() => resizePanelsWithReview(source, ['a'], { width: 600 })).toThrow(/overlaps/)
  const seam = resizeIntentCorpus.find(item => item.id === 'overlap-200')!.source()
  try { resizePanelsWithReview(seam, ['parent'], { height: 500 }) }
  catch (error) {
    expect(error).toBeInstanceOf(ResizeReviewRequired)
    const review = (error as ResizeReviewRequired).review
    const option = review.alternatives[0]
    option.project = { ...option.project, panels: option.project.panels.map(p => p.id === 'parent' ? { ...p, height: 499 } : p) }
    expect(() => acceptResizeAlternative(seam, review, 0)).toThrow(/requested|preserved/)
    return
  }
  throw new Error('Expected an ambiguous seam review')
})
it('rejects nonfinite input and preserves exact zero edits', () => {
  const source = resizeIntentCorpus.find(item => item.id === 'single-numeric')!.source()
  expect(() => resizePanelsWithReview(source, ['panel'], { width: NaN })).toThrow(/dimensions/)
  expect(resizePanelsWithReview(source, ['panel'], { width: 400 })).toBe(source)
})
it('consistent ID renaming does not select a different seam interpretation', () => {
  const source = resizeIntentCorpus.find(item => item.id === 'overlap-200.01')!.source()
  const rename = (id: string) => id === 'parent' ? 'aaa' : id === 'child' ? 'zzz' : `renamed-${id}`
  const renamed = { ...source, panels: source.panels.map(p => ({ ...p, id: rename(p.id) })),
    connections: source.connections.map(c => ({ ...c, id: rename(c.id), parentId: rename(c.parentId), childId: rename(c.childId) })) }
  const report = (project: Project, parent: string) => planResizeCandidates(createResizeIntent(project, {
    kind: 'selection-dimensions', panelIds: [parent], dimensions: { height: 500 },
  }), { hierarchy: true })
  const original = report(source, 'parent'), other = report(renamed, 'aaa')
  expect(other.candidates.map(c => c.interpretation)).toEqual(original.candidates.map(c => c.interpretation))
  other.candidates.forEach((candidate, i) => {
    const expected = new Map(resolvePanels(original.candidates[i].project).map(p => [p.name, p]))
    for (const panel of resolvePanels(candidate.project)) {
      expect(panel.height).toBeCloseTo(expected.get(panel.name)!.height, 4)
      panel.position.forEach((n, axis) => expect(n).toBeCloseTo(expected.get(panel.name)!.position[axis], 4))
    }
  })
})

it('matches every numeric corpus decision label and keeps all unlisted cuts fixed', () => {
  const results = resizeIntentCorpus.filter(item => item.operation === 'numeric').map(scenario => {
    const source = scenario.source(), before = JSON.stringify(source), started = performance.now()
    let decision: 'direct' | 'review' | 'rejected' = 'direct'
    let projects: Project[] = []
    try { projects = [resizePanelsWithReview(source, [targetPanel(source, scenario).id], { [scenario.target.dimension]: scenario.target.value })] }
    catch (error) {
      if (error instanceof ResizeReviewRequired) { decision = 'review'; projects = error.review.alternatives.map(option => option.project) }
      else decision = 'rejected'
    }
    const elapsedMs = performance.now() - started
    expect(decision, scenario.id).toBe(scenario.ambiguity === 'conflict' ? 'rejected' : scenario.ambiguity === 'review' ? 'review' : 'direct')
    const allowed = new Set(scenario.allowedAdaptingCuts), original = new Map(resolvePanels(source).map(p => [p.id, p]))
    for (const project of projects) for (const panel of resolvePanels(project)) for (const dimension of ['width', 'height'] as const) {
      if (!allowed.has(`${panel.name}.${dimension}`)) expect(panel[dimension], `${scenario.id}: ${panel.name}.${dimension}`).toBeCloseTo(original.get(panel.id)![dimension], 4)
    }
    expect(JSON.stringify(source)).toBe(before)
    return { id: scenario.id, decision, alternatives: projects.length, elapsedMs }
  })
  if (process.env.RESIZE_NUMERIC_REPORT) writeFileSync(process.env.RESIZE_NUMERIC_REPORT, JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, cases: results }, null, 2))
})
