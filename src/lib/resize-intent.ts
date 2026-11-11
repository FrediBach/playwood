import { assertResizeEnvelopeCandidate, createResizeEnvelopeCandidate, type ResizeEnvelopeCandidate } from './resize-envelope'
import type { ResizeAnalysis } from './resize-analysis'
import type { NumericalDiagnostic, RowProvenance } from './structural-solver'
import type { Panel, Project } from './types'

export type ResizeDimensions = Partial<Pick<Panel, 'width' | 'height'>>
export type PanelResizeDimensions = Partial<Pick<Panel, 'width' | 'height' | 'thickness'>>
export interface PanelEdgeResize { panelId: string; dimension: 'width' | 'height'; side: -1 | 1; distance: number }
export interface InferredRelationship {
  id: string
  kind: 'setback' | 'alignment' | 'compartment-fit'
  description: string
  panelIds: string[]
}
export interface ResizeSessionIdentity { readonly id: string; readonly revision: number }
export interface ResizeContext {
  trofastWorld?: boolean
  /** Experimental explicit boundary candidate; ordinary callers leave this unset. */
  envelope?: ResizeEnvelopeCandidate
  origin?: 'panel' | 'preview' | 'project-rescale' | 'assembly-parameters' | 'rim-alignment'
  session?: ResizeSessionIdentity
  /** Explicit legacy review only; never an authored rule or protected contact. */
  releasedRelationshipId?: string
}
export type ResizeTarget =
  | { readonly kind: 'selection-dimensions'; readonly panelIds: readonly string[]; readonly dimensions: Readonly<ResizeDimensions> }
  | { readonly kind: 'panel-dimensions'; readonly patches: Readonly<Record<string, Readonly<PanelResizeDimensions>>> }
  | { readonly kind: 'panel-edge'; readonly edge: Readonly<PanelEdgeResize>; readonly local: boolean }
  | { readonly kind: 'panel-edges'; readonly edges: readonly Readonly<PanelEdgeResize>[]; readonly refitOutlinePanelIds: readonly string[] }

/** Specialized caller placement after full materialization. World projects and
 * evaluated assembly-source geometry have intentionally different frames. */
export interface ResizePlacementIntent {
  readonly source: Project
  readonly frame: 'world' | 'assembly-local'
  readonly references: readonly ('center' | 'min' | 'authored')[]
  readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] }
}

/** Transient request. Source identity is borrowed from immutable project history. */
export interface ResizeIntent {
  readonly source: Project
  readonly target: ResizeTarget
  readonly origin: NonNullable<ResizeContext['origin']>
  readonly session?: ResizeSessionIdentity
  readonly envelope?: ResizeEnvelopeCandidate
  readonly anchor: 'explicit-envelope' | 'selected-average-per-component-preference' | 'exact-opposite-edge' | 'exact-opposite-edges'
  readonly scope: 'connected' | 'local'
  readonly hardware: 'proportional-rail-distribution' | 'fixed-world-positions' | 'fixed-except-refitted-outlines'
  readonly validation: Readonly<{ trofastWorld?: boolean }>
  readonly releasedRelationshipId?: string
  /** Snapping/rounding and reachable-preview clamping still belong to existing callers. */
  readonly finalization: 'caller-owned'
  readonly snap: 'resolved-by-caller'
  readonly policy: 'legacy'
}

function legacyPolicy(target: ResizeTarget): Pick<ResizeIntent, 'anchor' | 'scope' | 'hardware'> {
  const local = target.kind === 'panel-edges' || (target.kind === 'panel-edge' && target.local)
  return {
    anchor: target.kind === 'panel-edge' ? 'exact-opposite-edge' : target.kind === 'panel-edges' ? 'exact-opposite-edges' : 'selected-average-per-component-preference',
    scope: local ? 'local' : 'connected',
    hardware: target.kind === 'panel-edges' && target.refitOutlinePanelIds.length ? 'fixed-except-refitted-outlines'
      : local ? 'fixed-world-positions' : 'proportional-rail-distribution',
  }
}

export function createResizeIntent(source: Project, target: ResizeTarget, context: ResizeContext = {}): ResizeIntent {
  let owned: ResizeTarget
  if (target.kind === 'selection-dimensions') owned = Object.freeze({ ...target,
    panelIds: Object.freeze([...target.panelIds]), dimensions: Object.freeze({ ...target.dimensions }) })
  else if (target.kind === 'panel-dimensions') owned = Object.freeze({ ...target,
    patches: Object.freeze(Object.assign(Object.create(null), Object.fromEntries(Object.entries(target.patches)
      .map(([id, patch]) => [id, Object.freeze({ ...patch })])))) })
  else if (target.kind === 'panel-edge') owned = Object.freeze({ ...target, edge: Object.freeze({ ...target.edge }) })
  else owned = Object.freeze({ ...target, edges: Object.freeze(target.edges.map(edge => Object.freeze({ ...edge }))),
    refitOutlinePanelIds: Object.freeze([...target.refitOutlinePanelIds]) })
  return Object.freeze({ source, target: owned, origin: context.origin ?? (target.kind === 'panel-edges' ? 'rim-alignment' : 'panel'),
    session: context.session ? Object.freeze({ ...context.session }) : undefined,
    ...legacyPolicy(owned),
    ...(context.envelope ? { anchor: 'explicit-envelope' as const, envelope: createResizeEnvelopeCandidate(context.envelope.placement, context.envelope.boundaries) } : {}),
    validation: Object.freeze({ trofastWorld: context.trofastWorld }), releasedRelationshipId: context.releasedRelationshipId,
    finalization: 'caller-owned', snap: 'resolved-by-caller', policy: 'legacy' })
}

/** Reject an unsupported interpretation rather than silently replacing its anchor or policy. */
export function assertLegacyResizeIntent(intent: ResizeIntent): void {
  const expected = legacyPolicy(intent.target)
  if (intent.envelope) {
    assertResizeEnvelopeCandidate(intent.envelope, intent.source)
    if (intent.target.kind !== 'panel-dimensions' || !['project-rescale', 'assembly-parameters'].includes(intent.origin) || intent.releasedRelationshipId) {
      throw new Error('Compiled envelope anchors support specialized simultaneous dimension requests only.')
    }
  }
  if (intent.anchor !== (intent.envelope ? 'explicit-envelope' : expected.anchor) || intent.scope !== expected.scope || intent.hardware !== expected.hardware
    || intent.policy !== 'legacy' || intent.finalization !== 'caller-owned' || intent.snap !== 'resolved-by-caller') {
    throw new Error('This resize interpretation is not supported by the legacy solver adapter.')
  }
}

export interface ResizeProblemRow {
  readonly entries: readonly (readonly [number, number])[]
  readonly value: number
  readonly provenance: Readonly<RowProvenance>
  readonly relationship?: { readonly id: string; readonly kind: InferredRelationship['kind']; readonly description: string; readonly panelIds: readonly string[] }
}
/** Optional developer inspection; rows are in the compiler's original order. */
export interface ResizeProblem {
  readonly panelIds: readonly string[]
  readonly variables: readonly string[]
  readonly weights: readonly number[]
  readonly rows: readonly ResizeProblemRow[]
  readonly bounds: readonly ResizeProblemRow[]
}
export interface ResizeDiagnostic {
  readonly message: string
  readonly panelIds: readonly string[]
  readonly connectionIds: readonly string[]
  readonly inferredRelationships: readonly InferredRelationship[]
  readonly numerical?: NumericalDiagnostic
}
interface ResizeResultBase {
  readonly intent: ResizeIntent
  /** Present only when inspection is requested. Not cached or persisted. */
  readonly analysis?: ResizeAnalysis
  readonly problems: readonly ResizeProblem[]
}
export type ResizeResult = ResizeResultBase & (
  | { readonly status: 'solved'; readonly project: Project }
  | { readonly status: 'invalid-request' | 'infeasible' | 'numerical-failure' | 'candidate-invalid' | 'rejected'; readonly error: unknown; readonly diagnostic: ResizeDiagnostic }
)

/** Existing throwing command APIs preserve their original error instance and message. */
export function unwrapResizeResult(result: ResizeResult): Project {
  if (result.status !== 'solved') throw result.error
  return result.project
}

export function acceptResizeResult(current: Project, result: ResizeResult, session?: ResizeSessionIdentity): Project {
  if (current !== result.intent.source || (result.intent.session
    && (session?.id !== result.intent.session.id || session.revision !== result.intent.session.revision))) {
    throw new Error('The project or resize session changed. Try the resize again.')
  }
  return unwrapResizeResult(result)
}
