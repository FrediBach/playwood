import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createAssembly, duplicateAssembly, updateAssemblyDefinition } from './assemblies'
import { createAssemblyFile, parseAssemblyFile } from './assembly-file'
import { addTrofastInsert, findTrofastPlacement, getTrofastFace, getTrofastInsertLocalBounds, getTrofastPanelReason, getTrofastPlacementIssue, getTrofastPositionBounds, removeTrofastInsert, updateTrofastInsert, validateTrofastInserts } from './trofast'
import { getTrofastItem, TROFAST_ITEMS } from './trofast-catalog'
import { attachPanel, createPanel, createStarterProject, duplicatePanel, getProjectBounds, moveProject, parseProject, projectToCsv, resolvePanels, rotateProject, validateProject } from './model'
import { connectorId } from './connector-selection'
import { rotateSelection } from './selection-rotation'
import { resizePanels } from './structure-edit'
import type { Panel, Project, TrofastInsert } from './types'

const fixture = (patch: Partial<Panel> = {}): Project => ({ version: 1, name: 'Storage table', panels: [createPanel({ id: 'top', width: 1000, height: 600, position: [0, 750, 0], rotation: [-Math.PI / 2, 0, 0], ...patch })], connections: [] })
const insert = (patch: Partial<TrofastInsert> = {}): TrofastInsert => ({ id: 'box', itemId: 'plastic-medium', colorId: 'white', x: 500, y: 300, face: 1, ...patch })

describe('TROFAST drop-in placement', () => {
  it.each(TROFAST_ITEMS)('fits the published outer dimensions of $name without changing its size', item => {
    const project = fixture()
    const placement = findTrofastPlacement(project, 'top', item.id)!
    expect(placement).not.toBeNull()
    expect(getTrofastPlacementIssue(project, 'top', placement)).toBe('')
    const next = addTrofastInsert(project, 'top', placement)
    const bounds = getTrofastInsertLocalBounds(next.panels[0], placement)!
    expect(bounds.max[0] - bounds.min[0]).toBe(item.width)
    expect(bounds.max[1] - bounds.min[1]).toBe(item.depth)
    expect(bounds.max[2] - bounds.min[2]).toBe(item.height)
    expect(project.panels[0].trofastInserts).toBeUndefined()
  })

  it('requires horizontal solid panels, accepts inverted faces and arbitrary yaw', () => {
    expect(getTrofastPanelReason(fixture({ rotation: [0, 0, 0] }).panels[0])).toMatch(/flat/)
    expect(getTrofastPanelReason(fixture({ pattern: 'pegboard' }).panels[0])).toMatch(/solid/)
    expect(getTrofastPanelReason(fixture({ customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }).panels[0])).toMatch(/rectangular/)
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.71).multiply(new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)))
    const euler = new Euler().setFromQuaternion(turn)
    const project = fixture({ rotation: [euler.x, euler.y, euler.z] })
    expect(getTrofastFace(project.panels[0])).toBe(-1)
    expect(getTrofastPlacementIssue(project, 'top', insert({ face: -1 }))).toBe('')
    expect(getTrofastPlacementIssue(project, 'top', insert())).toMatch(/upward/)
  })

  it('keeps a border around the rim and accommodates quarter turns and rounded corners', () => {
    const item = getTrofastItem('plastic-shallow')!
    expect(getTrofastPositionBounds(fixture({ width: 459 }).panels[0], item)).toBeNull()
    const project = fixture({ width: 340, height: 460 })
    const candidate = findTrofastPlacement(project, 'top', item.id)!
    expect(candidate.quarterTurn).toBe(true)
    expect(candidate.x).toBe(170)
    expect(candidate.y).toBe(230)
    expect(getTrofastPlacementIssue(project, 'top', { ...candidate, x: 169 })).toMatch(/20 mm/)
    expect(findTrofastPlacement(fixture({ width: 460, height: 340, cornerRadius: 30 }), 'top', item.id)).toBeNull()
  })

  it('checks floor clearance, hidden obstacles, neighboring inserts, and movable offsets', () => {
    expect(getTrofastPlacementIssue(fixture({ position: [0, 100, 0] }), 'top', insert())).toMatch(/floor/)
    const project = fixture()
    const obstacle = createPanel({ id: 'obstacle', name: 'Lower shelf', width: 300, height: 300, position: [0, 600, 0], rotation: [-Math.PI / 2, 0, 0], visible: false })
    const blocked = { ...project, panels: [...project.panels, obstacle] }
    expect(getTrofastPlacementIssue(blocked, 'top', insert())).toMatch(/Lower shelf/)
    const next = addTrofastInsert(project, 'top', insert({ x: 240 }))
    expect(getTrofastPlacementIssue(next, 'top', insert({ id: 'second', x: 500 }))).toMatch(/overlaps/)
    const placement = findTrofastPlacement(next, 'top', 'plastic-medium')!
    expect(placement).not.toBeNull()
    expect(placement.x).toBeGreaterThan(650)
    const moved = updateTrofastInsert(next, 'top', 'box', { x: 760, colorId: 'lilac' })
    expect(moved.panels[0].trofastInserts?.[0]).toMatchObject({ x: 760, colorId: 'lilac' })
    expect(next.panels[0].trofastInserts?.[0].x).toBe(240)
    expect(removeTrofastInsert(moved, 'top', 'box').panels[0].trofastInserts).toEqual([])
  })

  it('checks clearance after world transforms and rejects invalid changes without modifying the source', () => {
    const project = addTrofastInsert(fixture(), 'top', insert())
    const snapshot = structuredClone(project)
    expect(() => rotateProject(project, 'x', 90)).toThrow(/upward/)
    expect(() => rotateSelection(project, ['top'], 'z')).toThrow(/upward/)
    expect(() => moveProject(project, [0, -700, 0])).toThrow(/floor/)
    expect(() => resizePanels(project, ['top'], { width: 400 })).toThrow(/20 mm/)
    expect(validateTrofastInserts(rotateProject(project, 'y', 45))).toEqual([])
    expect(project).toEqual(snapshot)
  })

  it('uses resolved connected panel poses and includes boxes in project bounds', () => {
    const project = createStarterProject('desk'), panel = resolvePanels(project).find(item => item.name === 'Desktop')!
    const placement = findTrofastPlacement(project, panel.id, 'plastic-deep')!
    const next = addTrofastInsert(project, panel.id, placement)
    expect(validateTrofastInserts(next)).toEqual([])
    const onlyTop = next.panels.filter(item => item.id === panel.id)
    expect(getProjectBounds(onlyTop).min[1]).toBeCloseTo(panel.position[1] + panel.thickness / 2 + 4 - 360)
  })

  it('keeps the rim clear of installed CAD connectors and honors removed hardware', () => {
    const project = attachPanel(fixture({ width: 460, height: 340 }), 'top', createPanel({ width: 200, height: 340 }),
      { type: '90', side: 'left', offset: 0, inset: 0, flip: true, color: '#e75a35', count: 1 })
    const candidate = insert({ x: 230, y: 170, itemId: 'plastic-shallow' })
    expect(getTrofastPlacementIssue(project, 'top', candidate)).toMatch(/connectors/)
    const removed = { ...project, connectorOverrides: { [connectorId(project.connections[0].id, 0)]: { removed: true } } }
    expect(getTrofastPlacementIssue(removed, 'top', candidate)).toBe('')
  })

  it('finds a narrow free slot between obstacles that falls between grid samples', () => {
    const project = fixture()
    // The small box has only 4 mm of horizontal freedom, centered at local X=333.
    const left = createPanel({ id: 'left-block', width: 231, height: 600, thickness: 100, position: [-384.5, 690, 0], rotation: [-Math.PI / 2, 0, 0] })
    const right = createPanel({ id: 'right-block', width: 565, height: 600, thickness: 100, position: [217.5, 690, 0], rotation: [-Math.PI / 2, 0, 0] })
    const blocked = { ...project, panels: [...project.panels, left, right] }
    const placement = findTrofastPlacement(blocked, 'top', 'plastic-small')!
    expect(placement).not.toBeNull()
    expect(placement.x).toBeGreaterThan(331)
    expect(placement.x).toBeLessThan(335)
    expect(getTrofastPlacementIssue(blocked, 'top', placement)).toBe('')
  })
})

describe('TROFAST persistence and assemblies', () => {
  it('keeps legacy files unchanged and round-trips all optional insert fields', () => {
    const legacy = fixture()
    expect(parseProject(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy)
    const project = addTrofastInsert(fixture(), 'top', insert({ quarterTurn: true, colorId: 'red' }))
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
    const copied = duplicatePanel(project, 'top').panels[1]
    expect(copied.trofastInserts).toEqual(project.panels[0].trofastInserts)
    expect(copied.trofastInserts?.[0]).not.toBe(project.panels[0].trofastInserts?.[0])
  })

  it.each([
    { itemId: 'missing' }, { colorId: 'missing' }, { x: Number.NaN }, { y: Infinity }, { face: 0 }, { quarterTurn: 'yes' }, { id: '' },
  ])('rejects malformed imported inserts: %j', patch => {
    const project = fixture({ trofastInserts: [insert()] })
    Object.assign(project.panels[0].trofastInserts![0], patch)
    expect(() => parseProject(project)).toThrow(/TROFAST/)
  })

  it('rejects duplicate identities and invalid color/size combinations while keeping geometry diagnostics separate', () => {
    expect(() => parseProject(fixture({ trofastInserts: [insert(), insert()] }))).toThrow(/unique/)
    expect(() => parseProject(fixture({ trofastInserts: [insert({ itemId: 'plastic-deep', colorId: 'red' })] }))).toThrow(/color/)
    const project = parseProject(fixture({ trofastInserts: [insert({ x: 0 })] }))
    expect(validateProject(project).some(issue => issue.id.endsWith('-fit'))).toBe(true)
  })

  it('preserves inserts through linked duplication, source edits, standalone files, and materialization checks', () => {
    const desk = createStarterProject('desk'), top = desk.panels.find(panel => panel.name === 'Desktop')!
    const withBox = addTrofastInsert(desk, top.id, insert({ x: top.width / 2, y: top.height / 2 }))
    const assembly = createAssembly(withBox, withBox.panels.map(panel => panel.id), 'Storage desk')
    const id = assembly.assemblies!.instances[0].id
    const copies = duplicateAssembly(assembly, id)
    const updated = updateAssemblyDefinition(copies, id, { trofastInserts: [insert({ x: top.width / 2, y: top.height / 2, colorId: 'lilac' })] }, [top.id])
    expect(updated.panels.filter(panel => panel.trofastInserts?.length)).toHaveLength(2)
    expect(updated.panels.filter(panel => panel.trofastInserts?.length).every(panel => panel.trofastInserts![0].colorId === 'lilac')).toBe(true)
    expect(validateTrofastInserts(updated)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(updated)))).toEqual(updated)
    const definition = parseAssemblyFile(createAssemblyFile(updated, id))
    expect(definition.panels.find(panel => panel.trofastInserts?.length)?.trofastInserts?.[0].colorId).toBe('lilac')
    const inconsistent: Project = JSON.parse(JSON.stringify(updated))
    inconsistent.panels.find(panel => panel.trofastInserts?.length)!.trofastInserts![0].x += 10
    expect(() => parseProject(inconsistent)).toThrow(/match their source/)
  })

  it('exports purchased items and clearly identifies approximate cutout dimensions', () => {
    const project = addTrofastInsert(fixture(), 'top', insert({ colorId: 'red' }))
    const csv = projectToCsv(project)
    expect(csv).toContain('IKEA TROFAST Medium box')
    expect(csv).toContain('"Red"')
    expect(csv).toContain('illustrative cutouts')
    expect(csv).toContain('center 500/300')
    expect(csv).toContain('outer W x D x H 420 x 300 x 230')
  })

  it('resizes a yawed assembly source across its local floor while validating the actual world placement', () => {
    const desk = createStarterProject('desk'), top = desk.panels.find(panel => panel.name === 'Desktop')!
    const withBox = addTrofastInsert(desk, top.id, insert({ x: top.width / 2, y: top.height / 2 }))
    const assembly = rotateProject(createAssembly(withBox, withBox.panels.map(panel => panel.id)), 'y', 35)
    const instance = assembly.assemblies!.instances[0]
    const sides = assembly.assemblies!.definitions[0].panels.filter(panel => panel.name.includes('side')).map(panel => panel.id)
    const resized = updateAssemblyDefinition(assembly, instance.id, { width: 100 }, sides)
    expect(validateTrofastInserts(resized)).toEqual([])
    const definition = resized.assemblies!.definitions[0]
    const local: Project = { version: 1, name: 'Source', panels: definition.panels, connections: definition.connections }
    expect(validateTrofastInserts(local).some(issue => issue.id.endsWith('-floor'))).toBe(true)
    expect(validateProject(local, { trofastWorld: false })).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(resized)))).toEqual(resized)
    expect(resized.panels.find(panel => panel.trofastInserts?.length)!.trofastInserts).toEqual(withBox.panels.find(panel => panel.trofastInserts?.length)!.trofastInserts)
  })
})
