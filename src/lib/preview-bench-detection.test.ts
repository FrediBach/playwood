import { describe, expect, it } from 'vitest'
import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { createPanel, resolvePanels } from './model'
import { createExampleProject } from './example-library'
import { createPreviewBenchProject, PREVIEW_BENCH_SEAT_ID } from './fixtures/preview-bench'
import { detectPreviewFurnishings, type FurnishingPlacement } from './preview-furnishings'
import type { Panel, Vec3 } from './types'

const UP = new Vector3(0, 1, 0)
const seatPerson = (panels: Panel[]) => detectPreviewFurnishings(panels)
  .find(item => item.kind === 'seated-person' && item.panelId === PREVIEW_BENCH_SEAT_ID)

function transform(panels: Panel[], yaw: number, shift: Vec3) {
  const quaternion = new Quaternion().setFromAxisAngle(UP, yaw)
  return panels.map(panel => {
    const rotation = new Euler().setFromQuaternion(quaternion.clone().multiply(new Quaternion().setFromEuler(new Euler(...panel.rotation))))
    return { ...panel, position: new Vector3(...panel.position).applyQuaternion(quaternion).add(new Vector3(...shift)).toArray() as Vec3,
      rotation: [rotation.x, rotation.y, rotation.z] as Vec3 }
  })
}

function panelBox(panel: Panel) {
  return new OBB(new Vector3(...panel.position).multiplyScalar(0.001),
    new Vector3(panel.width, panel.height, panel.thickness).multiplyScalar(0.0005),
    new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromEuler(new Euler(...panel.rotation))))
}

/** Physical body samples, independent of the detector's larger clearance envelopes. */
function bodySamples(placement: FurnishingPlacement) {
  const pose = new Matrix4().makeRotationY(placement.rotation)
  pose.setPosition(...placement.position)
  return [
    { center: [0, 0.34, -0.02], size: [0.32, 0.5, 0.19] },
    { center: [0, 0.71, -0.01], size: [0.15, 0.20, 0.15] },
    ...[-1, 1].flatMap(sign => [
      { center: [sign * 0.1, 0.08, 0.16], size: [0.11, 0.10, 0.27] },
      { center: [sign * 0.105, -placement.seatHeight! / 2, 0.36], size: [0.065, placement.seatHeight! - 0.11, 0.065] },
      { center: [sign * 0.105, -placement.seatHeight! + 0.043, 0.421], size: [0.09, 0.08, 0.19] },
    ]),
  ].map(({ center, size }) => new OBB(new Vector3(center[0], center[1], center[2]).applyMatrix4(pose),
    new Vector3(size[0], size[1], size[2]).multiplyScalar(0.5), new Matrix3().setFromMatrix4(pose)))
}

describe('benches incorporated into shelving', () => {
  it('seats a person along the exposed side of a long bench projecting from a tall cubby', () => {
    const panels = createPreviewBenchProject().panels.map(panel => ({ ...panel, name: 'Board' }))
    const person = seatPerson(panels)
    expect(person).toBeDefined()
    expect(seatPerson([...panels].reverse())).toEqual(person)
    expect(person!.position[2]).toBeGreaterThan(0.55)
    expect(person!.position[2]).toBeLessThan(1.4)
    expect(Math.abs(person!.position[0])).toBeLessThan(0.18)
    expect(person!.position[1]).toBeCloseTo(0.402, 8)
    const facing = new Vector3(0, 0, 1).applyAxisAngle(UP, person!.rotation)
    expect(Math.abs(facing.x)).toBeCloseTo(1, 8)
    expect(facing.z).toBeCloseTo(0, 8)
  })

  it('recognises a 300 mm deep bench at a 350 mm seat height', () => {
    const person = seatPerson(createPreviewBenchProject({ seatDepth: 300, seatHeight: 350 }).panels)
    expect(person).toBeDefined()
    expect(Math.abs(person!.position[0])).toBeLessThan(0.15)
    expect(person!.position[1]).toBeCloseTo(0.352, 8)
    expect(person!.position[1] - person!.seatHeight!).toBeCloseTo(-0.012, 8)
  })

  it('does not let a hutch over one end veto the clear part of the seat', () => {
    const open = seatPerson(createPreviewBenchProject({ hutch: false }).panels)
    const coveredEnd = seatPerson(createPreviewBenchProject({ hutch: true }).panels)
    expect(open).toBeDefined()
    expect(coveredEnd).toBeDefined()
    expect(coveredEnd!.position[2]).toBeGreaterThan(0.55)
  })

  it('preserves the selected seat location, facing and grounded feet when moved and rotated', () => {
    const panels = createPreviewBenchProject().panels, yaw = 0.63, shift: Vec3 = [1700, 0, -600]
    const original = seatPerson(panels), moved = seatPerson(transform(panels, yaw, shift))
    expect(original).toBeDefined()
    expect(moved).toBeDefined()
    const expected = new Vector3(...original!.position).applyAxisAngle(UP, yaw).add(new Vector3(...shift).multiplyScalar(0.001))
    moved!.position.forEach((value, axis) => expect(value).toBeCloseTo(expected.getComponent(axis), 8))
    const expectedFacing = new Vector3(0, 0, 1).applyAxisAngle(UP, original!.rotation + yaw)
    expect(new Vector3(0, 0, 1).applyAxisAngle(UP, moved!.rotation).dot(expectedFacing)).toBeCloseTo(1, 8)
    expect(moved!.position[1] - moved!.seatHeight!).toBeCloseTo(-0.012, 8)
  })

  it('keeps the torso, head, thighs, lower legs and shoes clear of every visible panel', () => {
    const panels = createPreviewBenchProject().panels
    const person = seatPerson(panels)
    expect(person).toBeDefined()
    for (const sample of bodySamples(person!)) for (const panel of panels.filter(item => item.visible)) {
      expect(sample.intersectsOBB(panelBox(panel)), `Body intersects ${panel.id}`).toBe(false)
    }
  })

  it('does not use two supports at the attached end to justify an unsupported cantilever', () => {
    const panels = createPreviewBenchProject({ hutch: false }).panels.filter(panel => panel.id !== 'preview-bench-front-leg')
    expect(seatPerson(panels)).toBeUndefined()
  })

  it('recognises the attached end supported through a short upright, bearing board and lower uprights', () => {
    const panels = createPreviewBenchProject({ hutch: false }).panels
      .filter(panel => panel.id !== 'preview-cubby-support-0' && panel.id !== 'preview-cubby-support-1')
    panels.push(createPanel({ id: 'root-bearing-board', width: 430, height: 350,
      position: [0, 216, 375], rotation: [-Math.PI / 2, 0, 0] }))
    for (const x of [-197.5, 197.5]) {
      panels.push(createPanel({ id: `root-short-upright-${x}`, width: 350, height: 150,
        position: [x, 300, 375], rotation: [0, Math.PI / 2, 0] }))
      panels.push(createPanel({ id: `root-lower-upright-${x}`, width: 350, height: 198,
        position: [x, 99, 375], rotation: [0, Math.PI / 2, 0] }))
    }
    expect(seatPerson(panels)).toBeDefined()
  })

  it('does not seat a person on a tightly stacked shelf or a blocked seating span', () => {
    const panels = createPreviewBenchProject().panels
    panels.push(createPanel({ id: 'low-ceiling', width: 360, height: 1200,
      position: [0, 550, 800], rotation: [-Math.PI / 2, 0, 0] }))
    expect(seatPerson(panels)).toBeUndefined()
  })

  it('rejects a narrow ledge, high desktop, tilted seat and hidden free leg', () => {
    for (const options of [{ seatDepth: 220 }, { seatHeight: 740 }]) {
      expect(seatPerson(createPreviewBenchProject(options).panels)).toBeUndefined()
    }
    const tilted = createPreviewBenchProject().panels.map(panel => panel.id === PREVIEW_BENCH_SEAT_ID
      ? { ...panel, rotation: [-Math.PI / 2 + 0.08, 0, 0] as Vec3 } : panel)
    expect(seatPerson(tilted)).toBeUndefined()
    const hiddenLeg = createPreviewBenchProject().panels.map(panel => panel.id === 'preview-bench-front-leg' ? { ...panel, visible: false } : panel)
    expect(seatPerson(hiddenLeg)).toBeUndefined()
  })

  it('retains seating on the existing gallery bench', () => {
    expect(detectPreviewFurnishings(resolvePanels(createExampleProject('bench'))).some(item => item.kind === 'seated-person')).toBe(true)
  })
})
