import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createPanel, createStarterProject, resolvePanels } from './model'
import { createExampleProject } from './example-library'
import { detectPreviewFurnishings, MAX_PREVIEW_FURNISHINGS } from './preview-furnishings'
import type { Panel, Vec3 } from './types'

const shelf = (overrides: Partial<Panel> = {}) => createPanel({ id: 'surface', name: 'Untitled', width: 1000, height: 360,
  position: [0, 700, 0], rotation: [-Math.PI / 2, 0, 0], ...overrides })
const starter = (kind: 'desk' | 'shelf') => resolvePanels(createStarterProject(kind))
function transform(panels: Panel[], yaw: number, shift: Vec3) {
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
  return panels.map(panel => {
    const euler = new Euler().setFromQuaternion(rotation.clone().multiply(new Quaternion().setFromEuler(new Euler(...panel.rotation))))
    return { ...panel, position: new Vector3(...panel.position).applyQuaternion(rotation).add(new Vector3(...shift)).toArray() as Vec3,
      rotation: [euler.x, euler.y, euler.z] as Vec3 }
  })
}

describe('optional preview furnishings', () => {
  it('keeps cutout panels clear and respects boxes hanging above another shelf', () => {
    const panels = starter('desk')
    const top = panels.find(panel => panel.name === 'Desktop')!
    const withBox = panels.map(panel => panel.id === top.id ? { ...panel, trofastInserts: [{ id: 'box', itemId: 'plastic-medium', colorId: 'white', x: panel.width / 2, y: panel.height / 2, face: 1 as const }] } : panel)
    expect(detectPreviewFurnishings(withBox).filter(item => item.panelId === top.id)).toEqual([])

    const lower = Array.from({ length: 20 }, (_, index) => shelf({ id: `lower-${index}`, width: 460, height: 340 }))
      .find(panel => detectPreviewFurnishings([panel]).length > 0)!
    expect(lower).toBeDefined()
    const upper = shelf({ id: 'upper', width: 460, height: 340, position: [0, 950, 0], trofastInserts: [
      { id: 'box', itemId: 'plastic-medium', colorId: 'white', x: 230, y: 170, face: 1 },
    ] })
    expect(detectPreviewFurnishings([lower, upper]).filter(item => item.panelId === lower.id)).toEqual([])
  })

  it('styles the starter shelf without mistaking its middle shelf for a bench or stacking books on its cap', () => {
    const panels = starter('shelf').map((panel, index) => ({ ...panel, id: `starter-shelf-${index}` }))
    const props = detectPreviewFurnishings(panels)
    expect(props.length).toBeGreaterThan(0)
    expect(props.some(prop => prop.kind.startsWith('seated-person'))).toBe(false)
    const top = panels.find(panel => panel.name === 'Top shelf')!
    expect(props.some(prop => prop.panelId === top.id && prop.kind === 'books')).toBe(false)
  })

  it('furnishes the actual starter desk with a computer, lamp and seated person on a chair', () => {
    const props = detectPreviewFurnishings(starter('desk'))
    expect(props.map(prop => prop.kind)).toEqual(['computer', 'table-lamp', 'seated-person-chair'])
    expect(props.find(prop => prop.kind === 'seated-person-chair')?.seatHeight).toBe(0.46)
  })

  it('links the desk worker to their machine with keyboard, pointer and screen in the sitter frame', () => {
    const check = (panels: Panel[], seed = 0) => {
      const props = detectPreviewFurnishings(panels, { seed })
      const person = props.find(prop => prop.kind === 'seated-person-chair')!
      const machine = props.find(prop => prop.kind === 'computer' || prop.kind === 'laptop')!
      expect(person.pose).toBe('working')
      expect(person.workSeed).toBeTypeOf('number')
      expect(machine.workSeed).toBe(person.workSeed)
      const station = person.workstation!
      expect(station.kind).toBe(machine.kind)
      // In front of the sitter, above the seat and at desk height, with the screen beyond the keyboard.
      expect(station.keyboard[2]).toBeGreaterThan(0.3)
      expect(station.keyboard[2]).toBeLessThan(0.65)
      expect(station.keyboard[1]).toBeGreaterThan(0.25)
      expect(station.screen[2]).toBeGreaterThan(station.keyboard[2])
      expect(station.screen[1]).toBeGreaterThan(station.keyboard[1])
      // A mouse lies to the sitter's right, which is -X when facing +Z.
      if (station.kind === 'computer') expect(station.pointer[0]).toBeLessThan(station.keyboard[0])
      return station
    }
    const station = check(starter('desk'))
    const turned = check(transform(starter('desk'), 0.63, [1800, 0, 2300]))
    turned.keyboard.forEach((value, axis) => expect(value).toBeCloseTo(station.keyboard[axis], 6))
    // Panel ids feed the shuffle, so search and check the same desk.
    const desk = starter('desk')
    const laptopSeed = Array.from({ length: 40 }, (_, index) => index + 1)
      .find(seed => detectPreviewFurnishings(desk, { seed }).some(prop => prop.kind === 'laptop'))!
    expect(check(desk, laptopSeed).kind).toBe('laptop')
  })

  it('treats symmetric inset desk legs equally when choosing the front', () => {
    const panels = [
      createPanel({ width: 1400, height: 700, position: [0, 741, 0], rotation: [-Math.PI / 2, 0, 0] }),
      ...[-620, 620].map(x => createPanel({ width: 700, height: 732, position: [x, 366, 0], rotation: [0, Math.PI / 2, 0] })),
    ]
    const props = detectPreviewFurnishings(panels)
    expect(props.some(prop => prop.kind === 'computer')).toBe(true)
    expect(props.some(prop => prop.kind === 'seated-person-chair')).toBe(true)
    expect(Math.cos(props.find(prop => prop.kind === 'computer')!.rotation)).toBeCloseTo(1, 8)
  })

  it('recognises the gallery bench by its geometry, including its front and back supports', () => {
    const panels = resolvePanels(createExampleProject('bench')).map(panel => ({ ...panel, name: 'Untitled' }))
    const props = detectPreviewFurnishings(panels)
    expect(props.some(prop => prop.kind === 'seated-person')).toBe(true)
    expect(props.some(prop => prop.kind === 'seated-person-chair')).toBe(false)
  })

  it('grounds the feet of both bench and chair occupants at the room floor', () => {
    const bench = resolvePanels(createExampleProject('bench'))
    const people = [...detectPreviewFurnishings(starter('desk')), ...detectPreviewFurnishings(bench)]
      .filter(prop => prop.kind.startsWith('seated-person'))
    expect(people).toHaveLength(2)
    for (const person of people) expect(person.position[1] - person.seatHeight!).toBeCloseTo(-0.012, 10)
  })

  it('ignores empty, hidden, vertical, tilted, oversized and unsupported desk surfaces', () => {
    expect(detectPreviewFurnishings([])).toEqual([])
    for (const panel of [shelf({ visible: false }), shelf({ rotation: [0, 0, 0] }),
      shelf({ rotation: [-Math.PI / 2 + 0.05, 0, 0] }), shelf({ width: 5000 }), shelf({ width: 1400, height: 700 })]) {
      expect(detectPreviewFurnishings([panel])).toEqual([])
    }
  })

  it('leaves perforations and custom outlines undecorated', () => {
    expect(detectPreviewFurnishings([shelf({ pattern: 'pegboard' })])).toEqual([])
    expect(detectPreviewFurnishings([shelf({ customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] })])).toEqual([])
  })

  it('allows centred props on boards with a small corner radius', () => {
    const square = detectPreviewFurnishings([shelf()])
    for (const cornerRadius of [1, 5, 11]) {
      expect(detectPreviewFurnishings([shelf({ cornerRadius })])).toEqual(square)
    }
  })

  it('keeps props inside heavily rounded corners instead of using the rectangular bounds', () => {
    const panels = starter('desk').map(panel => ({ ...panel, cornerRadius: 300 }))
    const props = detectPreviewFurnishings(panels)
    expect(props.some(prop => prop.kind === 'computer')).toBe(true)
    expect(props.some(prop => prop.kind === 'table-lamp')).toBe(false)
    const computer = props.find(prop => prop.kind === 'computer')!
    // The 62 × 50 cm computer footprint fits the 30 cm corner arcs.
    for (const x of [-0.31, 0.31]) for (const z of [-0.25, 0.25]) {
      const dx = Math.max(0, Math.abs(computer.position[0] + x) - 0.3)
      const dz = Math.abs(computer.position[2] + z)
      expect(Math.hypot(dx, dz)).toBeLessThan(0.3)
    }
  })

  it('leaves a compartment empty when no book stack or decoration clears its ceiling', () => {
    const panels = [shelf(), shelf({ id: 'ceiling', position: [0, 850, 0] })]
    expect(detectPreviewFurnishings(panels).some(prop => prop.panelId === 'surface')).toBe(false)
  })

  it('uses a single decoration on a shallow ledge with stable unique placement IDs', () => {
    // This shallow ledge cannot hold even a flat book stack, but fits a vase.
    const panels = [shelf({ height: 260 }), shelf({ id: 'ceiling', height: 260, position: [0, 990, 0] })]
    const props = detectPreviewFurnishings(panels)
    const lower = props.filter(prop => prop.panelId === 'surface')
    expect(lower.map(prop => prop.kind)).toEqual(['vase'])
    expect(new Set(props.map(prop => prop.id)).size).toBe(props.length)
    expect(detectPreviewFurnishings([...panels].reverse())).toEqual(props)
  })

  it('rejects a computer when an upright occupies its footprint', () => {
    const panels = starter('desk')
    panels.push(createPanel({ id: 'obstruction', width: 600, height: 600, position: [70, 1000, 10] }))
    const props = detectPreviewFurnishings(panels)
    expect(props.some(prop => prop.kind === 'computer')).toBe(false)
    expect(props.some(prop => prop.kind === 'seated-person-chair')).toBe(false)
    expect(props.some(prop => prop.kind === 'table-lamp')).toBe(true)
  })

  it('omits a chair and person if another panel blocks the seating area', () => {
    const panels = starter('desk')
    panels.push(createPanel({ id: 'seat-obstruction', width: 600, height: 700, position: [70, 350, 650] }))
    const props = detectPreviewFurnishings(panels)
    expect(props.some(prop => prop.kind === 'computer')).toBe(true)
    expect(props.some(prop => prop.kind === 'seated-person-chair')).toBe(false)
  })

  it('uses the other long edge when a panel blocks the front of a bench', () => {
    const panels = resolvePanels(createExampleProject('bench'))
    const original = detectPreviewFurnishings(panels).find(prop => prop.kind === 'seated-person')!
    expect(original).toBeDefined()
    panels.push(createPanel({ id: 'leg-obstruction', width: 900, height: 350,
      position: [original.position[0] * 1000, 175, original.position[2] * 1000 + 400] }))
    const seated = detectPreviewFurnishings(panels).find(prop => prop.kind === 'seated-person')!
    expect(seated).toBeDefined()
    expect(Math.cos(seated.rotation - original.rotation)).toBeCloseTo(-1, 8)
    const feet = new Vector3(0, -seated.seatHeight!, 0.42).applyAxisAngle(new Vector3(0, 1, 0), seated.rotation)
      .add(new Vector3(...seated.position))
    expect(feet.z).toBeLessThan(original.position[2])
  })

  it('follows horizontal translation and arbitrary yaw while retaining real object sizes', () => {
    const panels = starter('desk'), yaw = 0.63, shift: Vec3 = [1800, 0, 2300]
    const before = detectPreviewFurnishings(panels)
    const after = detectPreviewFurnishings(transform(panels, yaw, shift))
    expect(after.map(prop => prop.kind)).toEqual(before.map(prop => prop.kind))
    for (const prop of before) {
      const moved = after.find(item => item.id === prop.id)!
      const expected = new Vector3(...prop.position).applyAxisAngle(new Vector3(0, 1, 0), yaw).add(new Vector3(...shift).multiplyScalar(0.001))
      moved.position.forEach((value, axis) => expect(value).toBeCloseTo(expected.getComponent(axis), 8))
      expect(moved.rotation).toBeCloseTo(prop.rotation + yaw, 8)
    }
  })

  it('handles horizontal boards whose width and height axes are swapped', () => {
    const original = shelf()
    const rotation = new Quaternion().setFromEuler(new Euler(...original.rotation)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2))
    const euler = new Euler().setFromQuaternion(rotation)
    const swapped = { ...original, width: original.height, height: original.width, rotation: [euler.x, euler.y, euler.z] as Vec3 }
    const before = detectPreviewFurnishings([original]), after = detectPreviewFurnishings([swapped])
    expect(after.map(item => item.kind)).toEqual(before.map(item => item.kind))
    after.forEach((item, index) => item.position.forEach((value, axis) => expect(value).toBeCloseTo(before[index].position[axis], 8)))
  })

  it('is deterministic, independent of panel order and does not modify project panels', () => {
    const panels = starter('shelf'), saved = structuredClone(panels)
    expect(detectPreviewFurnishings(panels)).toEqual(detectPreviewFurnishings([...panels].reverse()))
    expect(panels).toEqual(saved)
  })

  it('limits render work on a large project and does not duplicate a furnishing id', () => {
    const panels = Array.from({ length: 200 }, (_, index) => shelf({ id: `shelf-${index}`, position: [index * 2000, 700, 0] }))
    const props = detectPreviewFurnishings(panels)
    expect(props).toHaveLength(MAX_PREVIEW_FURNISHINGS)
    expect(new Set(props.map(prop => prop.id)).size).toBe(props.length)
  })

  it('limits people to two across multiple desks', () => {
    const panels = [0, 1, 2, 3].flatMap(index => transform(starter('desk'), 0, [index * 2500, 0, 0]))
    expect(detectPreviewFurnishings(panels).filter(prop => prop.kind.startsWith('seated-person'))).toHaveLength(2)
  })
})
