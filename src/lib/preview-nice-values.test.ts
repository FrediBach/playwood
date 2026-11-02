import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { connectorId } from './connector-selection'
import { attachPanel, createPanel, createStarterProject, resolvePanels, validateProject } from './model'
import { finishPreviewDrag, movePreviewDrag, preparePreviewDrag } from './preview-drag'
import { finishPreviewResize, movePreviewResize, preparePreviewResize } from './preview-resize'
import type { Project, Vec3 } from './types'

const single = (width = 112): Project => ({ version: 1, name: 'Nice cuts',
  panels: [createPanel({ width, height: 300, position: [13, 500, 7], rotation: [0.2, 0.3, 0.4] })], connections: [],
  niceValues: { enabled: true, step: 10 } })
const position = (project: Project, id: string) => resolvePanels(project).find(panel => panel.id === id)!.position
const near = (actual: number[], expected: number[]) => actual.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 5))

describe('nice values at resize release', () => {
  it.each(['positive', 'negative'])('rounds an off-grid cut only at release, retaining its opposite %s edge', side => {
    const project = single()
    const snapshot = structuredClone(project)
    const before = project.panels[0]
    const session = preparePreviewResize(project, { panelId: before.id })!
    const handle = `panel-width-${side}`
    const preview = movePreviewResize(session, handle, 7)
    expect(preview.project.panels[0].width).toBeCloseTo(119)
    const result = finishPreviewResize(session, handle, preview)
    const after = result.project.panels[0]
    expect(after.width).toBeCloseTo(120)
    expect(result.distance).toBeCloseTo(8)
    const axis = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(...before.rotation)))
    const fixed = side === 'positive' ? -1 : 1
    near(new Vector3(...after.position).addScaledVector(axis, fixed * after.width / 2).toArray(),
      new Vector3(...before.position).addScaledVector(axis, fixed * before.width / 2).toArray())
    expect(project).toEqual(snapshot)
    expect(preview.project.panels[0].width).toBeCloseTo(119)
  })

  it('turns a small released adjustment into a true no-op and leaves disabled previews alone', () => {
    const project = single(110)
    const session = preparePreviewResize(project, { panelId: project.panels[0].id })!
    const preview = movePreviewResize(session, 'panel-width-positive', 3)
    expect(finishPreviewResize(session, 'panel-width-positive', preview).project).toBe(project)
    const disabled = { ...project, niceValues: { enabled: false, step: 10 } }
    const disabledSession = preparePreviewResize(disabled, { panelId: project.panels[0].id })!
    const free = movePreviewResize(disabledSession, 'panel-width-positive', 3)
    expect(finishPreviewResize(disabledSession, 'panel-width-positive', free)).toBe(free)
  })

  it('uses the nearest feasible multiple near a saved limit and rejects an interval without one', () => {
    const source = single(100)
    const project: Project = { ...source, constraints: [{ id: 'minimum', enabled: true, kind: 'dimension',
      panelId: source.panels[0].id, dimension: 'width', relation: 'minimum', value: 43 }] }
    const session = preparePreviewResize(project, { panelId: project.panels[0].id })!
    const preview = movePreviewResize(session, 'panel-width-positive', -100)
    expect(preview.limited).toBe(true)
    const result = finishPreviewResize(session, 'panel-width-positive', preview)
    expect(result.project.panels[0].width).toBeCloseTo(50)
    expect(result.limited).toBe(false)
    const narrow: Project = { ...source, panels: [{ ...source.panels[0], width: 44 }], constraints: [{ id: 'range', enabled: true,
      kind: 'dimension', panelId: source.panels[0].id, dimension: 'width', relation: 'range', min: 43, max: 47 }] }
    const narrowSession = preparePreviewResize(narrow, { panelId: narrow.panels[0].id })!
    const narrowPreview = movePreviewResize(narrowSession, 'panel-width-positive', 2)
    expect(() => finishPreviewResize(narrowSession, 'panel-width-positive', narrowPreview)).toThrow(/cannot reach a nice value/)
    expect(narrow.panels[0].width).toBe(44)
  })

  it('rounds a changed supporting cut for normal and connector arrows while preserving joints', () => {
    const project: Project = { ...createStarterProject(), niceValues: { enabled: true, step: 10 } }
    const top = project.panels.find(panel => panel.name === 'Top shelf')!
    for (const selection of [{ panelId: top.id }, { connectorId: connectorId(project.connections[0].id, 0) }]) {
      const session = preparePreviewResize(project, selection)!
      const handle = session.handles.find(item => session.drivers.get(item.id)!.operation.kind === 'move')!
      const preview = movePreviewResize(session, handle.id, 13)
      const result = finishPreviewResize(session, handle.id, preview)
      expect(result.limited).toBe(false)
      const changes = result.project.panels.flatMap(panel => {
        const old = project.panels.find(item => item.id === panel.id)!
        return (['width', 'height'] as const).filter(field => Math.abs(panel[field] - old[field]) > 1e-5).map(field => panel[field])
      })
      expect(changes.length).toBeGreaterThan(0)
      expect(changes.some(value => Math.abs(value / 10 - Math.round(value / 10)) < 1e-5)).toBe(true)
      expect(validateProject(result.project).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
    }
  })

  it('keeps independent edge resizing local when its released cut is rounded', () => {
    const project: Project = { ...createStarterProject(), niceValues: { enabled: true, step: 10 } }
    const selected = project.panels.find(panel => panel.name === 'Middle shelf')!
    const session = preparePreviewResize(project, { panelId: selected.id })!
    const handle = 'panel-height-positive'
    const preview = movePreviewResize(session, handle, 83, true)
    const result = finishPreviewResize(session, handle, preview, true)
    expect(result.project.panels.find(panel => panel.id === selected.id)!.height % 10).toBeCloseTo(0)
    for (const old of resolvePanels(project).filter(panel => panel.id !== selected.id)) {
      const after = resolvePanels(result.project).find(panel => panel.id === old.id)!
      near(after.position, old.position)
      expect(after.width).toBeCloseTo(old.width)
      expect(after.height).toBeCloseTo(old.height)
      expect(after.thickness).toBe(old.thickness)
    }
  })
})

describe('nice values at free-drag release', () => {
  it('rounds the final reference position only on moved axes and translates a selection together', () => {
    const source = single()
    const reference = source.panels[0]
    const companion = createPanel({ width: 200, height: 200, position: [153, 500, 307] })
    const project = { ...source, panels: [reference, companion] }
    const snapshot = structuredClone(project)
    const session = preparePreviewDrag(project, project.panels.map(panel => panel.id))!
    const delta: Vec3 = [4, 0, 6]
    const preview = movePreviewDrag(session, delta, 0)
    near(position(preview.project, reference.id), [17, 500, 13])
    const result = finishPreviewDrag(session, preview, delta)
    near(position(result.project, reference.id), [20, 500, 10])
    near(position(result.project, companion.id), [160, 500, 310])
    expect(project).toEqual(snapshot)
  })

  it('keeps the original connections when rounding a released drag back to its start', () => {
    const parent = createPanel({ width: 400, height: 400, position: [0, 500, 0] })
    const project = attachPanel({ ...single(), panels: [parent] }, parent.id,
      createPanel({ width: 400, height: 400 }), { type: '90', side: 'right', flip: false, count: 2, color: '#eeeeee', inset: 0, offset: 0 })
    const session = preparePreviewDrag(project, [parent.id])!
    const delta: Vec3 = [3, 0, 0]
    const preview = movePreviewDrag(session, delta, 0)
    expect(preview.project.connections).toHaveLength(0)
    expect(finishPreviewDrag(session, preview, delta).project).toBe(project)
  })

  it('preserves exact attachment candidates and leaves disabled free drags alone', () => {
    const parent = createPanel({ width: 400, height: 400, position: [13, 500, 7] })
    const attached = attachPanel({ ...single(), panels: [parent] }, parent.id,
      createPanel({ width: 400, height: 400 }), { type: '90', side: 'right', flip: false, count: 2, color: '#eeeeee', inset: 0, offset: 0 })
    const project = { ...attached, connections: [] }
    const session = preparePreviewDrag(project, [project.panels[1].id])!
    const delta: Vec3 = [4, 0, 4]
    const preview = movePreviewDrag(session, delta, 20)
    expect(preview.snap).not.toBeNull()
    expect(finishPreviewDrag(session, preview, delta)).toBe(preview)
    const disabled = { ...project, niceValues: { enabled: false, step: 10 } }
    const disabledSession = preparePreviewDrag(disabled, [project.panels[1].id])!
    const free = movePreviewDrag(disabledSession, delta, 0)
    expect(finishPreviewDrag(disabledSession, free, delta)).toBe(free)
  })

  it('rejects a rounded free drag that conflicts with a saved height range', () => {
    const panel = createPanel({ width: 100, height: 80, position: [0, 45, 0] })
    const project: Project = { ...single(), panels: [panel], constraints: [{ id: 'height', enabled: true, kind: 'floor',
      panelId: panel.id, reference: 'center', relation: 'range', min: 43, max: 47 }] }
    const session = preparePreviewDrag(project, [panel.id])!
    const delta: Vec3 = [0, 1, 0]
    const preview = movePreviewDrag(session, delta, 0)
    near(position(preview.project, panel.id), [0, 46, 0])
    expect(() => finishPreviewDrag(session, preview, delta)).toThrow()
    near(position(project, panel.id), [0, 45, 0])
  })
})
