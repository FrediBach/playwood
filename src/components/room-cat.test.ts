import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { createPanel } from '@/lib/model'
import { createVacuumPlan, isVacuumSegmentClear, type VacuumPoint } from './robot-vacuum-navigation'
import { getRoomRug } from './room-layout'
import { CAT_PATH_CLEARANCE, CAT_SOFA_AFTER, CAT_WAKE_DISTANCE, catPose, createCat, createCatSetting, isCatRestClear, reconcileCat, stepCat, type CatSetting, type CatState } from './room-cat'

const bounds = new Box3(new Vector3(-0.7, 0, -0.35), new Vector3(0.7, 1.2, 0.35))

function setup(panels = [] as ReturnType<typeof createPanel>[]) {
  const plan = createVacuumPlan(bounds, panels)!
  const rug = getRoomRug(bounds)
  return { plan, rug, setting: createCatSetting(plan, bounds, rug)! }
}

/** Runs until the cat rests again, checking every walked step against furniture. */
function runUntilResting(cat: CatState, setting: CatSetting, vacuum: VacuumPoint, limit = 30) {
  let previous = { x: cat.x, z: cat.z }
  for (let time = 0; time < limit; time += 1 / 60) {
    stepCat(cat, setting, vacuum, 1 / 60)
    if (!cat.onSofa && cat.phase !== 'leaping') {
      expect(isVacuumSegmentClear(previous, cat, setting.obstacles, setting.room, CAT_PATH_CLEARANCE * 0.99)).toBe(true)
    }
    previous = { x: cat.x, z: cat.z }
    if (cat.phase === 'sleeping' || cat.phase === 'perched') return
  }
  throw new Error(`Cat still ${cat.phase} after ${limit} s`)
}

describe('room cat', () => {
  it('starts asleep at the front-right corner of the rug, clear of furniture', () => {
    const { setting, rug } = setup()
    const cat = createCat(setting)
    expect(cat.phase).toBe('sleeping')
    expect(cat.x).toBeGreaterThan(rug.x)
    expect(cat.z).toBeGreaterThan(rug.z)
    expect(cat.x).toBeLessThan(rug.x + rug.width / 2)
    expect(cat.z).toBeLessThan(rug.z + rug.depth / 2)
    expect(isCatRestClear(setting, cat)).toBe(true)
    expect(setting.sofa).not.toBeNull()
  })

  it('rests without requesting frames while the vacuum is far away', () => {
    const { setting, plan } = setup()
    const cat = createCat(setting)
    expect(stepCat(cat, setting, plan.start, 0.1)).toBe(false)
    expect(cat.phase).toBe('sleeping')
    expect(catPose(cat, plan.start).eyes).toBe(0)
  })

  it('moves away from an approaching vacuum three times, then retreats to the lounge chair', () => {
    const { setting } = setup()
    const cat = createCat(setting)
    const spots: VacuumPoint[] = [{ x: cat.x, z: cat.z }]
    for (let disturbance = 1; disturbance <= CAT_SOFA_AFTER; disturbance++) {
      // Approach from the side facing the room's open floor.
      const vacuum = { x: cat.x - 0.4, z: cat.z + CAT_WAKE_DISTANCE * 0.6 }
      expect(stepCat(cat, setting, vacuum, 1 / 60)).toBe(true)
      expect(cat.phase).toBe('waking')
      expect(cat.displaced).toBe(disturbance)
      runUntilResting(cat, setting, vacuum)
      if (disturbance < CAT_SOFA_AFTER) {
        expect(cat.phase).toBe('sleeping')
        expect(Math.hypot(cat.x - vacuum.x, cat.z - vacuum.z)).toBeGreaterThan(1.25)
        expect(isCatRestClear(setting, cat)).toBe(true)
        for (const spot of spots) expect(Math.hypot(cat.x - spot.x, cat.z - spot.z)).toBeGreaterThan(0.7)
        spots.push({ x: cat.x, z: cat.z })
      }
    }
    expect(cat.phase).toBe('perched')
    expect(cat.onSofa).toBe(true)
    expect(cat.y).toBeCloseTo(setting.sofa!.seatY)
    expect(Math.hypot(cat.x - setting.sofa!.seat.x, cat.z - setting.sofa!.seat.z)).toBeLessThan(0.01)

    // Up on the chair the cat only watches; nothing displaces it any more.
    const below = { x: setting.sofa!.approach.x, z: setting.sofa!.approach.z }
    expect(stepCat(cat, setting, below, 0.1)).toBe(false)
    expect(cat.phase).toBe('perched')
    expect(catPose(cat, below).eyes).toBeGreaterThan(0)
  })

  it('is interrupted while lying down and still counts the disturbance', () => {
    const { setting } = setup()
    const cat = createCat(setting)
    const vacuum = { x: cat.x - 0.4, z: cat.z + 0.5 }
    stepCat(cat, setting, vacuum, 1 / 60)
    for (let index = 0; index < 600 && cat.phase !== 'settling'; index++) stepCat(cat, setting, vacuum, 1 / 60)
    expect(cat.phase).toBe('settling')
    for (let index = 0; index < 30; index++) stepCat(cat, setting, null, 1 / 60)
    stepCat(cat, setting, { x: cat.x + 0.3, z: cat.z }, 1 / 60)
    expect(cat.displaced).toBe(2)
    expect(cat.phase).toBe('walking')
  })

  it('stays put when no calmer spot is reachable and ignores the vacuum until it leaves', () => {
    const { setting } = setup()
    const cramped: CatSetting = { ...setting, area: { minX: setting.home.x - 0.05, maxX: setting.home.x + 0.05, minZ: setting.home.z - 0.05, maxZ: setting.home.z + 0.05 } }
    const cat = createCat(cramped)
    const vacuum = { x: cat.x, z: cat.z + 0.6 }
    stepCat(cat, cramped, vacuum, 1 / 60)
    runUntilResting(cat, cramped, vacuum)
    expect(Math.hypot(cat.x - setting.home.x, cat.z - setting.home.z)).toBeLessThan(0.001)
    expect(stepCat(cat, cramped, vacuum, 0.1)).toBe(false)
    expect(cat.unbothered).toBe(true)
    stepCat(cat, cramped, { x: cat.x, z: cat.z + 3 }, 0.1)
    expect(cat.unbothered).toBe(false)
  })

  it('treats low panels as obstacles even where the vacuum could pass beneath them', () => {
    // A shelf 20 cm above the floor clears the vacuum but not a cat.
    const shelf = createPanel({ id: 'low-shelf', width: 600, height: 400, position: [1100, 200, 900], rotation: [-Math.PI / 2, 0, 0] })
    const { plan } = setup([shelf])
    expect(plan.obstacles.some(item => item.id === 'panel:low-shelf')).toBe(false)
    expect(plan.petObstacles.some(item => item.id === 'panel:low-shelf')).toBe(true)
    expect(plan.petObstacles.some(item => item.id === 'dock')).toBe(true)
  })

  it('wakes without counting a disturbance when furnishings now cover its spot', () => {
    const { setting } = setup()
    const cat = createCat(setting)
    const covered: CatSetting = { ...setting, obstacles: [...setting.obstacles, { id: 'box', minX: cat.x - 0.1, maxX: cat.x + 0.1, minZ: cat.z - 0.1, maxZ: cat.z + 0.1 }] }
    reconcileCat(cat, covered)
    expect(cat.phase).toBe('waking')
    expect(cat.displaced).toBe(0)
    for (let index = 0; index < 1800 && cat.phase !== 'sleeping'; index++) stepCat(cat, covered, null, 1 / 60)
    expect(cat.phase).toBe('sleeping')
    expect(isCatRestClear(covered, cat)).toBe(true)
  })
})
