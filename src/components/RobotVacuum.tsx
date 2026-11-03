import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'
import type { Panel } from '@/lib/types'
import { useVacuumControl, type VacuumPlayback } from '@/hooks/use-vacuum-control'
import { DreameDockModel, DreameVacuumModel } from './RobotVacuumModel'
import { rejoinVacuumRoute, type VacuumPlan, type VacuumPoint } from './robot-vacuum-navigation'
import { advanceVacuum, createVacuumMotion, driveVacuum, type VacuumMotion } from './robot-vacuum-motion'
import { recordVacuumTrail, recoverVacuumRoute } from './robot-vacuum-recovery'

export function RobotVacuum({ plan, projectPanels, controlsEnabled }: { plan: VacuumPlan; projectPanels: Panel[]; controlsEnabled: boolean }) {
  const robot = useRef<Group>(null)
  const motion = useRef<VacuumMotion | null>(null)
  const route = useRef<VacuumPoint[] | null>(null)
  const loopStart = useRef(1)
  const trail = useRef<VacuumPoint[]>([])
  const invalidate = useThree(state => state.invalidate)
  // Furnishings update the route; only a changed project starts a new session.
  const data = useMemo<VacuumPlayback & { plan: VacuumPlan | null }>(() => ({ phase: 'docked', elapsed: 0, plan: null }), [projectPanels])
  const session = useRef<typeof data | null>(null)
  const controls = useVacuumControl(data, controlsEnabled, invalidate, () => {
    if (!motion.current) return
    const recovered = recoverVacuumRoute(plan, motion.current, trail.current)
    route.current = recovered?.waypoints ?? null
    loopStart.current = recovered?.loopStart ?? 1
    motion.current.waypoint = 0
    motion.current.speed = 0
  }, () => {
    if (!motion.current) return
    // Retaking control before a return trail finishes must retain the way out.
    if (rejoinVacuumRoute(plan, motion.current, true)) trail.current = []
    recordVacuumTrail(trail.current, motion.current, plan)
    motion.current.speed = 0
  })

  useLayoutEffect(() => {
    if (session.current !== data || !motion.current) {
      session.current = data
      motion.current = createVacuumMotion(plan.start)
      route.current = plan.waypoints
      loopStart.current = 1
      trail.current = []
      robot.current?.position.set(plan.start.x, plan.floorY, plan.start.z)
      robot.current?.rotation.set(0, 0, 0)
      data.phase = 'docked'
      data.elapsed = 0
    } else {
      const recovered = recoverVacuumRoute(plan, motion.current, trail.current)
      route.current = recovered?.waypoints ?? null
      loopStart.current = recovered?.loopStart ?? 1
      motion.current.waypoint = 0
      motion.current.speed = 0
    }
    data.plan = plan
    invalidate()
  }, [plan, data, invalidate])

  useFrame(() => {
    const state = controls.current
    if (!state.active || document.hidden || !motion.current || !robot.current) return
    const manual = data.phase === 'manual'
    if (manual ? (!controlsEnabled || (!state.forward && !state.turn)) : (data.phase !== 'cleaning' || !route.current)) return
    const now = performance.now()
    const dt = state.lastTime ? Math.min((now - state.lastTime) / 1000, 0.1) : 0
    state.lastTime = now
    const { x, z, heading } = motion.current
    if (manual) driveVacuum(motion.current, state, plan, dt)
    else advanceVacuum(motion.current, route.current!, dt, loopStart.current)
    if (!manual && motion.current.waypoint >= loopStart.current) trail.current = []
    else if (manual || trail.current.length) recordVacuumTrail(trail.current, motion.current, plan)
    robot.current.position.set(motion.current.x, plan.floorY, motion.current.z)
    robot.current.rotation.y = motion.current.heading
    data.elapsed += dt
    // Sleeping at a collision or between key presses does not need a frame loop.
    if (!manual || dt === 0 || motion.current.x !== x || motion.current.z !== z || motion.current.heading !== heading) invalidate()
  })

  return <>
    <group name="Dreame X50 Ultra Complete dock" position={[plan.dock.x, plan.floorY, plan.dock.z]}><DreameDockModel /></group>
    <group ref={robot} name="Dreame X50 Ultra Complete" userData={data}><DreameVacuumModel /></group>
  </>
}
