import { describe, expect, it } from 'vitest'
import { attachPanel, createPanel, getConnectionAnchors, parseProject, projectToCsv, validateProject } from './model'
import { panelCornerRadius } from './panel-shape'
import { updateSelectedPanels } from './selection'
import type { Project, Side } from './types'

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
