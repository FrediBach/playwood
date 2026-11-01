import { describe, expect, it } from 'vitest'
import { getGuideScene } from './guide-scenes'
import { BUILD_GUIDES } from './build-guides'
import { getProjectBounds, resolvePanels, validateProject } from './model'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GuidePreview } from '@/components/GuidePreview'

const guideIds = BUILD_GUIDES.map(guide => guide.id)

describe('beginner guide project studies', () => {
  it.each(guideIds)('%s produces four finite, readable scene snapshots', id => {
    for (let step = 0; step < 4; step++) {
      const scene = getGuideScene(id, step)
      const panels = resolvePanels(scene.project)
      expect(panels.length).toBeGreaterThan(0)
      expect(scene.note.length).toBeGreaterThan(20)
      for (const panel of panels) {
        expect([...panel.position, ...panel.rotation, panel.width, panel.height, panel.thickness].every(Number.isFinite)).toBe(true)
      }
      expect(scene.selected.every(id => panels.some(panel => panel.id === id))).toBe(true)
      expect(scene.ghost.every(id => panels.some(panel => panel.id === id))).toBe(true)
      expect(scene.labels.every(label => !!label.point || panels.some(panel => panel.id === label.panelId))).toBe(true)
      expect(validateProject(scene.project).filter(issue => issue.severity === 'error')).toEqual([])
      expect(getGuideScene(id, step)).toBe(scene)
    }
  })

  it('uses real fitting operations for automatic connectors, splitting, and closure', () => {
    expect(getGuideScene('auto-connect', 0).project.connections).toHaveLength(0)
    expect(getGuideScene('auto-connect', 2).project.connections.length).toBeGreaterThan(0)
    expect(getGuideScene('close-hole', 3).project.panels).toHaveLength(5)
    expect(getGuideScene('split-panels', 3).project.panels.some(panel => panel.name === 'Center divider')).toBe(true)
    expect(getGuideScene('assembly-attach', 2).project.assemblies?.links).toHaveLength(1)
  })

  it('renders every study as a bounded SVG without WebGL or non-finite coordinates', () => {
    for (const guideId of guideIds) for (let step = 0; step < 4; step++) {
      const markup = renderToStaticMarkup(createElement(GuidePreview, { guideId, step, caption: `${guideId} step ${step + 1}` }))
      expect(markup).toContain('role="img"')
      expect(markup).toContain('<path')
      expect(markup).not.toMatch(/NaN|Infinity|<canvas/)
      expect((markup.match(/<(?:path|polygon)/g) ?? []).length).toBeLessThan(300)
    }
  })

  it('illustrates the real grid, rescale, and whole-creation movement results', () => {
    const grid = getGuideScene('grid-split', 3).project
    expect(grid.connections.some(connection => connection.type === 'cross')).toBe(true)
    expect(grid.connections.some(connection => connection.type === 't')).toBe(true)
    const original = getGuideScene('rescale', 0).project, scaled = getGuideScene('rescale', 3).project
    expect(scaled.panels.every(panel => panel.width === 500 && panel.height === 500 && panel.thickness === 18)).toBe(true)
    expect(scaled.connections).toHaveLength(original.connections.length)
    const grounded = getGuideScene('move-creation', 3).project
    expect(getProjectBounds(resolvePanels(grounded)).min[1]).toBeCloseTo(0)
  })

  it('keeps room dressing out of project parts and replaces uses of removed palette colors', () => {
    const room = getGuideScene('room-preview', 2)
    expect(room.furnishings?.length).toBeGreaterThan(0)
    expect(room.project).toBe(getGuideScene('room-preview', 0).project)
    const palette = getGuideScene('palette', 3).project
    expect(palette.customColors).toHaveLength(0)
    expect(palette.panels.every(panel => panel.color === '#d9bd8c')).toBe(true)
  })
})
