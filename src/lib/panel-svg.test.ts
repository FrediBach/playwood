import { describe, expect, it } from 'vitest'
import { createPanel } from './model'
import { makePanelShape } from './panel-cut-geometry'
import { needsPanelSvg, panelSvgFilename, panelToSvg } from './panel-svg'

describe('panel cutting SVGs', () => {
  it('offers shaped and perforated panels, including rounded rectangles', () => {
    expect(needsPanelSvg(createPanel())).toBe(false)
    for (const patch of [{ pattern: 'pegboard' as const }, { pattern: 'slots' as const }, { cornerRadius: 20 },
      { customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }]) {
      expect(needsPanelSvg(createPanel(patch))).toBe(true)
    }
  })
  it('exports full-size local coordinates independently of world pose, with safe names', () => {
    const panel = createPanel({ name: '<script>&"', width: 240, height: 180, cornerRadius: 10 })
    const svg = panelToSvg(panel)
    expect(svg).toContain('width="240mm" height="180mm" viewBox="0 0 240 180"')
    expect(svg).toContain('<title>&lt;script&gt;&amp;&quot;</title>')
    expect(svg).toContain('A 10 10')
    expect(svg).toBe(panelToSvg({ ...panel, position: [200, 100, 300], rotation: [1, 2, 3] }))
    expect(panelSvgFilename(panel, 2)).toBe('3-script.svg')
  })
  it.each(['pegboard', 'slots'] as const)('exports every %s opening as closed curved inside cuts', pattern => {
    const panel = createPanel({ width: 240, height: 240, pattern, holeSize: 12, holeSpacing: 48 })
    const svg = panelToSvg(panel)
    expect(svg.match(/id="cutout-/g)).toHaveLength(16)
    expect(svg.match(/fill="#ffffff"/g)).toHaveLength(16)
    expect(svg).toContain('A 6 6')
    expect(svg.match(/ Z"/g)).toHaveLength(17)
  })
  it('retains custom outline clipping and concave fillets in combined shapes', () => {
    const panel = createPanel({ width: 240, height: 240, pattern: 'slots', holeSize: 12, holeSpacing: 48, cornerRadius: 10,
      customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.4 }, { x: 0.4, y: 0.4 }, { x: 0.4, y: 1 }, { x: 0, y: 1 }] })
    const holes = makePanelShape(panel).holes.length
    expect(holes).toBeGreaterThan(0)
    expect(holes).toBeLessThan(16)
    expect(panelToSvg(panel).match(/id="cutout-/g)).toHaveLength(holes)
    expect(panelToSvg(panel)).not.toMatch(/NaN|Infinity/)
  })
  it('exports fixed-size off-center TROFAST openings and their rotated variant', () => {
    const panel = createPanel({ width: 800, height: 600, trofastInserts: [
      { id: 'box', itemId: 'plastic-shallow', colorId: 'white', x: 270, y: 260, face: 1 },
    ] })
    expect(needsPanelSvg(panel)).toBe(true)
    expect(panelToSvg(panel)).toContain('TROFAST openings are approximate')
    expect(panelToSvg(panel).match(/id="cutout-/g)).toHaveLength(1)
    const bounds = (p: typeof panel) => {
      const points = makePanelShape(p).holes[0].getPoints(16)
      return [Math.min(...points.map(v => v.x)) * 1000 + 400, Math.max(...points.map(v => v.x)) * 1000 + 400]
    }
    const rotated = { ...panel, trofastInserts: panel.trofastInserts!.map(insert => ({ ...insert, quarterTurn: true })) }
    expect(bounds(panel)[0] + bounds(panel)[1]).toBeCloseTo(540)
    expect(bounds(rotated)[0] + bounds(rotated)[1]).toBeCloseTo(540)
    expect(bounds(panel)[1] - bounds(panel)[0]).toBeGreaterThan(bounds(rotated)[1] - bounds(rotated)[0])
    expect(panelToSvg(panel)).not.toBe(panelToSvg(rotated))
  })
})
