import { describe, expect, it } from 'vitest'
import { Box3, DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { TROFAST_ITEMS, getTrofastItem } from '@/lib/trofast-catalog'
import { createPanel } from '@/lib/model'
import { getTrofastInsertLocalBounds } from '@/lib/trofast'
import type { TrofastInsert } from '@/lib/types'
import { makeTrofastGeometry } from './trofast-geometry'

function withMeshes(itemId: string, inspect: (group: Group) => void) {
  const parts = makeTrofastGeometry(getTrofastItem(itemId)!)
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const group = new Group()
  for (const part of parts) group.add(new Mesh(part.geometry, material))
  group.updateMatrixWorld(true)
  try { inspect(group) } finally {
    for (const part of parts) part.geometry.dispose()
    material.dispose()
  }
}

describe('TROFAST geometry', () => {
  it.each(TROFAST_ITEMS)('keeps $id within its fixed dimensions in scene meters', item => {
    withMeshes(item.id, group => {
      const bounds = new Box3().setFromObject(group)
      const size = bounds.getSize(new Vector3())
      expect(size.x).toBeCloseTo(item.width / 1000, 4)
      expect(size.y).toBeCloseTo(item.depth / 1000, 4)
      expect(bounds.max.z).toBeCloseTo(item.rimHeight / 1000, 5)
      // Polygonal wire cross-sections can finish within 0.05 mm of the nominal bottom.
      expect(bounds.min.z).toBeCloseTo((item.rimHeight - item.height) / 1000, 4)
      for (const child of group.children) {
        const geometry = (child as Mesh).geometry
        expect([...geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true)
        expect([...geometry.getAttribute('normal').array].every(Number.isFinite)).toBe(true)
      }
    })
  })

  it('leaves the plastic box open, with a recessed floor and an overhanging rim', () => {
    withMeshes('plastic-medium', group => {
      const downAt = (x: number, y: number) => new Raycaster(new Vector3(x, y, 1), new Vector3(0, 0, -1)).intersectObject(group)[0]?.point.z
      expect(downAt(0, 0)).toBeCloseTo(-0.2238, 4)
      expect(downAt(0.205, 0)).toBeCloseTo(0.004, 5)
      expect(downAt(0.22, 0)).toBeUndefined()
      // A ray inside the box reaches the inner wall, including its actual thickness.
      const across = new Raycaster(new Vector3(0, 0, -0.1), new Vector3(1, 0, 0)).intersectObject(group)
      expect(across[0].distance).toBeGreaterThan(0.17)
      expect(across[0].distance).toBeLessThan(0.2)
    })
  })

  it('models the tray wells below the connecting top surface', () => {
    withMeshes('tray', group => {
      const downAt = (x: number, y: number) => new Raycaster(new Vector3(x, y, 1), new Vector3(0, 0, -1)).intersectObject(group)[0]?.point.z
      for (const [x, y] of [[-0.121, 0.044], [-0.121, -0.087], [0.072, 0.087], [0.072, -0.087], [0.117, 0], [-0.001, 0]]) {
        expect(downAt(x, y)).toBeLessThan(-0.04)
      }
      expect(downAt(-0.049, 0)).toBeGreaterThan(0)
    })
  })

  it('renders real holes through the mesh sides and floor', () => {
    withMeshes('mesh-medium', group => {
      let sideOpenings = 0, floorOpenings = 0
      for (let i = 0; i < 20; i++) {
        const coordinate = -0.08 + i * 0.00817
        if (!new Raycaster(new Vector3(coordinate, -1, -0.1137), new Vector3(0, 1, 0)).intersectObject(group).length) sideOpenings++
        if (!new Raycaster(new Vector3(coordinate, 0.0347, 1), new Vector3(0, 0, -1)).intersectObject(group).length) floorOpenings++
      }
      expect(sideOpenings).toBeGreaterThan(8)
      expect(floorOpenings).toBeGreaterThan(8)
      expect(new Raycaster(new Vector3(0.205, 0, 1), new Vector3(0, 0, -1)).intersectObject(group)[0]?.point.z).toBeCloseTo(0.003, 5)
    })
  })

  it.each(TROFAST_ITEMS)('fits the domain clearance envelope for both faces and orientations of $id', item => {
    const panel = createPanel({ width: 800, height: 700, thickness: 18 })
    for (const face of [1, -1] as const) for (const quarterTurn of [false, true]) {
      const insert: TrofastInsert = { id: 'offset-insert', itemId: item.id, colorId: item.colors[0], x: 317, y: 452, face, quarterTurn }
      const envelope = getTrofastInsertLocalBounds(panel, insert)!
      withMeshes(item.id, group => {
        // The scene puts the rim on the selected panel face before orienting the
        // body downward. Off-center placement catches accidental center mirrors.
        group.position.set((insert.x - panel.width / 2) / 1000, (panel.height / 2 - insert.y) / 1000, face * panel.thickness / 2000)
        group.rotation.set(face === -1 ? Math.PI : 0, 0, quarterTurn ? Math.PI / 2 : 0)
        group.updateMatrixWorld(true)
        const actual = new Box3().setFromObject(group)
        for (const axis of [0, 1, 2]) {
          const min = envelope.min[axis] / 1000, max = envelope.max[axis] / 1000
          expect(actual.min.getComponent(axis)).toBeGreaterThanOrEqual(min - 1e-7)
          expect(actual.max.getComponent(axis)).toBeLessThanOrEqual(max + 1e-7)
          expect(actual.min.getComponent(axis)).toBeCloseTo(min, 4)
          expect(actual.max.getComponent(axis)).toBeCloseTo(max, 4)
        }
      })
    }
  })
})
