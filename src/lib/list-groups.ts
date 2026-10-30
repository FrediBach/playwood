import { getPhysicalConnectors } from './connector-selection'
import type { ListGroup, ListKind, Project } from './types'

export function orderedConnectors(project: Project) {
  const connectors = getPhysicalConnectors(project)
  const rank = new Map(project.connectorOrder?.map((id, index) => [id, index]))
  return connectors.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
}

function availableIds(project: Project, kind: ListKind) {
  return kind === 'panels' ? project.panels.map(panel => panel.id) : orderedConnectors(project).map(connector => connector.id)
}

export function moveListItems(project: Project, kind: ListKind, ids: string[], groupId: string | null, beforeId: string | null = null): Project {
  const groups = project.listGroups ?? []
  if (groupId !== null && !groups.some(group => group.id === groupId && group.kind === kind)) return project
  const order = availableIds(project, kind)
  const wanted = new Set(ids)
  const moving = order.filter(id => wanted.has(id))
  if (!moving.length) return project
  const remaining = order.filter(id => !wanted.has(id))
  const index = beforeId === null ? remaining.length : remaining.indexOf(beforeId)
  if (index < 0) return project
  remaining.splice(index, 0, ...moving)
  const listGroups = groups.map(group => group.kind !== kind ? group : {
    ...group, itemIds: [...group.itemIds.filter(id => !wanted.has(id)), ...(group.id === groupId ? moving : [])],
  })
  if (kind === 'connectors') return { ...project, listGroups, connectorOrder: remaining }
  const panels = new Map(project.panels.map(panel => [panel.id, panel]))
  return { ...project, listGroups, panels: remaining.map(id => panels.get(id)!) }
}

export function createListGroup(project: Project, kind: ListKind, ids: string[], id: string): Project {
  const groups = project.listGroups ?? []
  let number = 1
  while (groups.some(group => group.kind === kind && group.name === `Group ${number}`)) number++
  const group: ListGroup = { id, kind, name: `Group ${number}`, itemIds: [] }
  return moveListItems({ ...project, listGroups: [...groups, group] }, kind, ids, id)
}

export function renameListGroup(project: Project, id: string, name: string): Project {
  const trimmed = name.trim().slice(0, 120)
  return trimmed ? { ...project, listGroups: project.listGroups?.map(group => group.id === id ? { ...group, name: trimmed } : group) } : project
}

/** Removing a folder keeps all its contents. */
export function ungroupList(project: Project, id: string): Project {
  return { ...project, listGroups: project.listGroups?.filter(group => group.id !== id) }
}
