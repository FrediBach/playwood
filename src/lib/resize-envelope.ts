import { Vector3 } from 'three'
import { coordinate, frame } from './resize-analysis'
import { assertResizePlacement } from './resize-placement'
import { resolvePanels } from './model'
import type { ResizePlacementIntent } from './resize-intent'
import type { Project, Vec3 } from './types'

export interface ResizeEnvelopeBoundary {
  readonly axis: 0 | 1 | 2
  readonly minPanelId: string
  readonly maxPanelId?: string
}
/** One explicit boundary hypothesis, not an automatic choice of extrema. */
export interface ResizeEnvelopeCandidate {
  readonly placement: ResizePlacementIntent
  readonly boundaries: readonly ResizeEnvelopeBoundary[]
}
export interface ResizeEnvelopeEquation {
  readonly value: number
  readonly terms: readonly { panelId: string; axis: Vec3; side: -1 | 1; scale: number }[]
}
const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

export function assertResizeEnvelopeCandidate(candidate: ResizeEnvelopeCandidate, source: Project): void {
  if (candidate.placement.source !== source) throw new Error('The project changed. Prepare the resize envelope again.')
  if (!source.panels.length || source.assemblies || source.panels.some(panel => panel.customOutline || panel.trofastInserts?.length)) {
    throw new Error('Compiled resize envelopes currently require plain panels without assembly ownership, fitted outlines or inserts.')
  }
  const ids = new Set(source.panels.map(panel => panel.id)), seen = new Set<number>()
  for (const boundary of candidate.boundaries) {
    const reference = candidate.placement.references[boundary.axis]
    if (![0, 1, 2].includes(boundary.axis) || seen.has(boundary.axis) || reference === 'authored'
      || !ids.has(boundary.minPanelId) || (reference === 'center' ? !boundary.maxPanelId || !ids.has(boundary.maxPanelId) : boundary.maxPanelId !== undefined)) {
      throw new Error('Choose exactly the required minimum and maximum panels for each resize envelope axis.')
    }
    seen.add(boundary.axis)
  }
  if (candidate.placement.references.some((reference, axis) => reference !== 'authored' && !seen.has(axis))) {
    throw new Error('Every default resize placement axis needs an explicit envelope boundary.')
  }
}

export function createResizeEnvelopeCandidate(placement: ResizePlacementIntent, boundaries: readonly ResizeEnvelopeBoundary[]): ResizeEnvelopeCandidate {
  const candidate = Object.freeze({ placement, boundaries: Object.freeze(boundaries.map(boundary => Object.freeze({ ...boundary }))) })
  assertResizeEnvelopeCandidate(candidate, placement.source)
  return candidate
}

/** Compile delta-edge equations and lower bounds. A nominated minimum is no
 * greater than every other minimum; a maximum is no smaller than every maximum.
 * These inequalities are essential when the controlling panel changes. */
export function compileResizeEnvelope(candidate: ResizeEnvelopeCandidate) {
  const source = candidate.placement.source
  assertResizeEnvelopeCandidate(candidate, source)
  const frames = resolvePanels(source).map(frame), byId = new Map(frames.map(item => [item.panel.id, item]))
  const rows: ResizeEnvelopeEquation[] = [], bounds: ResizeEnvelopeEquation[] = []
  const equation = (terms: ResizeEnvelopeEquation['terms'], target: number): ResizeEnvelopeEquation => ({ terms,
    value: target - terms.reduce((sum, term) => sum + coordinate(byId.get(term.panelId)!, new Vector3(...term.axis), term.side) * term.scale, 0) })
  for (const boundary of candidate.boundaries) {
    const axis = axes[boundary.axis], before = candidate.placement.bounds
    const min = { panelId: boundary.minPanelId, axis, side: -1 as const, scale: 1 }
    if (boundary.maxPanelId) {
      rows.push(equation([{ ...min, scale: 0.5 }, { panelId: boundary.maxPanelId, axis, side: 1, scale: 0.5 }],
        (before.min[boundary.axis] + before.max[boundary.axis]) / 2))
    } else rows.push(equation([min], before.min[boundary.axis]))
    for (const item of frames) {
      if (item.panel.id !== boundary.minPanelId) bounds.push(equation([
        { ...min, scale: -1 }, { panelId: item.panel.id, axis, side: -1, scale: 1 },
      ], 0))
      if (boundary.maxPanelId && item.panel.id !== boundary.maxPanelId) bounds.push(equation([
        { panelId: boundary.maxPanelId, axis, side: 1, scale: 1 }, { panelId: item.panel.id, axis, side: 1, scale: -1 },
      ], 0))
    }
  }
  return { rows, bounds }
}

/** Verify the actual resolved envelope and its nominated extrema after all
 * structural materialization. Never repair a failed candidate by translating it. */
export function assertCompiledResizeEnvelope(candidate: ResizeEnvelopeCandidate, project: Project): Project {
  assertResizePlacement(candidate.placement, project)
  const frames = resolvePanels(project).map(frame), byId = new Map(frames.map(item => [item.panel.id, item]))
  if (frames.length !== candidate.placement.source.panels.length || candidate.placement.source.panels.some(panel => !byId.has(panel.id))) {
    throw new Error('This resize changed the panels defining its envelope.')
  }
  for (const boundary of candidate.boundaries) {
    const axis = new Vector3(...axes[boundary.axis])
    const minimum = coordinate(byId.get(boundary.minPanelId)!, axis, -1)
    const maximum = boundary.maxPanelId ? coordinate(byId.get(boundary.maxPanelId)!, axis, 1) : undefined
    if (frames.some(item => coordinate(item, axis, -1) < minimum - 1e-4
      || (maximum !== undefined && coordinate(item, axis, 1) > maximum + 1e-4))) {
      throw new Error('This resize did not preserve its nominated envelope boundaries.')
    }
  }
  return project
}
