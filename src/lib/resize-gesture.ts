import { roundNiceValue } from './nice-values'
import { createResizeIntent, type PanelEdgeResize } from './resize-intent'
import { prepareResizeCandidates } from './resize-planner'
import { createResizeReview, ResizeReviewRequired } from './numeric-resize'
import { resizePanelEdge } from './structure-edit'
import { validateResizeCandidate } from './resize-candidate-validation'
import type { Project } from './types'

/** Connected drag is an explicit operation, not a numeric cut-preservation
 * preference. Replay the established propagation policy from the frozen source;
 * never substitute a fixed-cut interpretation when it reaches a limit. */
export function prepareResizeGesture(source: Project, edge: Omit<PanelEdgeResize, 'distance'>) {
  const panel = source.panels.find(item => item.id === edge.panelId)
  if (!panel) throw new Error('The resized panel no longer exists.')
  const intentAt = (distance: number) => createResizeIntent(source, { kind: 'panel-edge', edge: { ...edge, distance }, local: false }, { origin: 'preview' })
  // The established compiler owns propagation/cut eligibility. The common final
  // validator independently checks targets, anchors, identities and physical fit.
  const adaptingCuts = new Set(source.panels.flatMap(item => [`${item.id}/width`, `${item.id}/height`]))
  const cache = new Map<number, Project | Error>([[0, source]])
  let plan: ReturnType<typeof prepareResizeCandidates> | undefined
  return {
    interpretation: 'connected' as const,
    label: 'Resize connected panels',
    solve(distance: number) {
      const cached = cache.get(distance)
      if (cached instanceof Error) throw cached
      if (cached) return cached
      let outcome: Project | Error
      try {
        const candidate = resizePanelEdge(source, edge.panelId, edge.dimension, edge.side, distance, false, { origin: 'preview' })
        outcome = validateResizeCandidate(intentAt(distance), candidate, [], adaptingCuts)
      } catch (error) { outcome = error instanceof Error ? error : new Error('This connected resize could not be solved.') }
      if (cache.size >= 256) cache.delete(cache.keys().next().value!)
      cache.set(distance, outcome)
      if (outcome instanceof Error) throw outcome
      return outcome
    },
    review(distance: number, requestedDistance?: number) {
      if (requestedDistance === undefined || Math.abs(requestedDistance - distance) <= 1e-4) return
      const before = panel[edge.dimension]
      const target = source.niceValues?.enabled
        ? roundNiceValue(before + requestedDistance, source.niceValues.step, 40, 4000) - before : requestedDistance
      if (Math.abs(target) > 1024) return
      // Alternative semantics are deliberate choices after a limit, never the
      // default for a successful connected drag. Numeric review is unchanged.
      plan ??= prepareResizeCandidates(intentAt(0), { hierarchy: true })
      const requested = intentAt(target), alternatives = plan(requested)
      const reachable = alternatives.candidates.filter(candidate => {
        for (let traveled = 8; traveled < Math.abs(target); traveled += 8) {
          if (!plan!(intentAt(Math.sign(target) * traveled), candidate.interpretation).candidates.length) return false
        }
        return true
      })
      if (reachable.length) throw new ResizeReviewRequired(createResizeReview(requested, reachable, alternatives.status !== 'complete'))
    },
  }
}
