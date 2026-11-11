import { getProjectBounds, moveProject, resolvePanels } from './model'
import type { ResizePlacementIntent } from './resize-intent'
import type { Project, Vec3 } from './types'

const EPSILON = 1e-6
const ANCHOR_TOLERANCE = 1e-4
const geometry = (project: Project, frame: ResizePlacementIntent['frame']) => frame === 'world' ? resolvePanels(project) : project.panels

/** Capture the caller's envelope references before any dimensions, details or
 * assembly sources change. This is a placement phase, not a cut-solver policy. */
export function createResizePlacementIntent(source: Project, frame: ResizePlacementIntent['frame']): ResizePlacementIntent {
  if (frame === 'assembly-local' && (source.assemblies || source.constraints?.length || source.spaceConstraint?.enabled)) {
    throw new Error('Assembly-local resize placement requires an isolated assembly source.')
  }
  const bounds = getProjectBounds(geometry(source, frame))
  const references: ResizePlacementIntent['references'][number][] = ['center', 'min', 'center']
  if (frame === 'world') for (const rule of source.constraints ?? []) {
    if (!rule.enabled) continue
    if (rule.kind === 'floor') references[1] = 'authored'
    if (rule.kind === 'position') references[['x', 'y', 'z'].indexOf(rule.axis)] = 'authored'
  }
  return Object.freeze({ source, frame, references: Object.freeze(references),
    bounds: Object.freeze({ min: Object.freeze([...bounds.min]), max: Object.freeze([...bounds.max]) }) })
}

/** Recheck the actual final envelope, including a change in which panel supplies
 * an extremum. Do not assume the initial extremum stays the controlling panel. */
export function assertResizePlacement(intent: ResizePlacementIntent, candidate: Project): Project {
  const bounds = getProjectBounds(geometry(candidate, intent.frame))
  for (const [axis, reference] of intent.references.entries()) {
    if (reference === 'authored') continue
    const expected = reference === 'min' ? intent.bounds.min[axis] : (intent.bounds.min[axis] + intent.bounds.max[axis]) / 2
    const actual = reference === 'min' ? bounds.min[axis] : (bounds.min[axis] + bounds.max[axis]) / 2
    if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > ANCHOR_TOLERANCE) {
      throw new Error('This resize did not preserve its requested placement reference.')
    }
  }
  return candidate
}

/** Finalize only after the caller has materialized its complete candidate.
 * World placement translates instance origins with panels through moveProject;
 * source-local placement never applies a world transform to a shared definition. */
export function finishResizePlacement(current: Project, candidate: Project, intent: ResizePlacementIntent): Project {
  if (current !== intent.source) throw new Error('The project changed. Prepare the resize placement again.')
  const ids = new Set(candidate.panels.map(panel => panel.id))
  if (ids.size !== current.panels.length || candidate.panels.length !== current.panels.length || current.panels.some(panel => !ids.has(panel.id))) {
    throw new Error('This resize changed the panels defining its placement references.')
  }
  if (intent.frame === 'assembly-local' && (candidate.assemblies || candidate.constraints?.length || candidate.spaceConstraint?.enabled)) {
    throw new Error('Assembly-local resize placement requires an isolated assembly source.')
  }
  const before = intent.bounds, after = getProjectBounds(geometry(candidate, intent.frame))
  const shift = intent.references.map((reference, axis) => reference === 'authored' ? 0 : reference === 'min'
    ? before.min[axis] - after.min[axis]
    : (before.min[axis] + before.max[axis] - after.min[axis] - after.max[axis]) / 2) as Vec3
  if (!shift.every(Number.isFinite)) throw new Error('Resize placement must be finite.')
  const placed = intent.frame === 'assembly-local'
    ? { ...candidate, panels: candidate.panels.map(panel => ({ ...panel,
      position: panel.position.map((value, axis) => value + shift[axis]) as Vec3 })) }
    : shift.some(value => Math.abs(value) > EPSILON) ? moveProject(candidate, shift) : candidate
  return assertResizePlacement(intent, placed)
}
