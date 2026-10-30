import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject, parseProject, resolvePanels } from './model'
import { createListGroup, moveListItems, orderedConnectors, renameListGroup, ungroupList } from './list-groups'
import { getPhysicalConnectors } from './connector-selection'
import type { Project } from './types'

describe('list organization', () => {
  it('moves panels between flat groups without altering joints or resolved geometry', () => {
    const original = createStarterProject('shelf')
    const ids = original.panels.slice(0, 2).map(panel => panel.id)
    const grouped = createListGroup(original, 'panels', ids, 'first')
    const second = createListGroup(grouped, 'panels', [], 'second')
    const moved = moveListItems(second, 'panels', [ids[0]], 'second')
    expect(moved.listGroups?.map(group => group.itemIds)).toEqual([[ids[1]], [ids[0]]])
    expect(moved.connections).toBe(original.connections)
    const byId = (project: Project) => resolvePanels(project).sort((a, b) => a.id.localeCompare(b.id))
    expect(byId(moved)).toEqual(byId(original))
    const ungrouped = moveListItems(moved, 'panels', ids, null)
    expect(ungrouped.listGroups?.every(group => !group.itemIds.length)).toBe(true)
    expect(original.listGroups).toBeUndefined()
  })

  it('moves and orders individual hardware while preserving per-piece overrides', () => {
    const original = createStarterProject('shelf')
    const connectors = getPhysicalConnectors(original)
    original.connectorOverrides = { [connectors[0].id]: { color: '#123456', slide: 12 } }
    const grouped = createListGroup(original, 'connectors', [connectors[0].id, connectors[1].id], 'hardware')
    const moved = moveListItems(grouped, 'connectors', [connectors[1].id], 'hardware', connectors[0].id)
    const groupIds = new Set(moved.listGroups![0].itemIds)
    expect(orderedConnectors(moved).filter(item => groupIds.has(item.id)).map(item => item.id)).toEqual([connectors[1].id, connectors[0].id])
    expect(moved.connectorOverrides).toEqual(original.connectorOverrides)
    expect(moved.connections).toBe(original.connections)
    expect(ungroupList(moved, 'hardware').listGroups).toEqual([])
    expect(getPhysicalConnectors(ungroupList(moved, 'hardware'))).toEqual(getPhysicalConnectors(original))
  })

  it('round-trips names, membership and connector ordering and tolerates deleted members', () => {
    const original = createStarterProject('shelf')
    let project = createListGroup(original, 'panels', [original.panels[0].id], 'panels')
    project = createListGroup(project, 'connectors', [getPhysicalConnectors(project)[0].id], 'connectors')
    project = renameListGroup(project, 'panels', '  Shelves  ')
    const parsed = parseProject(JSON.parse(JSON.stringify(project)))
    expect(parsed.listGroups).toEqual(project.listGroups)
    expect(parsed.connectorOrder).toEqual(project.connectorOrder)
    expect(parsed.listGroups![0].name).toBe('Shelves')
    expect(renameListGroup(project, 'panels', '   ')).toBe(project)
    project.listGroups![0].itemIds.push('deleted-panel')
    expect(parseProject(project).listGroups![0].itemIds).toEqual([original.panels[0].id])
    expect(parseProject({ ...original, listGroups: undefined }).listGroups).toBeUndefined()
  })

  it('rejects malformed group metadata and prevents duplicate memberships', () => {
    const panel = createPanel({ name: 'A' })
    const project: Project = { version: 1, name: 'Test', panels: [panel], connections: [] }
    const group = { id: 'group', name: 'Group', kind: 'panels', itemIds: [panel.id] }
    expect(() => parseProject({ ...project, listGroups: [group, group] })).toThrow('Group IDs must be unique')
    expect(() => parseProject({ ...project, listGroups: [{ ...group, kind: 'nested' }] })).toThrow()
    expect(() => parseProject({ ...project, listGroups: [{ ...group, itemIds: [42] }] })).toThrow()
    const parsed = parseProject({ ...project, listGroups: [group, { ...group, id: 'second' }] })
    expect(parsed.listGroups![1].itemIds).toEqual([])
    expect(moveListItems(project, 'panels', [panel.id], 'missing')).toBe(project)
  })
})
