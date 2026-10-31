import { describe, expect, it } from 'vitest'
import { getGuideScene } from './guide-scenes'
import type { GuideId } from './build-guide-types'
import { resolvePanels, validateProject } from './model'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GuidePreview } from '@/components/GuidePreview'

const guideIds: GuideId[] = ['workspace', 'first-panel', 'attach', 'angles', 'auto-connect', 'connect-panel', 'close-hole', 'split-panels', 'move-snap', 'resize', 'rotate', 'copy-paste', 'multi-select', 'finishes', 'custom-outline', 'groups', 'assemblies', 'assembly-attach', 'assembly-values', 'assembly-edit', 'assembly-controls', 'assembly-files', 'connectors', 'review', 'save-export']

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
})
