import { Vector3 } from 'three'
import { resolvePanels, validateProject } from './model'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { assertNoNewTrofastIssues } from './trofast'
import { analyzeStructure, coordinate, frame } from './resize-analysis'
import { getPhysicalConnectors } from './connector-selection'
import type { ResizeIntent } from './resize-intent'
import type { ResizeShadowEquation } from './resize-shadow-contract'
import type { Panel, Project, ValidationIssue } from './types'

export const RESIZE_OUTCOME_TOLERANCE = 1e-4
const issueKey = (issue: ValidationIssue) => issue.id.startsWith('collision-') ? `collision/${[...issue.panelIds].sort().join('/')}` : issue.id
const geometry = (panel: Panel) => [panel.width, panel.height, panel.thickness, ...panel.position, ...panel.rotation]
const changed = (a: Panel, b: Panel) => geometry(a).some((n, i) => Math.abs(n - geometry(b)[i]) > RESIZE_OUTCOME_TOLERANCE)
  || JSON.stringify(a.customOutline) !== JSON.stringify(b.customOutline)
const identities = (values: readonly string[]) => JSON.stringify([...values].sort())

/** A validator belongs to one immutable source snapshot and validation mode.
 * Cache only source facts, lazily in the original check order. Candidates and
 * review acceptance still run every target, physical and no-worsening check. */
export function prepareResizeCandidateValidator(initial: ResizeIntent) {
  const source = initial.source, trofastWorld = initial.validation.trofastWorld
  let panelIds: string | undefined, connectionIds: string | undefined, hardwareIds: string | undefined
  let constraints: string | undefined, assemblies: string | undefined, assembliesRead = false
  let before: Map<string, Panel> | undefined, physical: ReturnType<typeof analyzeStructure> | undefined
  let issues: ValidationIssue[] | undefined
  const baseline = {
    get panelIds() { return panelIds ??= identities(source.panels.map(p => p.id)) },
    get connectionIds() { return connectionIds ??= identities(source.connections.map(c => c.id)) },
    get hardwareIds() { return hardwareIds ??= identities(getPhysicalConnectors(source).map(c => c.id)) },
    get constraints() { return constraints ??= JSON.stringify([...(source.constraints ?? [])].sort((a, b) => a.id.localeCompare(b.id))) },
    get assemblies() { if (!assembliesRead) { assemblies = JSON.stringify(source.assemblies); assembliesRead = true } return assemblies },
    get before() { return before ??= new Map(resolvePanels(source).map(p => [p.id, p])) },
    get physical() { return physical ??= analyzeStructure(source) },
    get issues() { return issues ??= validateProject(source, initial.validation) },
  }
  return (intent: ResizeIntent, candidate: Project, equations: readonly ResizeShadowEquation[], adaptingCuts: ReadonlySet<string>) => {
    if (intent.source !== source || intent.validation.trofastWorld !== trofastWorld) throw new Error('Prepare resize validation again for the changed source or validation mode.')
    return validateCandidate(intent, candidate, equations, adaptingCuts, baseline)
  }
}

/** Final acceptance for ordinary dimensions and connected edges, shared by planning and review.
 * Baseline issues cannot be declared non-worsening by ID alone. Measure fixed-axis
 * collision overlaps; otherwise keep involved geometry/hardware unchanged when
 * no existing domain-specific severity guard is available. */
export function validateResizeCandidate(intent: ResizeIntent, candidate: Project, equations: readonly ResizeShadowEquation[], adaptingCuts: ReadonlySet<string>): Project {
  return prepareResizeCandidateValidator(intent)(intent, candidate, equations, adaptingCuts)
}

type ValidationBaseline = {
  readonly panelIds: string; readonly connectionIds: string; readonly hardwareIds: string
  readonly constraints: string; readonly assemblies: string | undefined
  readonly before: Map<string, Panel>; readonly physical: ReturnType<typeof analyzeStructure>; readonly issues: ValidationIssue[]
}
function validateCandidate(intent: ResizeIntent, candidate: Project, equations: readonly ResizeShadowEquation[], adaptingCuts: ReadonlySet<string>, baseline: ValidationBaseline): Project {
  const source = intent.source
  if (baseline.panelIds !== identities(candidate.panels.map(p => p.id))
    || baseline.connectionIds !== identities(candidate.connections.map(c => c.id))
    || baseline.hardwareIds !== identities(getPhysicalConnectors(candidate).map(c => c.id))) throw new Error('This resize changed structural identities.')
  if (baseline.constraints !== JSON.stringify([...(candidate.constraints ?? [])].sort((a, b) => a.id.localeCompare(b.id))) || baseline.assemblies !== JSON.stringify(candidate.assemblies)) {
    throw new Error('This resize changed saved rules or assembly ownership.')
  }
  const before = baseline.before, after = new Map(resolvePanels(candidate).map(p => [p.id, p]))
  const target = intent.target
  if (target.kind !== 'selection-dimensions' && target.kind !== 'panel-edge') throw new Error('Resize acceptance requires dimensions or an edge target.')
  const selected = new Set(target.kind === 'panel-edge' ? [target.edge.panelId] : target.panelIds)
  const dimensions = target.kind === 'panel-edge' ? { [target.edge.dimension]: before.get(target.edge.panelId)![target.edge.dimension] + target.edge.distance } : target.dimensions
  if (target.kind === 'panel-edge') {
    const { panelId, dimension, side, distance } = target.edge
    const previous = frame(before.get(panelId)!), next = after.get(panelId)!
    const expected = new Vector3(...previous.panel.position).addScaledVector(previous.axes[dimension === 'width' ? 0 : 1], side * distance / 2)
    if (expected.distanceTo(new Vector3(...next.position)) > RESIZE_OUTCOME_TOLERANCE) throw new Error('This resize moved its fixed opposite edge.')
  }
  for (const [id, panel] of after) {
    const previous = before.get(id)!
    if (geometry(panel).some(n => !Number.isFinite(n)) || panel.rotation.some((n, i) => Math.abs(n - previous.rotation[i]) > RESIZE_OUTCOME_TOLERANCE)
      || Math.abs(panel.thickness - previous.thickness) > RESIZE_OUTCOME_TOLERANCE) throw new Error('This resize changed a fixed physical input.')
    for (const dimension of ['width', 'height'] as const) {
      const expected = selected.has(id) ? dimensions[dimension] ?? previous[dimension]
        : adaptingCuts.has(`${id}/${dimension}`) ? undefined : previous[dimension]
      if (expected !== undefined && Math.abs(panel[dimension] - expected) > RESIZE_OUTCOME_TOLERANCE) throw new Error('This resize missed a requested or preserved cut.')
    }
  }
  for (const equation of equations) {
    const residual = equation.terms.reduce((sum, term) => sum + term.scale * (coordinate(frame(after.get(term.panelId)!), new Vector3(...term.axis), term.side)
      - coordinate(frame(before.get(term.panelId)!), new Vector3(...term.axis), term.side)), 0)
    if (Math.abs(residual) > RESIZE_OUTCOME_TOLERANCE) throw new Error('This resize changed its chosen alignment or rigid section.')
  }
  const physical = baseline.physical
  for (const contact of physical.contacts) {
    const a = frame(after.get(physical.frames[contact.a].panel.id)!), b = frame(after.get(physical.frames[contact.b].panel.id)!)
    if (Math.abs(coordinate(b, contact.normal, -contact.sign) - coordinate(a, contact.normal, contact.sign)) > RESIZE_OUTCOME_TOLERANCE
      || [...a.axes, ...b.axes].filter(axis => Math.abs(axis.dot(contact.normal)) < 1e-6).some(axis =>
        Math.min(coordinate(a, axis, 1), coordinate(b, axis, 1)) - Math.max(coordinate(a, axis, -1), coordinate(b, axis, -1)) <= RESIZE_OUTCOME_TOLERANCE)) {
      throw new Error('This resize would leave an insert unsupported.')
    }
  }
  candidate = assertNoNewTrofastIssues(source, assertDesignConstraintEdit(source, candidate))
  const previousIssues = baseline.issues, previousKeys = new Set(previousIssues.map(issueKey))
  const issue = validateProject(candidate, intent.validation).find(issue => !previousKeys.has(issueKey(issue)))
  if (issue) throw new Error(issue.message)
  for (const issue of previousIssues) {
    // Saved rules and build space already have measured no-worsening guards.
    if (issue.id.startsWith('constraint-')) continue
    if (issue.id.startsWith('collision-') && issue.panelIds.length === 2) {
      const [first, second] = issue.panelIds
      const a = frame(before.get(first)!), b = frame(before.get(second)!)
      const nextA = frame(after.get(first)!), nextB = frame(after.get(second)!)
      const axes = [...a.axes, ...b.axes, ...a.axes.flatMap(x => b.axes.map(y => x.clone().cross(y)))].filter(axis => axis.lengthSq() > 1e-12).map(axis => axis.clone().normalize())
      const overlap = (x: typeof a, y: typeof b, axis: Vector3) => Math.max(0,
        Math.min(coordinate(x, axis, 1), coordinate(y, axis, 1)) - Math.max(coordinate(x, axis, -1), coordinate(y, axis, -1)))
      if (axes.some(axis => overlap(nextA, nextB, axis) > overlap(a, b, axis) + RESIZE_OUTCOME_TOLERANCE)) {
        throw new Error(`This resize would worsen an existing panel overlap: ${issue.message}`)
      }
      continue
    }
    const affected = new Set(issue.panelIds)
    const oldConnections = source.connections.filter(c => affected.has(c.parentId) || affected.has(c.childId))
    const nextConnections = new Map(candidate.connections.map(c => [c.id, c]))
    const hardwareChanged = oldConnections.some(c => JSON.stringify(c) !== JSON.stringify(nextConnections.get(c.id)))
      || (JSON.stringify(source.connectorOverrides) !== JSON.stringify(candidate.connectorOverrides)
        && oldConnections.length > 0)
    if ([...affected].some(id => before.has(id) && after.has(id) && changed(before.get(id)!, after.get(id)!)) || hardwareChanged) {
      throw new Error(`Resolve this existing issue before resizing the affected parts: ${issue.message}`)
    }
  }
  // Preserve authoring/list order; canonical ordering is only a solver detail.
  const panels = new Map(candidate.panels.map(p => [p.id, p])), connections = new Map(candidate.connections.map(c => [c.id, c]))
  return { ...candidate, constraints: source.constraints, panels: source.panels.map(p => panels.get(p.id)!), connections: source.connections.map(c => connections.get(c.id)!) }
}
