import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { resizeIntentCorpus, targetPanel } from '../test/resize-intent-corpus'
import { gridProject } from './example-geometry'
import { synthStorageShelfProject } from './synth-storage-shelf'
import { preparePreviewResize, movePreviewResize } from './preview-resize'
import { resizePanelsWithReview, ResizeReviewRequired } from './numeric-resize'
import { resizePanelEdge, resizePanels } from './structure-edit'
import type { Project } from './types'

type Fixture = { id: string; source: Project; panelId: string; dimension: 'width' | 'height'; size: number }
/** Run the same immutable fixtures against two checkouts, then compare outputs.
 * No timings are embedded in outputs: full geometry and diagnostics can be
 * compared exactly. Missing fixture files are generated only in this opt-in run. */
it.runIf(!!process.env.RESIZE_EQUIVALENCE_REPORT)('records complete resize outcomes for performance equivalence', () => {
  const path = process.env.RESIZE_EQUIVALENCE_FIXTURES!
  if (!existsSync(path)) {
    const fixtures: Fixture[] = resizeIntentCorpus.map(scenario => {
      const source = scenario.source(), panel = targetPanel(source, scenario)
      return { id: scenario.id, source, panelId: panel.id, dimension: scenario.target.dimension, size: scenario.target.value }
    })
    for (const source of [synthStorageShelfProject(), gridProject('Large grid', Array(8).fill(350), Array(10).fill(300))]) {
      fixtures.push({ id: source.name, source, panelId: source.panels[0].id, dimension: 'width', size: source.panels[0].width + 40 })
    }
    writeFileSync(path, JSON.stringify(fixtures))
  }
  const fixtures = JSON.parse(readFileSync(path, 'utf8')) as Fixture[]
  const attempt = (run: () => unknown) => {
    try { return { result: run() } }
    catch (error) {
      if (error instanceof ResizeReviewRequired) return { review: error.review.alternatives.map(alternative => ({ project: alternative.project, relaxed: alternative.relaxed, explanation: alternative.explanation, changes: alternative.changes, outsideSize: alternative.outsideSize })) }
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
  const timings: unknown[] = []
  const outcomes = fixtures.map(({ id, source, panelId, dimension, size }) => {
    const original = JSON.stringify(source)
    const numeric = attempt(() => resizePanels(source, [panelId], { [dimension]: size }))
    // Bound the diagnostic harness, not the production planner: large-grid
    // direct/gesture paths are compared below; ordinary review uses the corpus.
    const review = source.panels.length < 100 ? attempt(() => resizePanelsWithReview(source, [panelId], { [dimension]: size })) : undefined
    const edges = ([-1, 1] as const).flatMap(side => [false, true].map(local => attempt(() => resizePanelEdge(source, panelId, dimension, side, size - source.panels.find(panel => panel.id === panelId)![dimension], local))))
    const started = performance.now(), session = preparePreviewResize(source, { panelId })
    const preparationMs = performance.now() - started
    const samples: number[] = []
    const gesture = session ? [8, 16, 24, 32, 0, -8, -16, 8, 40, 48].map(distance => {
      const start = performance.now(), result = attempt(() => movePreviewResize(session, `panel-${dimension}-positive`, distance))
      samples.push(performance.now() - start)
      return result
    }) : null
    timings.push({ id, preparationMs, samples })
    expect(JSON.stringify(source)).toBe(original)
    return { id, numeric, review, edges, handles: session?.handles, gesture }
  })
  writeFileSync(process.env.RESIZE_EQUIVALENCE_REPORT!, JSON.stringify({ outcomes, timings }))
}, 120000)
