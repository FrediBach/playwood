import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { createPanel } from '@/lib/model'
import { createVacuumPlan, isVacuumSegmentClear, rejoinVacuumRoute, VACUUM_CLEARANCE, VACUUM_RADIUS, type VacuumPlan } from './robot-vacuum-navigation'
import { getRoomLayout, getRoomPiece, roomPieceFootprint } from './room-layout'

const bounds = new Box3(new Vector3(-0.7, 0, -0.35), new Vector3(0.7, 1.2, 0.35))

function expectSafeRoute(plan: VacuumPlan) {
  expect(plan.waypoints.length).toBeGreaterThan(4)
  expect(plan.waypoints.at(-1)).toEqual(plan.waypoints[0])
  expect(isVacuumSegmentClear(plan.start, plan.waypoints[0], plan.obstacles.filter(item => item.id !== 'dock'), plan.room)).toBe(true)
  for (let index = 1; index < plan.waypoints.length; index++) {
    expect(isVacuumSegmentClear(plan.waypoints[index - 1], plan.waypoints[index], plan.obstacles, plan.room)).toBe(true)
  }
  // Sample the actual circular body independently of the expanded-box route test.
  // This also catches a unit mismatch between model sizes and navigation margins.
  for (let index = 1; index < plan.waypoints.length; index++) {
    const a = plan.waypoints[index - 1], b = plan.waypoints[index]
    const samples = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.08))
    for (let sample = 0; sample <= samples; sample++) {
      const x = a.x + (b.x - a.x) * sample / samples, z = a.z + (b.z - a.z) * sample / samples
      for (const obstacle of plan.obstacles) {
        const dx = Math.max(obstacle.minX - x, 0, x - obstacle.maxX)
        const dz = Math.max(obstacle.minZ - z, 0, z - obstacle.maxZ)
        if (Math.hypot(dx, dz) <= VACUUM_RADIUS) throw new Error(`Robot intersects ${obstacle.id} on route segment ${index}`)
      }
    }
  }
}

describe('robot vacuum navigation', () => {
  it('leaves the dock in a straight line and covers the connected room deterministically', () => {
    const plan = createVacuumPlan(bounds, [])!
    expect(plan).not.toBeNull()
    expect(plan.start.x).toBe(plan.dock.x)
    expect(plan.waypoints[0].x).toBe(plan.dock.x)
    expect(plan.waypoints[0].z - plan.start.z).toBeCloseTo(0.6)
    expect(plan.obstacles.map(item => item.id)).toEqual(expect.arrayContaining(['room:chair', 'room:lamp', 'room:table', 'room:plant', 'dock']))
    expect(plan.waypoints.some(point => point.z > 10)).toBe(true)
    expect(plan.waypoints.some(point => point.x < -2)).toBe(true)
    expect(plan.waypoints.some(point => point.x > 4)).toBe(true)
    expectSafeRoute(plan)
    expect(createVacuumPlan(bounds, [])).toEqual(plan)
  })

  it('steers around each room style\'s own piece of furniture, only when the room is furnished', () => {
    expect(createVacuumPlan(bounds, [])!.obstacles.map(item => item.id)).not.toEqual(expect.arrayContaining([expect.stringMatching(/sofa|stove|whiteboard|rocking-horse/)]))
    for (const theme of ['living', 'kitchen', 'office', 'kids'] as const) {
      const style = { seed: 3, theme, furnished: true }
      const piece = getRoomPiece(bounds, style)!
      const plan = createVacuumPlan(bounds, [], [], style)!
      expect(plan.obstacles).toContainEqual({ id: `room:${piece.kind}`, ...roomPieceFootprint(piece) })
      expect(plan.petObstacles.map(item => item.id)).toContain(`room:${piece.kind}`)
      // The piece leaves the room's built-in furniture, the dock and the creation clear.
      const footprint = roomPieceFootprint(piece)
      for (const other of plan.obstacles.filter(item => item.id !== `room:${piece.kind}`)) {
        expect(other.minX >= footprint.maxX || other.maxX <= footprint.minX || other.minZ >= footprint.maxZ || other.maxZ <= footprint.minZ, other.id).toBe(true)
      }
      expect(footprint.maxZ <= bounds.min.z || footprint.minZ >= bounds.max.z || footprint.maxX <= bounds.min.x || footprint.minX >= bounds.max.x).toBe(true)
      expectSafeRoute(plan)
    }
  })

  it('uses resolved translated and rotated panel footprints without mutating them', () => {
    const panels = [createPanel({ id: 'wall', width: 1400, height: 900, thickness: 20, position: [750, 450, 1600], rotation: [0, Math.PI / 4, 0] })]
    const original = JSON.stringify(panels)
    const plan = createVacuumPlan(bounds, panels)!
    const wall = plan.obstacles.find(item => item.id === 'panel:wall')!
    expect((wall.minX + wall.maxX) / 2).toBeCloseTo(0.75)
    expect((wall.minZ + wall.maxZ) / 2).toBeCloseTo(1.6)
    expect(wall.maxX - wall.minX).toBeCloseTo((1.4 + 0.02) / Math.sqrt(2))
    expectSafeRoute(plan)
    expect(JSON.stringify(panels)).toBe(original)
  })

  it('passes under elevated surfaces but avoids floor supports and low TROFAST boxes', () => {
    const top = createPanel({ id: 'top', width: 1400, height: 700, position: [0, 750, 0], rotation: [-Math.PI / 2, 0, 0] })
    const leg = createPanel({ id: 'leg', width: 700, height: 740, position: [650, 370, 0], rotation: [0, Math.PI / 2, 0] })
    const storage = createPanel({ id: 'storage', width: 1000, height: 600, position: [0, 420, 2400], rotation: [-Math.PI / 2, 0, 0],
      trofastInserts: [{ id: 'box', itemId: 'plastic-deep', colorId: 'white', x: 500, y: 300, face: 1 }] })
    const hidden = createPanel({ id: 'hidden', width: 2000, height: 2000, position: [0, 0, 0], visible: false })
    const plan = createVacuumPlan(bounds, [top, leg, storage, hidden])!
    expect(plan.obstacles.map(item => item.id)).toEqual(expect.arrayContaining(['panel:leg', 'insert:storage:box']))
    expect(plan.obstacles.some(item => ['panel:top', 'panel:storage', 'panel:hidden'].includes(item.id))).toBe(false)
    expect(isVacuumSegmentClear({ x: 0, z: -0.2 }, { x: 0, z: 0.2 }, plan.obstacles, plan.room)).toBe(true)
    expect(isVacuumSegmentClear({ x: 0, z: 2.2 }, { x: 0, z: 2.6 }, plan.obstacles, plan.room)).toBe(false)
    expectSafeRoute(plan)
  })

  it('includes seated people, chairs and low accessories from Auto furnish', () => {
    const plan = createVacuumPlan(bounds, [], [
      { id: 'person', panelId: 'desk', kind: 'seated-person-chair', position: [0, 0.45, 1], rotation: Math.PI / 2, seatHeight: 0.45 },
      { id: 'vase', panelId: 'shelf', kind: 'vase', position: [0, 0.05, 2], rotation: 0 },
      { id: 'lamp', panelId: 'desk', kind: 'table-lamp', position: [0, 0.8, 0], rotation: 0 },
    ])!
    const feet = plan.obstacles.find(item => item.id === 'furnishing:person:feet')!
    expect((feet.minX + feet.maxX) / 2).toBeCloseTo(0.385)
    expect(plan.obstacles.some(item => item.id === 'furnishing:person:chair')).toBe(true)
    expect(plan.obstacles.some(item => item.id === 'furnishing:vase')).toBe(true)
    expect(plan.obstacles.some(item => item.id === 'furnishing:lamp')).toBe(false)
    expectSafeRoute(plan)
  })

  it('moves the dock to a free wall position when an elevated panel occupies the station height', () => {
    const empty = createVacuumPlan(bounds, [])!
    const obstruction = createPanel({ id: 'over-dock', width: 600, height: 800, position: [empty.dock.x * 1000, 350, empty.dock.z * 1000], rotation: [-Math.PI / 2, 0, 0] })
    const plan = createVacuumPlan(bounds, [obstruction])!
    expect(plan).not.toBeNull()
    expect(Math.abs(plan.dock.x - empty.dock.x)).toBeGreaterThan(0.47)
    expect(plan.obstacles.some(item => item.id === 'panel:over-dock')).toBe(false)
    expectSafeRoute(plan)
  })

  it('omits the vacuum if the entire dock wall is occupied', () => {
    const room = getRoomLayout(bounds)
    const obstruction = createPanel({ width: (room.width + 1) * 1000, height: 1400, position: [(room.leftX + room.rightX) * 500, 350, (room.backZ + 0.4) * 1000], rotation: [-Math.PI / 2, 0, 0] })
    expect(createVacuumPlan(bounds, [obstruction])).toBeNull()
  })

  it('does not cross thin partitions or a doorway narrower than its body', () => {
    const room = getRoomLayout(bounds)
    const opening = 0.3
    const leftWidth = -opening / 2 - room.leftX, rightWidth = room.rightX - opening / 2
    const panels = [
      createPanel({ id: 'left', width: leftWidth * 1000, height: 500, thickness: 10, position: [(room.leftX - opening / 2) * 500, 250, 2000] }),
      createPanel({ id: 'right', width: rightWidth * 1000, height: 500, thickness: 10, position: [(room.rightX + opening / 2) * 500, 250, 2000] }),
    ]
    const plan = createVacuumPlan(bounds, panels)!
    expect(Math.max(...plan.waypoints.map(point => point.z))).toBeLessThan(2 - VACUUM_CLEARANCE)
    expectSafeRoute(plan)
  })

  it('bounds navigation work for very large projects', () => {
    const large = new Box3(new Vector3(-50, 0, -30), new Vector3(50, 5, 30))
    const plan = createVacuumPlan(large, [])!
    expect(plan).not.toBeNull()
    expect(plan.waypoints.length).toBeLessThan(2 * 128 * 128 + 4)
    expect(plan.waypoints.every(point => Number.isFinite(point.x) && Number.isFinite(point.z))).toBe(true)
    for (let index = 1; index < plan.waypoints.length; index++) {
      expect(isVacuumSegmentClear(plan.waypoints[index - 1], plan.waypoints[index], plan.obstacles, plan.room)).toBe(true)
    }
  })

  it('tests complete segments rather than only their endpoints', () => {
    const room = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 }
    const obstacle = { id: 'thin-wall', minX: -1, maxX: 1, minZ: 0.005, maxZ: 0.015 }
    expect(isVacuumSegmentClear({ x: 0, z: -0.5 }, { x: 0, z: 0.5 }, [obstacle], room)).toBe(false)
    expect(isVacuumSegmentClear({ x: -1.3, z: -0.5 }, { x: -1.3, z: 0.5 }, [obstacle], room)).toBe(true)
    expect(isVacuumSegmentClear({ x: -1.9, z: 0 }, { x: -1.9, z: 1 }, [], room)).toBe(false)
  })
})

describe('rejoining a changed furnishing route', () => {
  const square = (): VacuumPlan => ({
    dock: { x: -4, z: -4 }, start: { x: -4, z: -3.85 }, floorY: -0.012,
    room: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, obstacles: [], petObstacles: [],
    waypoints: [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }, { x: -1, z: -1 }],
  })

  it('joins the nearest segment interior without resetting the pose or losing any coverage', () => {
    const plan = square(), position = { x: 0, z: -0.6 }
    const original = JSON.stringify(plan)
    const route = rejoinVacuumRoute(plan, position)!
    expect(route).toEqual([
      { x: 0, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }, { x: -1, z: -1 }, { x: 0, z: -1 },
    ])
    expect(position).toEqual({ x: 0, z: -0.6 })
    expect(JSON.stringify(plan)).toBe(original)
    expectSafeRoute({ ...plan, start: position, waypoints: route })
  })

  it('retains a closed sweep when already on a route corner', () => {
    const plan = square(), position = { x: 1, z: 1 }
    const route = rejoinVacuumRoute(plan, position)!
    expect(route[0]).toEqual(position)
    expect(route.at(-1)).toEqual(position)
    expect(route.slice(0, -1)).toHaveLength(4)
    expectSafeRoute({ ...plan, start: position, waypoints: route })
  })

  it('uses another visible segment when the closest join would cross a new object', () => {
    const plan = square()
    plan.obstacles.push({ id: 'chair', minX: -0.2, maxX: 0.2, minZ: -0.6, maxZ: -0.4 })
    const position = { x: 0, z: 0 }, route = rejoinVacuumRoute(plan, position)!
    expect(route[0]).toEqual({ x: 1, z: 0 })
    expectSafeRoute({ ...plan, start: position, waypoints: route })
  })

  it('pauses when new furniture occupies the current pose instead of teleporting out', () => {
    const plan = square(), position = { x: 0, z: 0 }
    plan.obstacles.push({ id: 'chair', minX: -0.3, maxX: 0.3, minZ: -0.3, maxZ: 0.3 })
    expect(rejoinVacuumRoute(plan, position)).toBeNull()
    expect(position).toEqual({ x: 0, z: 0 })
    plan.obstacles = []
    expect(rejoinVacuumRoute(plan, position)).not.toBeNull()
  })

  it('pauses in a disconnected floor area rather than crossing a partition', () => {
    const plan = square()
    plan.waypoints = plan.waypoints.map(point => ({ ...point, x: point.x + 4 }))
    plan.obstacles.push({ id: 'partition', minX: 1.2, maxX: 1.3, minZ: -8, maxZ: 8 })
    expect(rejoinVacuumRoute(plan, { x: 0, z: 0 })).toBeNull()
  })

  it('preserves a safe sweep after adding actual Auto furnish people and chairs', () => {
    const position = { x: 0, z: 1 }
    const plan = createVacuumPlan(bounds, [], [
      { id: 'person', panelId: 'desk', kind: 'seated-person-chair', position: [0, 0.45, 2], rotation: 0, seatHeight: 0.45 },
    ])!
    const route = rejoinVacuumRoute(plan, position)!
    expect(route).not.toBeNull()
    expect(Math.hypot(route[0].x - position.x, route[0].z - position.z)).toBeLessThan(0.3)
    expectSafeRoute({ ...plan, start: position, waypoints: route })
  })

  it('allows a waiting or partly undocked robot to finish only its original clear exit lane', () => {
    const plan = createVacuumPlan(bounds, [])!
    expect(rejoinVacuumRoute(plan, plan.start)).toBeNull()
    expect(rejoinVacuumRoute(plan, plan.start, true)).toEqual(plan.waypoints)
    const halfway = { x: plan.start.x, z: plan.start.z + 0.2 }
    expect(rejoinVacuumRoute(plan, halfway, true)).toEqual(plan.waypoints)
    expect(rejoinVacuumRoute(plan, { x: halfway.x + 0.05, z: halfway.z }, true)).toBeNull()
    const blocked = { ...plan, obstacles: [...plan.obstacles,
      { id: 'new-chair', minX: halfway.x - 0.1, maxX: halfway.x + 0.1, minZ: halfway.z + 0.15, maxZ: halfway.z + 0.25 }] }
    expect(rejoinVacuumRoute(blocked, halfway, true)).toBeNull()
  })
})
