import type { NiceValuesSettings, Panel } from './types'

export const DEFAULT_NICE_VALUES: NiceValuesSettings = { enabled: false, step: 10 }

export function parseNiceValues(input: unknown): NiceValuesSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !('enabled' in input) || typeof input.enabled !== 'boolean'
    || !('step' in input) || typeof input.step !== 'number'
    || !Number.isFinite(input.step) || input.step < 1 || input.step > 100) {
    throw new Error('Nice values need an enabled setting and a step between 1 and 100 mm.')
  }
  return { enabled: input.enabled, step: input.step }
}

export function getNiceValueStep(settings?: NiceValuesSettings): number | undefined {
  return settings?.enabled ? settings.step : undefined
}

/** The nearest permitted multiple. Limits remain authoritative when the closest
 * unconstrained multiple would exceed the editable measurement's range. */
export function roundNiceValue(value: number, step: number, min = -Infinity, max = Infinity): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0 || Number.isNaN(min) || Number.isNaN(max) || min > max) {
    throw new Error('Nice values need a finite measurement and a positive step.')
  }
  const lower = Math.ceil(min / step - 1e-9), upper = Math.floor(max / step + 1e-9)
  if (lower > upper) throw new Error(`No multiple of ${step} mm fits between ${min} and ${max} mm. Choose a smaller nice-value step.`)
  const multiple = Math.max(lower, Math.min(upper, Math.round(value / step)))
  // Avoid binary fractions appearing in fields, saved projects and future solves.
  return Number((multiple * step).toFixed(9))
}

/** Prepare a new panel's editable sizes before it enters an attachment solve.
 * Existing connected panels must instead use their structural edit operation. */
export function roundPanelDraft(panel: Panel, settings?: NiceValuesSettings): Panel {
  const step = getNiceValueStep(settings)
  if (step === undefined) return panel
  const width = roundNiceValue(panel.width, step, 40, 4000)
  const height = roundNiceValue(panel.height, step, 40, 4000)
  const patch: Partial<Panel> = { width, height }
  if ((panel.cornerRadius ?? 0) > 0) patch.cornerRadius = roundNiceValue(panel.cornerRadius!, step, 0, Math.min(width, height) / 2)
  if (panel.pattern !== 'solid') {
    patch.holeSize = roundNiceValue(panel.holeSize, step, 2, 200)
    // Use the same material web and hole-count margin as the panel fields.
    const minPitch = Math.max(15, patch.holeSize + 6, Math.ceil(Math.sqrt(width * height / 4500)))
    patch.holeSpacing = roundNiceValue(panel.holeSpacing, step, minPitch, 500)
  }
  return Object.entries(patch).some(([field, value]) => panel[field as keyof Panel] !== value) ? { ...panel, ...patch } : panel
}
