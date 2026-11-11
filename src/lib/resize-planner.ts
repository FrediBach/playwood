import { validateResizeCandidate } from './resize-candidate-validation'
import type { ResizePriorityDiagnostic } from './resize-priority-solver'
import { designConstraintPanelIds } from './design-constraints'
import { Vector3 } from 'three'
import { analyzeResizeEvidence, type ResizeEvidence } from './resize-evidence'
import { frame, coordinate } from './resize-analysis'
import { createResizeIntent, assertLegacyResizeIntent, type ResizeIntent, type ResizeTarget, type ResizeResult } from './resize-intent'
import { solveResizeIntent } from './structure-edit'
import { resolvePanels } from './model'
import { ResizeShadowBudgetError, type ResizeShadowEquation } from './resize-shadow-contract'
import type { Project, Vec3 } from './types'

export type ResizeInterpretation = 'preserve-cuts' | 'negative-end' | 'positive-end' | 'fitted-clearances'
/** Lexicographic consequences, in priority order. Units are documented below. */
export interface ResizeConsequences {
  evidencePenalty: number
  outsideRegion: number
  outsideReferenceChange: number
  changedCutGroups: number
  normalizedCutChange: number
  remainingReferenceError: number
  translation: number
  seamSlide: number
}
export interface ShadowResizeCandidate {
  interpretation: ResizeInterpretation
  explanations: readonly string[]
  evidenceIds: readonly string[]
  project: Project
  score: ResizeConsequences
  /** Exact defining references, useful for developer diagnostics. */
  equations: readonly ResizeShadowEquation[]
  adaptingCuts: ReadonlySet<string>
  diagnostics: readonly ResizePriorityDiagnostic[]
}
export interface ShadowResizeAttempt {
  interpretation: ResizeInterpretation
  status: ResizeResult['status'] | 'search-budget-exhausted'
  message?: string
}
const scoreKeys: (keyof ResizeConsequences)[] = ['evidencePenalty', 'outsideRegion', 'outsideReferenceChange',
  'changedCutGroups', 'normalizedCutChange', 'remainingReferenceError', 'translation', 'seamSlide']
export function hasDecisiveResizeFit(evidence: readonly ResizeEvidence[]) {
  return evidence.some(item => item.detector === 'opposing-faces' && !item.contrary.length)
    || (evidence.length > 0 && evidence.every(item => item.detector === 'structural-span'
      || (item.detector === 'connected-seam' && item.residuals.every(value => Math.abs(value) < item.tolerance))))
}
export function compareResizeConsequences(a: ResizeConsequences, b: ResizeConsequences) {
  for (const key of scoreKeys) if (Math.abs(a[key] - b[key]) > 1e-5) return a[key] - b[key]
  return 0
}
const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const magnitude = (values: number[]) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
const fingerprint = (project: Project) => JSON.stringify({
  panels: resolvePanels(project).sort((a, b) => a.id.localeCompare(b.id)).map(p => [p.id, ...[p.width, p.height, p.thickness, ...p.position, ...p.rotation].map(n => Math.round(n * 1e4))]),
  connections: [...project.connections].sort((a, b) => a.id.localeCompare(b.id)).map(c => [c.id, Math.round(c.offset * 1e4)]),
  overrides: project.connectorOverrides,
})

const targetSignature = (target: ResizeTarget) => JSON.stringify(target.kind === 'panel-edge'
  ? [target.kind, target.edge.panelId, target.edge.dimension, target.edge.side, target.local]
  : target.kind === 'selection-dimensions' ? [target.kind, [...target.panelIds].sort(), Object.keys(target.dimensions).filter(key => target.dimensions[key as 'width' | 'height'] !== undefined).sort()]
    : [target.kind])

/** Shared bounded semantic search. Candidate-defining rows never enter greedy
 * preference recovery. Ordinary numeric edits enable true priorities; the shadow
 * wrapper retains the stage 2 comparison policy. Neither path commits history. */
export function prepareResizeCandidates(intent: ResizeIntent, options: { maxSolves?: number; maxInterpretations?: number; hierarchy?: boolean } = {}) {
  assertLegacyResizeIntent(intent)
  if (!((intent.target.kind === 'selection-dimensions' && intent.origin === 'panel') || (intent.target.kind === 'panel-edge' && !intent.target.local)) || intent.releasedRelationshipId) {
    throw new Error('Intent planning supports ordinary dimensions and connected panel edges only.')
  }
  const target = intent.target
  const panelIds = target.kind === 'panel-edge' ? [target.edge.panelId] : target.panelIds
  const dimensions = target.kind === 'panel-edge' ? { [target.edge.dimension]: 0 } : target.dimensions
  const analysis = analyzeResizeEvidence(intent.source, panelIds)
  // Canonical compilation removes incidental input-array ordering. IDs are never
  // used to select among materially distinct outcomes: all contenders survive.
  const source: Project = { ...intent.source, panels: [...intent.source.panels].sort((a, b) => a.id.localeCompare(b.id)),
    connections: [...intent.source.connections].sort((a, b) => a.id.localeCompare(b.id)),
    constraints: intent.source.constraints ? [...intent.source.constraints].sort((a, b) => a.id.localeCompare(b.id)) : undefined }
  const original = new Map(resolvePanels(source).map(panel => [panel.id, panel]))
  const selected = new Set(panelIds)
  const requestedCuts = new Set(panelIds.flatMap(id => Object.entries(dimensions).filter(([, value]) => value !== undefined).map(([dimension]) => `${id}/${dimension}`)))
  const activeCuts = new Set(requestedCuts)
  const relevant = new Set<ResizeEvidence>()
  const spanningBoundaries = new Set<string>()
  // Propagation follows references spanning a requested cut, not equal numbers
  // or authored-rule connectivity. This is independent of the driving forest.
  for (let changed = true; changed;) {
    changed = false
    for (const evidence of analysis.evidence) {
      const referencesRequestedBoundary = (evidence.detector === 'opposing-faces' || evidence.detector === 'structural-span')
        && evidence.panelIds.slice(1).some(id => selected.has(id) || spanningBoundaries.has(id))
      if (!relevant.has(evidence) && (evidence.cuts.some(cut => activeCuts.has(cut)) || referencesRequestedBoundary
        || (evidence.detector === 'structural-span' && evidence.panelIds.slice(1).some(id => spanningBoundaries.has(id))))) {
        relevant.add(evidence)
        evidence.cuts.forEach(cut => activeCuts.add(cut))
        if (evidence.detector === 'structural-span') evidence.panelIds.slice(1).forEach(id => spanningBoundaries.add(id))
        changed = true
      }
    }
  }
  const authoredCuts = new Set(requestedCuts)
  if (options.hierarchy) for (let changed = true; changed;) {
    changed = false
    for (const rule of source.constraints ?? []) {
      if (!rule.enabled || rule.kind !== 'equal-dimension') continue
      const cuts = rule.panelIds.map((id, i) => `${id}/${i === 1 ? rule.secondDimension ?? rule.dimension : rule.dimension}`)
      if (cuts.some(cut => authoredCuts.has(cut))) for (const cut of cuts) if (!authoredCuts.has(cut)) {
        authoredCuts.add(cut)
        changed = true
      }
    }
  }
  const evidence = [...relevant]
  const directlyAffected = new Set([...selected, ...evidence.flatMap(item => item.panelIds)])
  const sections = analysis.sections.filter(section => section.boundaryPanelIds.some(id => directlyAffected.has(id)))
  const region = new Set([...selected, ...evidence.filter(item => item.panelIds.some(id => selected.has(id))).flatMap(item => item.panelIds),
    ...sections.flatMap(section => section.panelIds)])
  const components = new Map([...original.keys()].map(id => [id, id]))
  const componentRoot = (id: string): string => components.get(id) === id ? id : componentRoot(components.get(id)!)
  const relations = [...analysis.physical.joints.map(joint => joint.panelIds), ...analysis.physical.contacts.map(contact => contact.panelIds),
    ...(source.constraints ?? []).filter(rule => rule.enabled).map(designConstraintPanelIds)]
  for (const [first, ...rest] of relations) for (const id of rest) components.set(componentRoot(id), componentRoot(first))
  const anchorGroups = new Map<string, string[]>()
  for (const id of selected) if (original.has(id)) {
    const root = componentRoot(id)
    anchorGroups.set(root, [...anchorGroups.get(root) ?? [], id])
  }
  const numericalCache = new Map<string, number[][]>()
  return (nextIntent: ResizeIntent, only?: ResizeInterpretation) => {
    assertLegacyResizeIntent(nextIntent)
    if (nextIntent.source !== intent.source || targetSignature(nextIntent.target) !== targetSignature(target)
      || nextIntent.origin !== intent.origin || nextIntent.releasedRelationshipId !== intent.releasedRelationshipId
      || JSON.stringify(nextIntent.validation) !== JSON.stringify(intent.validation)
      || JSON.stringify(nextIntent.session) !== JSON.stringify(intent.session)) throw new Error('The resize source or target changed during this gesture.')
    const request = createResizeIntent(source, nextIntent.target, { ...nextIntent.validation, origin: nextIntent.origin, session: nextIntent.session })
    const canonicalBudget = (value: number | undefined, fallback: number) => Number.isFinite(value) ? Math.max(0, Math.min(fallback, Math.floor(value!))) : fallback
    const budget = { remaining: canonicalBudget(options.maxSolves, 32), used: 0 }
    const interpretationLimit = canonicalBudget(options.maxInterpretations, 8)
    const kinds: ResizeInterpretation[] = evidence.some(item => item.detector !== 'structural-span') ? ['preserve-cuts', 'negative-end', 'positive-end', 'fitted-clearances'] : ['preserve-cuts']
    const candidates: ShadowResizeCandidate[] = [], attempts: ShadowResizeAttempt[] = []
    let exhausted = false
    for (const interpretation of only ? [only] : kinds) {
      if (attempts.length >= interpretationLimit || budget.remaining <= 0) { exhausted = true; break }
      const equations: ResizeShadowEquation[] = []
      const adaptingCuts = new Set([...(interpretation === 'fitted-clearances' ? activeCuts : [...requestedCuts, ...evidence.filter(item => item.detector === 'structural-span').flatMap(item => item.cuts)]),
        ...authoredCuts, ...analysis.physical.outlinePanelIds.flatMap(id => [`${id}/width`, `${id}/height`])])
      // A numeric anchor is a conservative candidate choice, not a new public rule.
      // The candidate is rejected if it conflicts with an authored reference.
      if (!options.hierarchy && target.kind === 'selection-dimensions') for (const axis of axes) for (const ids of anchorGroups.values()) equations.push({ id: `anchor/${ids.join('/')}/${axis.join()}`,
        terms: ids.map(id => ({ panelId: id, axis, side: 0, scale: 1 / ids.length })) })
      for (const item of evidence) {
        if (interpretation === 'fitted-clearances' || item.detector === 'structural-span') equations.push(...item.equations)
        else if (interpretation !== 'preserve-cuts') equations.push(item.equations[interpretation === 'negative-end' ? 0 : 1])
      }
      if (interpretation !== 'fitted-clearances') for (const section of sections) {
        const [first, ...rest] = section.panelIds
        for (const id of rest) for (const axis of axes) equations.push({ id: `rigid/${first}/${id}/${axis.join()}`,
          terms: [{ panelId: first, axis, side: 0, scale: 1 }, { panelId: id, axis, side: 0, scale: -1 }] })
      }
      const diagnostics: ResizePriorityDiagnostic[] = []
      const hardIds = new Set(equations.map(equation => equation.id))
      const softReferences = evidence.flatMap(item => item.equations).filter(equation => !hardIds.has(equation.id))
      const result = solveResizeIntent(request, { shadow: { equations, adaptingCuts, budget, hierarchy: options.hierarchy, softReferences, diagnostics, numericalCache } })
      if (result.status !== 'solved') {
        const budgetError = result.error instanceof ResizeShadowBudgetError
        attempts.push({ interpretation, status: budgetError ? 'search-budget-exhausted' : result.status, message: result.diagnostic.message })
        if (budgetError) { exhausted = true; break }
        continue
      }
      let next = result.project
      try {
        next = validateResizeCandidate(nextIntent, next, equations, adaptingCuts)
      } catch (error) {
        attempts.push({ interpretation, status: 'candidate-invalid', message: error instanceof Error ? error.message : String(error) })
        continue
      }
      attempts.push({ interpretation, status: 'solved' })
      const after = new Map(resolvePanels(next).sort((a, b) => a.id.localeCompare(b.id)).map(panel => [panel.id, panel]))
      const changedCuts = new Set<string>()
      let normalizedCutChange = 0, translation = 0, outsideRegion = 0, outsideReferenceChange = 0
      for (const [id, panel] of after) {
        const before = original.get(id)!
        const travel = magnitude(panel.position.map((value, axis) => value - before.position[axis]))
        translation += travel
        let recut = false
        for (const dimension of ['width', 'height'] as const) {
          const delta = Math.abs(panel[dimension] - before[dimension])
          if (delta > 1e-4) { recut = true; changedCuts.add(`${id}/${dimension}`); normalizedCutChange += delta / before[dimension] }
        }
        if (!region.has(id) && (recut || travel > 1e-4)) outsideRegion++
        // References on panels outside the semantic region are meaningful scope costs.
        if (!region.has(id)) outsideReferenceChange += travel
      }
      const groups = new Map([...changedCuts].map(cut => [cut, cut]))
      const root = (cut: string): string => groups.get(cut) === cut ? cut : root(groups.get(cut)!)
      if (interpretation === 'fitted-clearances') for (const item of evidence) {
        const cuts = item.cuts.filter(cut => changedCuts.has(cut))
        for (const cut of cuts.slice(1)) groups.set(root(cut), root(cuts[0]))
      }
      const independentGroups = new Set([...changedCuts].map(root)).size
      const strongFit = options.hierarchy ? hasDecisiveResizeFit(evidence) : evidence.some(item => item.detector === 'opposing-faces' && !item.contrary.length)
      const endPenalties = new Map<string, number>()
      for (const item of evidence.filter(item => item.detector === 'connected-seam')) {
        const [negative, positive] = item.residuals.map(Math.abs)
        const asymmetry = Math.abs(negative - positive) / (1 + negative + positive)
        const preservesNearEnd = interpretation === (negative < positive ? 'negative-end' : 'positive-end')
        const penalty = preservesNearEnd ? 0 : asymmetry
        const key = item.jointIds[0] ?? item.id
        endPenalties.set(key, Math.max(endPenalties.get(key) ?? 0, penalty))
      }
      const evidencePenalty = strongFit ? (interpretation === 'fitted-clearances' ? 0 : 1)
        : interpretation === 'fitted-clearances' ? 1 : Math.max(0, ...endPenalties.values())
      let remainingReferenceError = 0
      const jointErrors = new Map<string, number>()
      for (const item of evidence) {
        const residual = item.equations.reduce((sum, equation) => sum + Math.abs(equation.terms.reduce((total, term) => total + term.scale
          * (coordinate(frame(after.get(term.panelId)!), new Vector3(...term.axis), term.side)
            - coordinate(frame(original.get(term.panelId)!), new Vector3(...term.axis), term.side)), 0)), 0)
        // Branch count does not amplify the same physical joint's evidence.
        const key = item.jointIds[0] ?? item.id
        jointErrors.set(key, Math.max(jointErrors.get(key) ?? 0, residual))
      }
      remainingReferenceError = [...jointErrors.values()].reduce((sum, value) => sum + value, 0)
      const beforeConnections = new Map(source.connections.map(c => [c.id, c]))
      const seamSlide = next.connections.reduce((sum, c) => sum + Math.abs(c.offset - beforeConnections.get(c.id)!.offset), 0)
      const candidate: ShadowResizeCandidate = { interpretation, project: next, equations, adaptingCuts, diagnostics, evidenceIds: evidence.map(item => item.id),
        explanations: [interpretation === 'fitted-clearances' ? 'Preserve paired measured clearances; only identified spanning cuts may adapt.'
          : interpretation === 'preserve-cuts' ? 'Keep dependent cuts and rigid sections; minimize remaining displacement.'
            : `Keep dependent cuts and the ${interpretation === 'negative-end' ? 'negative' : 'positive'} measured end references.`,
        strongFit ? 'Opposing orthogonal faces with small margins support a fitted span.' : 'No decisive opposing-face fit; prefer fixed cuts and the nearer end when margins are asymmetric.',
        'Targets, joints, protected contacts, saved rules and candidate references remain hard.'],
        score: { evidencePenalty, outsideRegion, outsideReferenceChange, changedCutGroups: independentGroups, normalizedCutChange,
          remainingReferenceError, translation, seamSlide } }
      const equivalent = candidates.findIndex(existing => fingerprint(existing.project) === fingerprint(next))
      if (equivalent < 0) candidates.push(candidate)
      else if (compareResizeConsequences(candidate.score, candidates[equivalent].score) < 0) candidates[equivalent] = candidate
    }
    candidates.sort((a, b) => compareResizeConsequences(a.score, b.score))
    // This is a comparison report, never a proof that the search was complete or infeasible.
    return { source: intent.source, analysis, candidates, attempts, numericalSolves: budget.used,
      status: exhausted ? 'search-budget-exhausted' as const : 'complete' as const,
      ambiguous: candidates.length > 1 }
  }
}

export function planResizeCandidates(intent: ResizeIntent, options: { maxSolves?: number; maxInterpretations?: number; hierarchy?: boolean } = {}) {
  return prepareResizeCandidates(intent, options)(intent)
}

/** Stage 2 comparison stays available without activating hierarchy or UI policy. */
export function planResizeShadow(intent: ResizeIntent, options: { maxSolves?: number; maxInterpretations?: number } = {}) {
  return { ...planResizeCandidates(intent, options), legacy: solveResizeIntent(intent) }
}
