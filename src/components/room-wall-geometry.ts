type Triple = [number, number, number]

/** A rectangle on a wall: `s` runs along the wall, `y` up from the floor. */
export interface WallRect { s0: number; s1: number; y0: number; y1: number }

/** One wall's room-facing plane: `origin` is s = 0 at floor level and `along` the unit direction of s. */
export interface WallFace { name: string; origin: Triple; along: Triple; hole?: WallRect }

/** Splits a rectangle around a hole into up to four rectangles. */
export function aroundHole(rect: WallRect, hole?: WallRect): WallRect[] {
  if (!hole || hole.s1 <= rect.s0 || hole.s0 >= rect.s1 || hole.y1 <= rect.y0 || hole.y0 >= rect.y1) return [rect]
  const y0 = Math.max(rect.y0, hole.y0), y1 = Math.min(rect.y1, hole.y1)
  return [
    { ...rect, y1: y0 }, { ...rect, y0: y1 },
    { s0: rect.s0, s1: Math.max(rect.s0, hole.s0), y0, y1 }, { s0: Math.min(rect.s1, hole.s1), s1: rect.s1, y0, y1 },
  ].filter(part => part.s1 - part.s0 > 1e-4 && part.y1 - part.y0 > 1e-4)
}
