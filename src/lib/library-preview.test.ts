import { describe, expect, it } from 'vitest'
import { createLibraryDrawing } from './library-preview'
import { createExampleProject } from './example-library'

describe('library previews', () => {
  it('draws a project as finite colored polygons without changing the project', () => {
    const project = createExampleProject('cube')
    const before = JSON.stringify(project)
    const drawing = createLibraryDrawing(project)
    expect(drawing.length).toBeGreaterThan(0)
    expect(drawing.every(face => /^#[0-9a-f]{6}$/i.test(face.color))).toBe(true)
    expect(drawing.every(face => face.points.split(/[ ,]/).every(value => Number.isFinite(Number(value))))).toBe(true)
    expect(JSON.stringify(project)).toBe(before)
  })
  it('handles projects without panels', () => {
    expect(createLibraryDrawing({ version: 1, name: 'Empty', panels: [], connections: [] })).toEqual([])
  })
})
