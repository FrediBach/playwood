import { describe, expect, it } from 'vitest'
import { getGuideScene } from './guide-scenes'
import { BUILD_GUIDES } from './build-guides'
import { createStarterProject, getProjectBounds, resolvePanels, validateProject } from './model'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GuidePreview } from '@/components/GuidePreview'
import { evaluateDesignConstraints } from './design-constraints'
import { getPhysicalConnectors } from './connector-selection'
import { guideFurnishings } from './guide-file-scenes'

const guideIds = BUILD_GUIDES.map(guide => guide.id)

describe('beginner guide project studies', () => {
  it('keeps lesson navigation unique and all related guides reachable', () => {
    expect(new Set(guideIds).size).toBe(guideIds.length)
    for (const guide of BUILD_GUIDES) {
      expect(guide.steps).toHaveLength(4)
      for (const related of guide.related) expect(guideIds).toContain(related)
    }
  })

  it.each(guideIds)('%s produces four finite, readable scene snapshots', id => {
    for (let step = 0; step < 4; step++) {
      const scene = getGuideScene(id, step)
      const panels = resolvePanels(scene.project)
      expect(panels.length + (scene.objectSurfaces?.length ?? 0)).toBeGreaterThan(0)
      for (const surface of scene.objectSurfaces ?? []) {
        expect(surface.positions.length).toBeGreaterThan(0)
        expect([...surface.positions].every(Number.isFinite)).toBe(true)
      }
      expect(scene.note.length).toBeGreaterThan(20)
      for (const panel of panels) {
        expect([...panel.position, ...panel.rotation, panel.width, panel.height, panel.thickness].every(Number.isFinite)).toBe(true)
      }
      expect(scene.selected.every(id => panels.some(panel => panel.id === id))).toBe(true)
      expect(scene.ghost.every(id => panels.some(panel => panel.id === id))).toBe(true)
      expect((scene.ghostConnectors ?? []).every(id => getPhysicalConnectors(scene.project).some(piece => piece.id === id))).toBe(true)
      expect(scene.labels.every(label => !!label.point || panels.some(panel => panel.id === label.panelId))).toBe(true)
      expect(validateProject(scene.project).filter(issue => issue.severity === 'error')).toEqual([])
      expect(getGuideScene(id, step)).toBe(scene)
    }
  })

  it('illustrates Union, Subtract, and Intersect from the same two editable operands', () => {
    const studies = [0, 1, 2, 3].map(step => getGuideScene('boolean-objects', step))
    expect(studies.map(study => study.objectSurfaces![0].volume)).toEqual([144000000, 172000000, 108000000, 36000000])
    expect(studies.every(study => study.project.panels.length === 0)).toBe(true)
    expect(studies.slice(1).map(study => study.project.constructionObjects!.nodes.at(-1))).toEqual([
      expect.objectContaining({ operation: 'union' }),
      expect.objectContaining({ operation: 'subtract' }),
      expect.objectContaining({ operation: 'intersect' }),
    ])
  })

  it('solves the illustrated L shape with both outline and rectangular closing faces', () => {
    const fitted = getGuideScene('object-solver', 1).project
    const rectangular = getGuideScene('object-solver', 2).project
    expect(fitted.panels).toHaveLength(8)
    expect(fitted.panels.filter(panel => panel.customOutline)).toHaveLength(2)
    expect(rectangular.panels.length).toBeGreaterThan(8)
    expect(rectangular.panels.every(panel => !panel.customOutline)).toBe(true)
    for (const project of [fitted, rectangular]) {
      const bounds = getProjectBounds(resolvePanels(project))
      expect(bounds.width).toBeCloseTo(600)
      expect(bounds.height).toBeCloseTo(600)
      expect(bounds.depth).toBeCloseTo(400)
      const objects = project.constructionObjects!
      expect(objects.nodes.find(node => node.id === objects.roots[0])!.visible).toBe(false)
      expect(project.connections.length).toBeGreaterThan(0)
    }
    expect(getGuideScene('object-solver', 0).project.panels).toHaveLength(0)
    expect(getGuideScene('object-solver', 3).project).toBe(fitted)
  })

  it('uses real fitting operations for automatic connectors, splitting, and closure', () => {
    expect(getGuideScene('auto-connect', 0).project.connections).toHaveLength(0)
    expect(getGuideScene('auto-connect', 2).project.connections.length).toBeGreaterThan(0)
    expect(getGuideScene('close-hole', 3).project.panels).toHaveLength(5)
    expect(getGuideScene('split-panels', 3).project.panels.some(panel => panel.name === 'Center divider')).toBe(true)
    expect(getGuideScene('assembly-attach', 2).project.assemblies?.links).toHaveLength(1)
  })

  it('illustrates repeat preview additions around an unchanged source compartment', () => {
    const source = getGuideScene('resize', 2)
    const repeated = getGuideScene('resize', 3)
    expect(repeated.project.panels).toHaveLength(source.project.panels.length + 6)
    expect(repeated.ghost).toHaveLength(6)
    expect(repeated.selected).toHaveLength(4)
    for (const panel of resolvePanels(source.project)) {
      expect(resolvePanels(repeated.project).find(item => item.id === panel.id)).toEqual(panel)
    }
    expect(repeated.project.connections.some(connection => connection.type === 't')).toBe(true)
  })

  it('renders every study as a bounded SVG without WebGL or non-finite coordinates', () => {
    for (const guideId of guideIds) for (let step = 0; step < 4; step++) {
      const markup = renderToStaticMarkup(createElement(GuidePreview, { guideId, step, caption: `${guideId} step ${step + 1}` }))
      expect(markup).toContain('role="img"')
      expect(markup).toMatch(/<(?:path|polygon)/)
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

  it('keeps guide furnishings repeatable across fresh example identities', () => {
    const first = createStarterProject('shelf'), second = createStarterProject('shelf')
    const snapshot = structuredClone(first)
    const normalize = (project: typeof first) => guideFurnishings(project).map(item => ({
      ...item, panelId: project.panels.find(panel => panel.id === item.panelId)!.name,
    }))
    expect(normalize(first).length).toBeGreaterThan(0)
    expect(normalize(first)).toEqual(normalize(second))
    expect(first).toEqual(snapshot)
  })

  it('illustrates surface height and minimum clear gap using the real rule commands', () => {
    const raised = getGuideScene('constraints', 1).project
    const finished = getGuideScene('constraints', 3).project
    expect(raised.constraints).toHaveLength(1)
    expect(finished.constraints).toHaveLength(4)
    const measurements = evaluateDesignConstraints(finished.constraints, resolvePanels(finished))
    expect(measurements.every(result => result.violation === 0)).toBe(true)
    expect(measurements.find(result => result.constraint.kind === 'floor')!.actual).toBeCloseTo(800)
    expect(measurements.find(result => result.constraint.kind === 'gap')!.actual).toBeCloseTo(200)
  })

  it('previews just the newly drawn connector without changing boards or installed pieces', () => {
    const original = getGuideScene('draw-connectors', 0)
    const preview = getGuideScene('draw-connectors', 1)
    const accepted = getGuideScene('draw-connectors', 2)
    expect(resolvePanels(accepted.project)).toEqual(resolvePanels(original.project))
    expect(getPhysicalConnectors(original.project)).toHaveLength(2)
    expect(getPhysicalConnectors(accepted.project)).toHaveLength(3)
    expect(preview.ghost).toEqual([])
    expect(preview.ghostConnectors).toEqual(accepted.selectedConnectors)
    expect(preview.project).toBe(accepted.project)
    expect(getPhysicalConnectors(accepted.project).slice(0, 2).map(piece => piece.id))
      .toEqual(getPhysicalConnectors(original.project).map(piece => piece.id))
  })

  it('raises the illustrated upper compartment without resizing it or moving the base', () => {
    const original = getGuideScene('selection-stretch', 0), moved = getGuideScene('selection-stretch', 2)
    expect(original.selected).toHaveLength(4)
    for (const panel of resolvePanels(original.project)) {
      const after = resolvePanels(moved.project).find(item => item.id === panel.id)!
      if (original.selected.includes(panel.id)) {
        expect(after.position[1]).toBeCloseTo(panel.position[1] + 80)
        expect([after.width, after.height, after.thickness, ...after.rotation]).toEqual([panel.width, panel.height, panel.thickness, ...panel.rotation])
      } else if (panel.name === 'Bottom shelf') expect(after).toEqual(panel)
      else expect(after.width).toBeCloseTo(panel.width + 80)
    }
    expect(getGuideScene('selection-stretch', 3).project).toBe(original.project)
  })

  it('shows the stated cut sizes, persistent locks, gap fill, and overlap repair', () => {
    const equal = getGuideScene('equal-sizes', 2).project
    expect(equal.panels.map(panel => panel.width)).toEqual([520, 520])
    expect(equal.constraints ?? []).toHaveLength(0)
    expect(getGuideScene('equal-sizes', 3).project.constraints).toHaveLength(4)
    const pair = getGuideScene('merge-panels', 0).project, merged = getGuideScene('merge-panels', 2).project
    expect(merged.panels).toHaveLength(1)
    expect(merged.panels[0]).toMatchObject({ id: pair.panels[0].id, width: 635, height: 300, thickness: 18 })
    expect(getProjectBounds(resolvePanels(merged))).toEqual(getProjectBounds(resolvePanels(pair)))
    expect(validateProject(getGuideScene('repair-overlaps', 0).project).some(issue => issue.message.includes('overlaps'))).toBe(true)
    expect(validateProject(getGuideScene('repair-overlaps', 2).project)).toEqual([])
  })

  it('measures the illustrated fixed center, aligned backs, and equal openings', () => {
    const project = getGuideScene('reference-rules', 3).project
    const measurements = evaluateDesignConstraints(project.constraints, resolvePanels(project))
    expect(measurements).toHaveLength(3)
    expect(measurements.every(result => result.violation === 0)).toBe(true)
    expect(measurements.find(result => result.constraint.kind === 'position')!.actual).toBeCloseTo(-400)
    expect(measurements.find(result => result.constraint.kind === 'setback')!.actual).toBeCloseTo(0)
    const panels = resolvePanels(project)
    expect(panels[1].position[0] - panels[0].position[0] - 18).toBe(382)
    expect(panels[2].position[0] - panels[1].position[0] - 18).toBe(382)
  })
})
