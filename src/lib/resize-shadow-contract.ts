import type { Vec3 } from './types'

/** Internal experimental compiler input; never supplied by UI commands or saved. */
export interface ResizeShadowEquation {
  id: string
  terms: readonly { panelId: string; axis: Vec3; side: -1 | 0 | 1; scale: number }[]
}
export interface ResizeShadowPolicy {
  equations: readonly ResizeShadowEquation[]
  adaptingCuts: ReadonlySet<string>
  /** Shared across components/candidates; each kernel invocation consumes one unit. */
  budget: { remaining: number; used: number }
}
export class ResizeShadowBudgetError extends Error {
  constructor() { super('Shadow resize numerical solve budget exhausted.') }
}
