import { describe, expect, it } from 'vitest'
import { attachPanel, createPanel, getConnectionAnchors, parseProject, projectToCsv, validateProject } from './model'
import { getOutlineError, panelCornerRadius, panelOutlineCorners, panelOutlineSvgPath } from './panel-shape'
import { updateSelectedPanels } from './selection'
import type { OutlinePoint, Project, Side } from './types'

const options = { side: 'top' as Side, type: '90' as const, offset: 0, inset: 0, flip: false, color: '#e75a35', count: 2 }
const base = (): Project => ({ version: 1, name: 'Rounded', panels: [createPanel({ id: 'p', width: 600, height: 600, position: [0, 0, 0] })], connections: [] })

describe('rounded panels', () => {
  it('clamps rounding to the resized dimensions', () => {
    expect(panelCornerRadius(createPanel({ width: 80, cornerRadius: 100 }))).toBe(40)
  })
  it('loads old files and preserves radius through JSON and cut lists', () => {
    const p = base()
    delete p.panels[0].cornerRadius
    expect(parseProject(p).panels[0].cornerRadius).toBe(0)
    p.panels[0].cornerRadius = 60
    expect(parseProject(JSON.parse(JSON.stringify(p))).panels[0].cornerRadius).toBe(60)
    expect(projectToCsv(p)).toContain('Corner radius (mm)')
    p.panels[0].cornerRadius = -1
    expect(() => parseProject(p)).toThrow('corner radius')
  })
  it('bulk edits legacy panels with implicit square corners', () => {
    const p = base()
    delete p.panels[0].cornerRadius
    expect(updateSelectedPanels(p, ['p'], { cornerRadius: 30 }).panels[0].cornerRadius).toBe(30)
  })
  it.each(['top', 'bottom', 'left', 'right'] as Side[])('moves connectors clear of both rounded %s edges', side => {
    const p = attachPanel(base(), 'p', createPanel({ width: 600, height: 600, cornerRadius: 80 }), { ...options, side })
    p.panels[0].cornerRadius = 60
    const axis = side === 'top' || side === 'bottom' ? 0 : 1
    expect(getConnectionAnchors(p.connections[0], p.panels[0], p.panels[1]).map(point => point[axis])).toEqual([-200, 200])
    p.panels[1].cornerRadius = 0
    expect(getConnectionAnchors(p.connections[0], p.panels[0], p.panels[1]).map(point => point[axis])).toEqual([-220, 220])
  })
  it('accounts for offsets and reports insufficient straight edge', () => {
    const p = attachPanel(base(), 'p', createPanel({ width: 600, height: 600, cornerRadius: 80 }), { ...options, offset: 100 })
    p.panels[0].cornerRadius = 60
    expect(getConnectionAnchors(p.connections[0], p.panels[0], p.panels[1]).map(point => point[0])).toEqual([-100, 220])
    p.panels[0].cornerRadius = 300
    expect(validateProject(p).some(issue => issue.id.endsWith('-overlap'))).toBe(true)
  })
})

describe('custom outline helpers', () => {
  const rectangle: OutlinePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  it('accepts both winding orders and collinear inserted points', () => {
    expect(getOutlineError(rectangle)).toBeNull()
    expect(getOutlineError([...rectangle].reverse())).toBeNull()
    expect(getOutlineError([rectangle[0], { x: 0.5, y: 0 }, ...rectangle.slice(1)])).toBeNull()
  })
  it('rejects malformed, overlapping, crossing and degenerate polygons', () => {
    for (const points of [null, [], rectangle.slice(0, 2), [...rectangle, rectangle[0]],
      [rectangle[0], rectangle[2], rectangle[1], rectangle[3]],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0 }],
      [{ x: NaN, y: 0 }, ...rectangle.slice(1)], [{ x: -0.1, y: 0 }, ...rectangle.slice(1)],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }], Array.from({ length: 129 }, () => ({ x: 0, y: 0 }))]) {
      expect(getOutlineError(points)).toBeTypeOf('string')
    }
  })
  it('scales relative points and shares circular rounding with the preview', () => {
    const panel = createPanel({ width: 200, height: 100, cornerRadius: 10, customOutline: rectangle })
    const corner = panelOutlineCorners(panel)[0]
    expect(corner.radius).toBeCloseTo(10)
    expect(corner.center.x).toBeCloseTo(10)
    expect(corner.center.y).toBeCloseTo(10)
    expect(panelOutlineSvgPath(panel)).toContain('A 10 10')
    expect(panelOutlineSvgPath({ ...panel, width: 400, height: 200, cornerRadius: 0 })).toContain('L 400 200')
  })
  it('limits fillets at a narrow neck without losing concave rounding', () => {
    const customOutline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.1 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 1 }, { x: 0, y: 1 }]
    const corners = panelOutlineCorners(createPanel({ width: 200, height: 200, cornerRadius: 100, customOutline }))
    expect(corners[3].sweep).toBe(0)
    expect(corners[3].radius).toBeGreaterThan(0)
    expect(corners[3].radius).toBeLessThan(10)
    for (const corner of corners) {
      expect(Number.isFinite(corner.radius)).toBe(true)
      expect(corner.entry.x).toBeGreaterThanOrEqual(0)
      expect(corner.entry.y).toBeGreaterThanOrEqual(0)
      expect(corner.exit.x).toBeLessThanOrEqual(200)
      expect(corner.exit.y).toBeLessThanOrEqual(200)
    }
  })
})
