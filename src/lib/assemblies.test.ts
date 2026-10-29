import { describe, expect, it } from 'vitest'
import { gridProject } from './example-geometry'
import { Euler, Vector3 } from 'three'
import { createPanel, getProjectBounds, parseProject, rotateProject, validateProject } from './model'
import { createAssembly, disconnectAssembly, duplicateAssembly, getAssemblyAttachmentTargets, instantiateAssembly, makeAssemblyIndependent, materializeAssemblies, moveAssemblies, removeAssembly, resetAssemblyFinish, updateAssemblyDefinition, updateAssemblyFinish } from './assemblies'
import { movePanels, resizePanels } from './structure-edit'
import type { Project } from './types'

function box(): Project {
  const project = gridProject('Box study', [350], [350], { depth: 350 })
  return createAssembly(project, project.panels.map(panel => panel.id), 'Box')
}

function add(project: Project, label: string): Project {
  const targets = getAssemblyAttachmentTargets(project, project.assemblies!.instances.at(-1)!.id)
  const target = targets.find(item => item.label === label)
  expect(target, `Missing ${label}; available ${targets.map(item => `${item.label}: ${item.error ?? 'valid'}`)}`).toBeDefined()
  expect(target!.error, `${label}: ${target!.error}`).toBeUndefined()
  return target!.project!
}

function diamond(): Project { return add(add(add(box(), 'Top right'), 'Bottom right'), 'Bottom left') }
function count(project: Project, type: string) { return project.connections.filter(connection => connection.type === type).reduce((sum, connection) => sum + connection.count, 0) }

describe('reusable assemblies', () => {
  it('creates linked copies and joins the final box at both matching corners', () => {
    const initial = box()
    expect(initial.assemblies!.definitions[0].ports).toHaveLength(4)
    const project = diamond()
    expect(project.assemblies!.definitions).toHaveLength(1)
    expect(project.assemblies!.instances).toHaveLength(4)
    expect(project.assemblies!.links).toHaveLength(4)
    expect(project.panels).toHaveLength(16)
    expect(count(project, '90')).toBe(16)
    expect(count(project, 'cross')).toBe(8)
    expect(validateProject(project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
  })

  it('restores ordinary corners when removing or disconnecting a box', () => {
    const project = diamond(), lastId = project.assemblies!.instances.at(-1)!.id
    const removed = removeAssembly(project, lastId)
    expect(removed.panels).toHaveLength(12)
    expect(removed.assemblies!.links).toHaveLength(2)
    expect(count(removed, '90')).toBe(16)
    expect(count(removed, 'cross')).toBe(4)
    expect(validateProject(removed)).toEqual([])
    const disconnected = disconnectAssembly(project, lastId)
    expect(disconnected.panels).toHaveLength(16)
    expect(count(disconnected, '90')).toBe(24)
    expect(count(disconnected, 'cross')).toBe(4)
    expect(validateProject(disconnected)).toEqual([])
    expect(disconnected.assemblies!.instances.at(-1)!.position).not.toEqual(project.assemblies!.instances.at(-1)!.position)
    expect(parseProject(JSON.parse(JSON.stringify(disconnected)))).toEqual(disconnected)
  })

  it('updates a shared source and propagates linked placements around the closed loop', () => {
    const project = diamond(), instance = project.assemblies!.instances[0]
    const resized = updateAssemblyDefinition(project, instance.id, { width: 400 })
    expect(resized.panels.every(panel => panel.width === 400)).toBe(true)
    expect(resized.assemblies!.links).toEqual(project.assemblies!.links)
    expect(resized.panels.map(panel => panel.id)).toEqual(project.panels.map(panel => panel.id))
    expect(validateProject(resized)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(resized)))).toEqual(resized)
    expect(() => updateAssemblyDefinition(project, instance.id, { thickness: 16 })).toThrow(/18–19/)
    expect(project.panels.every(panel => panel.width === 350 && panel.thickness === 18)).toBe(true)
  })

  it('preserves the exact project when a rejected source edit restores an unchanged field', () => {
    const project = rotateProject(diamond(), 'z', 45), instance = project.assemblies!.instances[0]
    const saved = JSON.stringify(project)
    expect(() => updateAssemblyDefinition(project, instance.id, { thickness: 17 })).toThrow(/18–19/)
    expect(JSON.stringify(project)).toBe(saved)
    expect(updateAssemblyDefinition(project, instance.id, { thickness: 18 })).toBe(project)
    expect(updateAssemblyDefinition(project, instance.id, { width: 350, height: 350 })).toBe(project)
    expect(updateAssemblyDefinition(project, instance.id, { position: [100, 200, 300], width: undefined })).toBe(project)
    expect(JSON.stringify(project)).toBe(saved)
  })

  it('retains local finish overrides through source edits and reset', () => {
    const project = diamond(), instance = project.assemblies!.instances[0]
    const painted = updateAssemblyFinish(project, instance.id, { color: '#123456' })
    const edited = updateAssemblyDefinition(painted, instance.id, { color: '#abcdef' })
    const localIds = new Set(Object.values(instance.panelIds))
    expect(edited.panels.filter(panel => localIds.has(panel.id)).every(panel => panel.color === '#123456')).toBe(true)
    expect(edited.panels.filter(panel => !localIds.has(panel.id)).every(panel => panel.color === '#abcdef')).toBe(true)
    const reset = resetAssemblyFinish(edited, instance.id)
    expect(reset.panels.every(panel => panel.color === '#abcdef')).toBe(true)
  })

  it('makes an instance independent while preserving its physical connections', () => {
    const project = diamond(), instance = project.assemblies!.instances[0]
    const independent = makeAssemblyIndependent(project, instance.id)
    expect(independent.panels).toEqual(project.panels)
    expect(independent.connections).toEqual(project.connections)
    expect(independent.assemblies!.instances[0].definitionId).not.toBe(instance.definitionId)
    const edited = updateAssemblyDefinition(independent, instance.id, { color: '#123456' })
    expect(edited.panels.filter(panel => panel.color === '#123456')).toHaveLength(4)
  })

  it('moves connected instances rigidly and preserves metadata after whole-project rotation', () => {
    const project = diamond(), first = project.assemblies!.instances[0]
    const moved = moveAssemblies(project, [first.id], [100, 20, -50])
    moved.panels.forEach((panel, i) => {
      expect(panel.width).toBe(project.panels[i].width)
      expect(panel.position[0]).toBeCloseTo(project.panels[i].position[0] + 100)
      expect(panel.position[1]).toBeCloseTo(project.panels[i].position[1] + 20)
      expect(panel.position[2]).toBeCloseTo(project.panels[i].position[2] - 50)
    })
    const rotated = rotateProject(project, 'z', 45)
    expect(getProjectBounds(rotated.panels).min[1]).toBeCloseTo(getProjectBounds(project.panels).min[1])
    expect(parseProject(JSON.parse(JSON.stringify(rotated)))).toEqual(rotated)
    const rebuilt = materializeAssemblies(rotated)
    rebuilt.panels.forEach((panel, i) => panel.position.forEach((number, axis) => expect(number).toBeCloseTo(rotated.panels[i].position[axis])))
    expect(validateProject(rebuilt)).toEqual([])
  })

  it('duplicates a rotated instance without moving or overlapping the original', () => {
    const project = rotateProject(box(), 'z', 45), instance = project.assemblies!.instances[0]
    const copied = duplicateAssembly(project, instance.id)
    expect(copied.assemblies!.instances).toHaveLength(2)
    expect(copied.assemblies!.instances[1].rotation).toEqual(instance.rotation)
    expect(copied.panels.slice(0, 4)).toEqual(materializeAssemblies(project).panels)
    expect(validateProject(copied)).toEqual([])
  })

  it('keeps source definitions available after the final instance is removed', () => {
    const project = box(), instance = project.assemblies!.instances[0]
    const removed = removeAssembly(project, instance.id)
    expect(removed.panels).toHaveLength(0)
    expect(removed.assemblies!.definitions).toHaveLength(1)
    const inserted = instantiateAssembly(parseProject(JSON.parse(JSON.stringify(removed))), instance.definitionId)
    expect(inserted.panels).toHaveLength(4)
    expect(getProjectBounds(inserted.panels).min[1]).toBeCloseTo(0)
    expect(validateProject(inserted)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(inserted)))).toEqual(inserted)
  })

  it('does not deform instances when editing a touching loose panel', () => {
    const project = box(), instance = project.assemblies!.instances[0]
    const floor = project.panels.filter(panel => Math.abs(new Vector3(0, 0, 1).applyEuler(new Euler(...panel.rotation)).y) > 0.99).sort((a, b) => a.position[1] - b.position[1])[0]
    const loose = createPanel({ width: 100, height: 100, rotation: [...floor.rotation], position: [floor.position[0], floor.position[1] + 18, floor.position[2]] })
    const touching = { ...project, panels: [...project.panels, loose] }
    const moved = movePanels(touching, [loose.id], [0, 10, 0])
    expect(moved.panels.slice(0, 4)).toEqual(project.panels)
    expect(moved.panels.at(-1)!.position[1]).toBeCloseTo(loose.position[1] + 10)
    expect(resizePanels(touching, [loose.id], { width: 150 }).panels.slice(0, 4)).toEqual(project.panels)
    expect(() => movePanels(touching, Object.values(instance.panelIds), [10, 0, 0])).toThrow(/assembly source/)
    expect(() => resizePanels(touching, [project.panels[0].id], { width: 400 })).toThrow(/assembly source/)
    expect(parseProject(JSON.parse(JSON.stringify(moved)))).toEqual(moved)
  })

  it('rejects malformed or contradictory metadata instead of flattening away links', () => {
    const project = diamond()
    const missing = structuredClone(project)
    missing.assemblies!.instances[0].definitionId = 'missing'
    expect(() => parseProject(missing)).toThrow(/source/)
    const moved = structuredClone(project)
    moved.assemblies!.instances[0].position[0] += 100
    expect(() => parseProject(moved)).toThrow(/align|match/)
    const duplicatedPort = structuredClone(project)
    duplicatedPort.assemblies!.links.push({ ...duplicatedPort.assemblies!.links[0], id: 'another' })
    expect(() => parseProject(duplicatedPort)).toThrow(/more than once/)
  })
})
