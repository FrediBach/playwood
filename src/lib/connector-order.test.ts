import { describe, expect, it } from 'vitest'
import { createStarterProject } from './model'
import { connectorId } from './connector-selection'
import { connectorOrderGroups, connectorOrderText, createConnectorOrder, ORDER_CATALOG } from './connector-order'

describe('connector order', () => {
  it('counts physical pieces and overrides, ignores removals, and merges replacement colors', () => {
    const base = createStarterProject('shelf')
    const connection = { ...base.connections[0], type: '90' as const, count: 4, color: '#ff0000' }
    const project = { ...base, connections: [connection], connectorOverrides: {
      [connectorId(connection.id, 0)]: { removed: true },
      [connectorId(connection.id, 1)]: { color: '#ffffff' },
    } }
    const before = JSON.stringify(project)
    const groups = connectorOrderGroups(project)
    expect(groups.map(group => group.count).sort()).toEqual([1, 2])
    expect(createConnectorOrder(project, {}).unresolved).toBe(2)
    expect(() => connectorOrderText(project, {})).toThrow(/Choose/)
    const choices = { [groups.find(group => !group.defaultColor)!.key]: 'White' }
    expect(createConnectorOrder(project, choices)).toEqual({ unresolved: 0, totalCents: 822, lines: [{ productId: '90', color: 'White', count: 3, cents: 822 }] })
    expect(connectorOrderText(project, choices)).toContain('3 × 90° plastic connector · White')
    expect(JSON.stringify(project)).toBe(before)
  })
  it('uses effective metal material and ignores its retained plastic color', () => {
    const base = createStarterProject('shelf')
    const project = { ...base, connections: [{ ...base.connections[0], type: '90' as const, material: 'metal' as const, count: 1 }] }
    expect(createConnectorOrder(project, {})).toMatchObject({ totalCents: 790, unresolved: 0, lines: [{ color: 'Gray' }] })
    const group = connectorOrderGroups(project)[0]
    expect(createConnectorOrder(project, { [group.key]: 'Red' }).unresolved).toBe(1)
  })
  it('records the manufacturer color sets and handles empty projects', () => {
    expect(ORDER_CATALOG.cross.colors).toEqual(['Red','Black','White','Gray'])
    expect(ORDER_CATALOG['105'].colors).toEqual(['Red','Green','Army','Blue'])
    expect(ORDER_CATALOG['150'].colors).toEqual(ORDER_CATALOG['105'].colors)
    expect(createConnectorOrder(createStarterProject('blank'), {})).toEqual({ lines: [], unresolved: 0, totalCents: 0 })
  })
})
