import { describe, expect, it } from 'vitest'
import { CONNECTOR_LOCAL_BOUNDS } from '@/lib/connector-bounds'
import { getConnectorGeometry } from '@/lib/connector-geometry'
import type { ConnectorType } from '@/lib/types'

describe('domain connector clearance bounds', () => {
  it.each(Object.keys(CONNECTOR_LOCAL_BOUNDS) as ConnectorType[])('matches the normalized %s CAD parts without a domain OBJ import', type => {
    const parts = getConnectorGeometry(type)
    expect(CONNECTOR_LOCAL_BOUNDS[type]).toHaveLength(parts.length)
    parts.forEach((part, index) => {
      const bounds = part.geometry.boundingBox!
      for (const end of ['min', 'max'] as const) bounds[end].toArray().forEach((value, axis) => {
        expect(CONNECTOR_LOCAL_BOUNDS[type][index][end][axis]).toBeCloseTo(value * 1000, 4)
      })
    })
  })
})
