import type { ResizePriorityDiagnostic } from './resize-priority-solver'
import type { Vec3 } from './types'

/** Internal candidate compiler input shared by shadow comparisons and numeric planning; never saved. */
export interface ResizeShadowEquation {
  id: string
  terms: readonly { panelId: string; axis: Vec3; side: -1 | 0 | 1; scale: number }[]
}
export interface ResizeShadowPolicy {
  equations: readonly ResizeShadowEquation[]
  hierarchy?: boolean
  softReferences?: readonly ResizeShadowEquation[]
  diagnostics?: ResizePriorityDiagnostic[]
  adaptingCuts: ReadonlySet<string>
  /** Shared across components/candidates; each kernel invocation consumes one unit. */
  budget: { remaining: number; used: number }
}
export class ResizeShadowBudgetError extends Error {
  constructor() { super('Resize numerical solve budget exhausted.') }
}
