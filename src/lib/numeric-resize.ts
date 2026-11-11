import { createResizeIntent, type ResizeDimensions, type ResizeIntent } from './resize-intent'
import { planResizeCandidates, hasDecisiveResizeFit, type ShadowResizeCandidate } from './resize-planner'
import { validateResizeCandidate, RESIZE_OUTCOME_TOLERANCE } from './resize-candidate-validation'
import { resolvePanels } from './model'
import { coordinate, frame } from './resize-analysis'
import { Vector3 } from 'three'
import type { Project } from './types'
import type { ResizeReview } from './structure-edit'

export class ResizeReviewRequired extends Error {
  constructor(public review: ResizeReview) { super('Choose what this resize should preserve.') }
}
export const resizeInterpretationLabels = { 'preserve-cuts': 'Keep attached sizes', 'negative-end': 'Keep lower / left end aligned',
  'positive-end': 'Keep upper / right end aligned', 'fitted-clearances': 'Keep both margins' }
const descriptions = { 'preserve-cuts': 'Attached panels keep their sizes and move together as needed.',
  'negative-end': 'Keep attached panel sizes and follow their lower or left end references.',
  'positive-end': 'Keep attached panel sizes and follow their upper or right end references.',
  'fitted-clearances': 'Resize the fitted panels to retain the existing margins at both ends.' }
const size = (project: Project) => {
  const frames = resolvePanels(project).map(frame)
  return [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(axis =>
    Math.max(...frames.map(item => coordinate(item, axis, 1))) - Math.min(...frames.map(item => coordinate(item, axis, -1))))
}
function changes(source: Project, candidate: Project) {
  const before = new Map(resolvePanels(source).map(panel => [panel.id, panel]))
  return resolvePanels(candidate).flatMap(after => {
    const previous = before.get(after.id)!
    return Math.abs(after.width - previous.width) > RESIZE_OUTCOME_TOLERANCE || Math.abs(after.height - previous.height) > RESIZE_OUTCOME_TOLERANCE
      || after.position.some((n, i) => Math.abs(n - previous.position[i]) > RESIZE_OUTCOME_TOLERANCE)
      || JSON.stringify(after.customOutline) !== JSON.stringify(previous.customOutline) ? [{ before: previous, after }] : []
  })
}
export function acceptNumericResize(current: Project, intent: ResizeIntent, candidate: ShadowResizeCandidate) {
  if (current !== intent.source) throw new Error('The project changed. Try the resize again to review current alternatives.')
  return validateResizeCandidate(intent, candidate.project, candidate.equations, candidate.adaptingCuts)
}
/** Ordinary inspector dimensions only. Other callers retain their explicit policies. */
export function resizePanelsWithReview(source: Project, ids: readonly string[], dimensions: ResizeDimensions): Project {
  const intent = createResizeIntent(source, { kind: 'selection-dimensions', panelIds: ids, dimensions })
  if (Object.values(dimensions).some(n => n !== undefined && (!Number.isFinite(n) || n < 40 || n > 4000))) throw new Error('Panel dimensions must be between 40 and 4,000 mm.')
  const selected = new Set(ids)
  if (!source.panels.some(panel => selected.has(panel.id) && (['width', 'height'] as const).some(dimension => dimensions[dimension] !== undefined
    && Math.abs(dimensions[dimension]! - panel[dimension]) > RESIZE_OUTCOME_TOLERANCE))) return source
  const report = planResizeCandidates(intent, { hierarchy: true })
  if (!report.candidates.length) throw new Error(report.status === 'search-budget-exhausted'
    ? 'The resize search reached its limit. Try resizing fewer panels together.'
    : report.attempts.find(attempt => attempt.message)?.message ?? 'No valid resize was found for these dimensions. Review the joints and saved rules.')
  const best = report.candidates[0]
  // Strong paired topology can justify a direct fit. Isolated seams and supported
  // margins remain reviewable even when the legacy command would have succeeded.
  const relevantIds = new Set(best.evidenceIds)
  const evidence = report.analysis.evidence.filter(item => relevantIds.has(item.id))
  const decisiveFit = hasDecisiveResizeFit(evidence)
  const fitted = report.candidates.find(candidate => candidate.interpretation === 'fitted-clearances')
  if (report.status === 'complete' && (report.candidates.length === 1 || (decisiveFit && fitted))) {
    return acceptNumericResize(source, intent, decisiveFit && fitted ? fitted : best)
  }
  throw new ResizeReviewRequired(createResizeReview(intent, report.candidates, report.status !== 'complete'))
}

export function createResizeReview(intent: ResizeIntent, candidates: readonly ShadowResizeCandidate[], incomplete = false): ResizeReview {
  const source = intent.source
  const target = intent.target
  const panel = target.kind === 'panel-edge' ? source.panels.find(p => p.id === target.edge.panelId) : undefined
  if (target.kind === 'panel-edge' && !panel) throw new Error('The resized panel no longer exists.')
  const dimensions = target.kind === 'selection-dimensions' ? target.dimensions : target.kind === 'panel-edge' && panel
    ? { [target.edge.dimension]: panel[target.edge.dimension] + target.edge.distance } : {}
  const outsideBefore = size(source)
  const review: ResizeReview = { source, requestedDimensions: { ...dimensions }, intent, incomplete,
    alternatives: candidates.map(candidate => ({
      relaxed: { id: candidate.interpretation, kind: 'alignment', description: resizeInterpretationLabels[candidate.interpretation], panelIds: candidate.project.panels.map(p => p.id) },
      project: candidate.project, changes: changes(source, candidate.project), candidate,
      explanation: descriptions[candidate.interpretation], outsideSize: { before: outsideBefore, after: size(candidate.project) },
    })) }
  return review
}
