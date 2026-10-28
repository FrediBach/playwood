import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { attachExistingPanel, attachPanel, createPanel, createStarterProject, detachPanel, getConnectionAnchors, getProjectBounds, parseProject, projectToCsv, removePanel, resolvePanels, validateProject } from './model'
import type { AttachmentOptions, Project, Side } from './types'

const options: AttachmentOptions = { side: 'top', type: '90', offset: 0, inset: 0, flip: false, color: '#e75a35', count: 2 }
const project = (): Project => ({ version: 1, name: 'Test', panels: [createPanel({ id: 'parent', position: [0, 0, 0], width: 600, height: 400 })], connections: [] })

describe('attachment geometry', () => {
  it('uses the documented 8.5 mm corner clearance at 18 mm thickness', () => {
    const p = attachPanel(project(), 'parent', createPanel({ id: 'child', width: 600, height: 400 }), options)
    const child = resolvePanels(p)[1]
    expect(child.position[0]).toBeCloseTo(0)
    expect(child.position[1]).toBeCloseTo(217.5)
    expect(child.position[2]).toBeCloseTo(217.5)
    expect(child.rotation[0]).toBeCloseTo(Math.PI / 2)
    expect(validateProject(p)).toHaveLength(0)
  })

  it.each(['left', 'right', 'top', 'bottom', 'front', 'back'] satisfies Side[])('attaches predictably to the %s side', side => {
    const p = attachPanel(project(), 'parent', createPanel({ width: 200, height: 200 }), { ...options, side })
    const child = resolvePanels(p)[1]
    expect(child.position.every(Number.isFinite)).toBe(true)
    const normal = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().setFromEuler(new Euler(...child.rotation)))
    expect(normal.z).toBeCloseTo(0)
  })

  it('moves descendants when an attached parent is resized and rotated', () => {
    let p = attachPanel(project(), 'parent', createPanel({ id: 'child' }), options)
    p = attachPanel(p, 'child', createPanel({ id: 'grandchild' }), options)
    const before = resolvePanels(p)[2].position
    p = { ...p, panels: p.panels.map(panel => panel.id === 'parent' ? { ...panel, height: 800, rotation: [0, Math.PI / 2, 0], position: [100, 0, 0] } : panel) }
    const after = resolvePanels(p)
    expect(after[1].position[0]).toBeCloseTo(297.5)
    expect(after[1].position[1]).toBeCloseTo(417.5)
    expect(after[2].position).not.toEqual(before)
  })

  it('changes hinge angle without stretching the panel', () => {
    for (const [type, expected] of [['105', 75], ['150', 30]] as const) {
      const p = attachPanel(project(), 'parent', createPanel({ height: 400 }), { ...options, type })
      expect(resolvePanels(p)[1].rotation[0]).toBeCloseTo(expected * Math.PI / 180)
    }
  })

  it('places flipped panels on the reverse face and offsets along the seam', () => {
    const p = attachPanel(project(), 'parent', createPanel({ width: 400, height: 400 }), { ...options, offset: 100, flip: true })
    const child = resolvePanels(p)[1]
    expect(child.position[0]).toBeCloseTo(100)
    expect(child.position[2]).toBeCloseTo(-217.5)
    const anchors = getConnectionAnchors(p.connections[0], p.panels[0], child)
    expect(anchors).toHaveLength(2)
    expect(anchors[0][0]).toBeCloseTo(-80)
    expect(anchors[1][0]).toBeCloseTo(280)
  })

  it('builds complete T and cross joints without overcounting hardware', () => {
    for (const [type, total] of [['t', 3], ['cross', 4]] as const) {
      const p = attachPanel(project(), 'parent', createPanel(), { ...options, type })
      expect(p.panels).toHaveLength(total)
      expect(p.connections.reduce((sum, c) => sum + c.count, 0)).toBe(2)
      expect(resolvePanels(p).at(-1)!.rotation[0]).toBeCloseTo(0)
      expect(validateProject(p).filter(i => i.id.startsWith('collision'))).toHaveLength(0)
    }
  })
})

describe('project safety and feedback', () => {
  it('reports unsupported thickness and insufficient seam overlap', () => {
    const p = attachPanel(project(), 'parent', createPanel({ thickness: 22 }), { ...options, offset: 2000 })
    expect(validateProject(p).map(i => i.id)).toEqual(expect.arrayContaining([expect.stringContaining('thickness'), expect.stringContaining('overlap')]))
  })

  it('detects actual panel intersections, including rotated panels', () => {
    const p = project()
    p.panels.push(createPanel({ id: 'second', position: [0, 0, 0], rotation: [0, 0, Math.PI / 4] }))
    expect(validateProject(p).some(i => i.id.startsWith('collision'))).toBe(true)
    p.panels[1].position = [0, 0, 100]
    expect(validateProject(p).some(i => i.id.startsWith('collision'))).toBe(false)
  })

  it('preserves world transforms when a parent is removed', () => {
    const p = attachPanel(project(), 'parent', createPanel({ id: 'child' }), options)
    const before = resolvePanels(p)[1]
    const after = removePanel(p, 'parent')
    expect(after.connections).toHaveLength(0)
    expect(after.panels[0].position).toEqual(before.position)
    expect(after.panels[0].rotation).toEqual(before.rotation)
  })

  it.each(['t', 'cross'] as const)('detaches any %s branch as a complete joint, preserving descendants', type => {
    for (const branch of [0, 1]) {
      let p = attachPanel(project(), 'parent', createPanel({ id: 'child' }), { ...options, type })
      const sibling = p.panels[branch + 1]
      p = attachPanel(p, sibling.id, createPanel({ id: 'descendant' }), options)
      const worldBefore = resolvePanels(p)
      const detached = detachPanel(p, sibling.id)
      expect(detached.connections).toHaveLength(1)
      expect(detached.connections[0].parentId).toBe(sibling.id)
      expect(resolvePanels(detached)).toEqual(worldBefore)
    }
  })

  it('reparents existing panels without losing their descendants', () => {
    let p = attachPanel(project(), 'parent', createPanel({ id: 'child' }), options)
    p = attachPanel(p, 'child', createPanel({ id: 'descendant' }), options)
    p.panels.push(createPanel({ id: 'new-parent', position: [1000, 0, 0] }))
    const next = attachExistingPanel(p, 'new-parent', 'child', { ...options, side: 'right' })
    expect(next.panels).toHaveLength(4)
    expect(next.connections.find(c => c.childId === 'child')?.parentId).toBe('new-parent')
    expect(next.connections.find(c => c.childId === 'descendant')?.parentId).toBe('child')
    expect(resolvePanels(next).find(panel => panel.id === 'descendant')?.position).not.toEqual(resolvePanels(p).find(panel => panel.id === 'descendant')?.position)
    expect(() => parseProject(next)).not.toThrow()
  })

  it('rejects direct and indirect cycles when connecting existing panels', () => {
    let p = attachPanel(project(), 'parent', createPanel({ id: 'child' }), options)
    p = attachPanel(p, 'child', createPanel({ id: 'descendant' }), options)
    expect(() => attachExistingPanel(p, 'child', 'child', options)).toThrow('itself')
    expect(() => attachExistingPanel(p, 'child', 'parent', options)).toThrow('descendants')
    expect(() => attachExistingPanel(p, 'descendant', 'parent', options)).toThrow('descendants')
  })

  it('creates missing T branches while retaining the existing child ID', () => {
    const p = project()
    p.panels.push(createPanel({ id: 'existing' }))
    const next = attachExistingPanel(p, 'parent', 'existing', { ...options, type: 't' })
    expect(next.panels).toHaveLength(3)
    expect(next.connections[0].childId).toBe('existing')
    expect(next.connections.reduce((sum, c) => sum + c.count, 0)).toBe(2)
    expect(() => parseProject(next)).not.toThrow()
  })

  it('calculates bounds from all eight rotated corners', () => {
    const panel = createPanel({ width: 600, height: 400, thickness: 18, rotation: [Math.PI / 2, 0, 0] })
    const bounds = getProjectBounds([panel])
    expect(bounds.width).toBeCloseTo(600)
    expect(bounds.height).toBeCloseTo(18)
    expect(bounds.depth).toBeCloseTo(400)
    expect(getProjectBounds([])).toMatchObject({ width: 0, height: 0, depth: 0 })
  })

  it('round-trips starter projects and rejects malformed or circular imports', () => {
    for (const template of ['shelf', 'desk', 'display', 'blank'] as const) {
      const p = createStarterProject(template)
      expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p)
    }
    const p = attachPanel(project(), 'parent', createPanel({ id: 'child' }), options)
    expect(() => parseProject({ ...p, panels: [{ ...p.panels[0], width: -1 }] })).toThrow('panel width')
    expect(() => parseProject({ ...p, panels: [{ ...p.panels[0], position: [0, 1] }] })).toThrow('position')
    expect(() => parseProject({ ...p, panels: [...p.panels, p.panels[0]] })).toThrow('unique')
    expect(() => parseProject({ ...p, connections: [...p.connections, { ...p.connections[0], id: 'cycle', childId: 'parent', parentId: 'child' }] })).toThrow('Circular')
  })

  it('does not hide custom colors or perforations in the cut list', () => {
    const p = project()
    p.panels[0].name = 'Shelf, "wide"'
    p.panels[0].pattern = 'pegboard'
    const csv = projectToCsv(p)
    expect(csv).toContain('"Shelf, ""wide"""')
    expect(csv).toContain('"pegboard"')
    expect(csv).toContain('"600","400","18"')
    expect(csv).toContain('"12","48"')
  })

  it('rejects perforation imports that exceed renderer limits', () => {
    const p = project()
    p.panels[0] = { ...p.panels[0], pattern: 'pegboard', holeSize: 12, holeSpacing: 16 }
    expect(() => parseProject(p)).toThrow('5 mm')
    p.panels[0] = { ...p.panels[0], width: 4000, height: 4000, holeSize: 5, holeSpacing: 15 }
    expect(() => parseProject(p)).toThrow('5,000')
    expect(validateProject(p).some(i => i.id.endsWith('-pattern'))).toBe(true)
  })

  it('does not let imported panel names become spreadsheet formulas', () => {
    const p = project()
    p.panels[0].name = '=1+1'
    expect(projectToCsv(p)).toContain('"\'=1+1"')
  })

  it('starts with non-overlapping furniture and no shelf warnings', () => {
    for (const template of ['shelf', 'desk', 'display'] as const) {
      expect(validateProject(createStarterProject(template)).filter(i => i.id.startsWith('collision'))).toHaveLength(0)
    }
    expect(validateProject(createStarterProject('shelf'))).toHaveLength(0)
  })

  it('supports both ends of shelf panels without changing their transforms', () => {
    const p = createStarterProject('shelf')
    const supports = p.connections.filter(c => c.role === 'support')
    expect(supports).toHaveLength(2)
    expect(p.connections.reduce((sum, c) => sum + c.count, 0)).toBe(12)
    const withoutSupports = { ...p, connections: p.connections.filter(c => c.role !== 'support') }
    expect(resolvePanels(p)).toEqual(resolvePanels(withoutSupports))
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p)
    for (const support of supports) {
      const child = p.panels.find(panel => panel.id === support.childId)!
      const detached = detachPanel(p, child.id)
      expect(detached.connections.some(c => c.childId === child.id)).toBe(false)
      expect(resolvePanels(detached)).toEqual(resolvePanels(p))
    }
  })

  it('reports support misalignment after dimensions change', () => {
    const p = createStarterProject('shelf')
    p.panels[0].width += 100
    expect(validateProject(p).filter(i => i.id.endsWith('-alignment'))).toHaveLength(2)
  })

  it('rejects incomplete shared joints on import', () => {
    const p = attachPanel(project(), 'parent', createPanel(), { ...options, type: 'cross' })
    p.connections.pop()
    expect(() => parseProject(p)).toThrow('incomplete')
    expect(validateProject(p).some(i => i.id.endsWith('-joint'))).toBe(true)
  })

  it('flags attachments outside the parent panel in either inset direction', () => {
    for (const inset of [-1, 401]) {
      const p = attachPanel(project(), 'parent', createPanel(), { ...options, inset })
      expect(validateProject(p).some(i => i.id.endsWith('-inset'))).toBe(true)
    }
    const p = attachPanel(project(), 'parent', createPanel(), { ...options, side: 'front', inset: 201 })
    expect(validateProject(p).some(i => i.id.endsWith('-inset'))).toBe(true)
  })
})
