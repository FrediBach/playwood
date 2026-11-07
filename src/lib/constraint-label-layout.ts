export interface ConstraintLabelBox {
  id: string
  x: number
  y: number
  width: number
  height: number
}
const GAP = 8
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)))

/** Place measured DOM labels in canvas pixels, nearest their anchors without collisions. */
export function layoutConstraintLabels(labels: ConstraintLabelBox[], width: number, height: number): ConstraintLabelBox[] {
  const placed: ConstraintLabelBox[] = []
  for (const label of [...labels].sort((a, b) => a.id.localeCompare(b.id))) {
    const preferred = { x: label.x - label.width / 2, y: label.y - label.height - 10 }
    const candidates = [preferred, { ...preferred, y: label.y + 10 }]
    for (const box of placed) {
      candidates.push(
        { x: preferred.x, y: box.y - label.height - GAP },
        { x: preferred.x, y: box.y + box.height + GAP },
        { x: box.x - label.width - GAP, y: preferred.y },
        { x: box.x + box.width + GAP, y: preferred.y },
      )
    }
    let best = { ...label, ...preferred }, bestScore = Infinity
    for (const candidate of candidates) {
      const x = clamp(candidate.x, GAP, width - label.width - GAP)
      const y = clamp(candidate.y, GAP, height - label.height - GAP)
      const overlap = placed.reduce((sum, box) => sum +
        Math.max(0, Math.min(x + label.width + GAP, box.x + box.width + GAP) - Math.max(x, box.x)) *
        Math.max(0, Math.min(y + label.height + GAP, box.y + box.height + GAP) - Math.max(y, box.y)), 0)
      const score = overlap * 1e6 + (x - preferred.x) ** 2 + (y - preferred.y) ** 2
      if (score < bestScore) { best = { ...label, x, y }; bestScore = score }
    }
    placed.push(best)
  }
  return placed
}
