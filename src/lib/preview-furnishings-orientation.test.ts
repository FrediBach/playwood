import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createPanel } from './model'
import { detectPreviewFurnishings, type FurnishingPlacement } from './preview-furnishings'
import type { Panel, Vec3 } from './types'

const UP = new Vector3(0, 1, 0)

/** The opening is deliberately narrower than its depth; names carry no clues. */
function deepCubby({ back = false, clearance = 350 }: { back?: boolean; clearance?: number } = {}) {
  const topY = 27 + clearance
  const sideY = (9 + topY) / 2
  const sideHeight = clearance - 17
  const panels = [
    createPanel({ id: 'lower', name: 'Panel A', width: 380, height: 420, position: [0, 9, 0], rotation: [-Math.PI / 2, 0, 0] }),
    createPanel({ id: 'upper', name: 'Panel B', width: 380, height: 420, position: [0, topY, 0], rotation: [-Math.PI / 2, 0, 0] }),
    createPanel({ id: 'side-a', name: 'Panel C', width: 420, height: sideHeight, position: [-207.5, sideY, 0], rotation: [0, Math.PI / 2, 0] }),
    createPanel({ id: 'side-b', name: 'Panel D', width: 420, height: sideHeight, position: [207.5, sideY, 0], rotation: [0, Math.PI / 2, 0] }),
  ]
  if (back) panels.push(createPanel({ id: 'back', name: 'Panel E', width: 380, height: sideHeight, position: [0, sideY, -201] }))
  return panels
}

function turnAndMove(panels: Panel[], yaw: number, shift: Vec3 = [0, 0, 0]) {
  const quaternion = new Quaternion().setFromAxisAngle(UP, yaw)
  return panels.map(panel => {
    const rotation = new Euler().setFromQuaternion(quaternion.clone().multiply(new Quaternion().setFromEuler(new Euler(...panel.rotation))))
    return { ...panel, position: new Vector3(...panel.position).applyQuaternion(quaternion).add(new Vector3(...shift)).toArray() as Vec3,
      rotation: [rotation.x, rotation.y, rotation.z] as Vec3 }
  })
}

function booksOn(panels: Panel[], panelId: string) {
  const books = detectPreviewFurnishings(panels).filter(item => item.kind === 'books' && item.panelId === panelId)
  expect(books.length).toBeGreaterThan(0)
  return books
}

function expectFacing(placement: FurnishingPlacement, direction: Vector3) {
  const facing = new Vector3(0, 0, 1).applyAxisAngle(UP, placement.rotation)
  expect(facing.dot(direction.clone().normalize())).toBeCloseTo(1, 8)
}

describe('preview books follow shelf openings', () => {
  it('faces out of a cubby whose opening is narrower than its depth, including its low base', () => {
    const panels = deepCubby()
    const books = booksOn(panels, 'lower')
    for (const item of books) {
      expectFacing(item, new Vector3(0, 0, 1))
      expect(item.position[1]).toBeCloseTo(0.020, 8)
    }
  })

  it('uses the room front for a deep narrow board with no surrounding walls', () => {
    const panel = { ...deepCubby()[0], position: [0, 700, 0] as Vec3 }
    for (const item of booksOn([panel], 'lower')) expectFacing(item, new Vector3(0, 0, 1))
  })

  it('preserves the opening when horizontal panel width and height axes are swapped', () => {
    const original = deepCubby({ back: true })
    const swapped = original.map(panel => {
      if (panel.id !== 'lower' && panel.id !== 'upper') return panel
      const rotation = new Euler().setFromQuaternion(new Quaternion().setFromEuler(new Euler(...panel.rotation))
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)))
      return { ...panel, width: panel.height, height: panel.width, rotation: [rotation.x, rotation.y, rotation.z] as Vec3 }
    })
    const before = booksOn(original, 'lower'), after = booksOn(swapped, 'lower')
    expect(after).toHaveLength(before.length)
    after.forEach((item, index) => {
      expectFacing(item, new Vector3(0, 0, 1))
      item.position.forEach((value, axis) => expect(value).toBeCloseTo(before[index].position[axis], 8))
    })
  })

  it('follows side walls through yaw and translation instead of the longest panel dimension', () => {
    const panels = deepCubby(), yaw = 0.63, shift: Vec3 = [1400, 0, -1800]
    const original = booksOn(panels, 'lower')
    const moved = booksOn(turnAndMove(panels, yaw, shift), 'lower')
    const direction = new Vector3(0, 0, 1).applyAxisAngle(UP, yaw)
    expect(moved).toHaveLength(original.length)
    moved.forEach((item, index) => {
      expectFacing(item, direction)
      const expected = new Vector3(...original[index].position).applyAxisAngle(UP, yaw).add(new Vector3(...shift).multiplyScalar(0.001))
      item.position.forEach((value, axis) => expect(value).toBeCloseTo(expected.getComponent(axis), 8))
    })
  })

  it('prioritises a real back wall over room front after turning more than ninety degrees', () => {
    const yaw = Math.PI * 0.7
    const panels = turnAndMove(deepCubby({ back: true }), yaw, [900, 0, 1500])
    const direction = new Vector3(0, 0, 1).applyAxisAngle(UP, yaw)
    for (const item of booksOn(panels, 'lower')) expectFacing(item, direction)
  })

  it('uses the side and back geometry below the top shelf when there are no walls above it', () => {
    const yaw = Math.PI * 0.7
    const panels = turnAndMove(deepCubby({ back: true }), yaw)
    const direction = new Vector3(0, 0, 1).applyAxisAngle(UP, yaw)
    for (const item of booksOn(panels, 'upper')) expectFacing(item, direction)
  })

  it('faces the remaining open side when the front is closed', () => {
    const panels = deepCubby({ back: true }).map(panel => panel.id === 'back'
      ? { ...panel, position: [0, panel.position[1], 201] as Vec3 } : panel)
    for (const item of booksOn(panels, 'lower')) expectFacing(item, new Vector3(0, 0, -1))
  })

  it('ignores hidden and distant vertical panels when choosing the opening', () => {
    const panels = deepCubby({ back: true })
    const original = booksOn(panels, 'lower')
    const back = panels.find(panel => panel.id === 'back')!
    panels.push({ ...back, id: 'hidden-front', visible: false, position: [0, back.position[1], 201] })
    panels.push({ ...back, id: 'distant-wall', width: 5000, height: 2000, position: [0, 1000, 3000] })
    expect(booksOn(panels, 'lower')).toEqual(original)
    expect(booksOn([...panels].reverse(), 'lower')).toEqual(original)
  })

  it('uses flat stacks in a low shelf where upright books cannot fit', () => {
    const panels = deepCubby({ clearance: 150 })
    for (const item of booksOn(panels, 'lower')) {
      expect(item.bookArrangement).toBe('stacked')
      expectFacing(item, new Vector3(0, 0, 1))
      expect(item.position[1] + 0.13).toBeLessThan((panels[1].position[1] - 9) / 1000)
    }
  })
})
