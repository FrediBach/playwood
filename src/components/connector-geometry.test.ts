import { describe, expect, it } from 'vitest'
import { Box3, DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import type { ConnectorType } from '@/lib/types'
import { CONNECTOR_PROFILES } from '@/lib/connector-profile'
import { getConnectorGeometry } from './connector-geometry'

const types: ConnectorType[] = ['90', '105', '150', 't', 'cross']

function profile(type: ConnectorType) {
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const group = new Group()
  for (const part of getConnectorGeometry(type)) group.add(new Mesh(part.geometry, material))
  group.updateMatrixWorld(true)
  return { group, material }
}

function hitsProfile(group: Group, angle: number, acrossSlot: number, along = 0.03) {
  // Cast through the full extrusion at a point inside the panel cross-section.
  const origin = new Vector3(
    Math.cos(angle) * along - Math.sin(angle) * acrossSlot,
    -0.05,
    Math.sin(angle) * along + Math.cos(angle) * acrossSlot,
  )
  return new Raycaster(origin, new Vector3(0, 1, 0)).intersectObject(group).length > 0
}

describe('supplied connector CAD geometry', () => {
  it.each(types)('keeps the %s bodies at their original 40 mm depth in scene meters', type => {
    const { group, material } = profile(type)
    const bounds = new Box3().setFromObject(group)
    expect(bounds.min.y).toBeCloseTo(-0.02, 6)
    expect(bounds.max.y).toBeCloseTo(0.02, 6)
    expect(bounds.getSize(new Vector3()).length()).toBeLessThan(0.2)
    expect(group.children).toHaveLength(type === 't' || type === 'cross' ? 3 : 2)
    for (const part of getConnectorGeometry(type)) {
      expect(part.geometry.getAttribute('position').count).toBeGreaterThan(36)
      expect(part.geometry.getAttribute('normal').count).toBe(part.geometry.getAttribute('position').count)
    }
    material.dispose()
  })

  it.each(types)('registers the %s panel slots with 18 mm clearance and solid jaws', type => {
    const { group, material } = profile(type)
    const angles = type === 'cross' ? [0, Math.PI / 2, Math.PI, -Math.PI / 2]
      : type === 't' ? [0, Math.PI / 2, Math.PI]
        : [0, Number(type) * Math.PI / 180]
    for (const angle of angles) {
      for (const along of [CONNECTOR_PROFILES[type].seat / 1000 + 0.0001, 0.03, 0.06]) {
        for (const offset of [-0.0089, 0, 0.0089]) expect(hitsProfile(group, angle, offset, along)).toBe(false)
      }
      for (const offset of [-0.0092, 0.0092]) expect(hitsProfile(group, angle, offset)).toBe(true)
    }
    material.dispose()
  })

  it('reuses source geometry for repeated connector instances', () => {
    expect(getConnectorGeometry('90')[0].geometry).toBe(getConnectorGeometry('90')[0].geometry)
  })
})
