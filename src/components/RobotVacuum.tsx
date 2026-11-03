import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'
import type { Panel } from '@/lib/types'
import { DreameDockModel, DreameVacuumModel } from './RobotVacuumModel'
import { rejoinVacuumRoute, type VacuumPlan, type VacuumPoint } from './robot-vacuum-navigation'
import { advanceVacuum, createVacuumMotion, type VacuumMotion } from './robot-vacuum-motion'

const DEPARTURE_DELAY = 10_000

export function RobotVacuum({ plan, projectPanels }: { plan: VacuumPlan; projectPanels: Panel[] }) {
  const robot = useRef<Group>(null)
  const motion = useRef<VacuumMotion | null>(null)
  const route = useRef<VacuumPoint[] | null>(null)
  const runtime = useRef({ active: false, lastTime: 0 })
  const invalidate = useThree(state => state.invalidate)
  // Furnishings update the route; only a changed project starts a new session.
  const data = useMemo(() => ({ phase: 'docked', elapsed: 0, plan: null as VacuumPlan | null }), [projectPanels])
  const session = useRef<typeof data | null>(null)

  useLayoutEffect(() => {
    if (session.current !== data || !motion.current) {
      session.current = data
      motion.current = createVacuumMotion(plan.start)
      route.current = plan.waypoints
      robot.current?.position.set(plan.start.x, plan.floorY, plan.start.z)
      robot.current?.rotation.set(0, 0, 0)
      data.phase = 'docked'
      data.elapsed = 0
    } else {
      route.current = rejoinVacuumRoute(plan, motion.current, true)
      motion.current.waypoint = 0
      motion.current.speed = 0
    }
    data.plan = plan
    invalidate()
  }, [plan, data, invalidate])

  useEffect(() => {
    let remaining = DEPARTURE_DELAY
    let waitStarted: number | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      clearTimeout(timer)
      if (waitStarted !== null) {
        remaining = Math.max(0, remaining - (performance.now() - waitStarted))
        data.elapsed = (DEPARTURE_DELAY - remaining) / 1000
        waitStarted = null
      }
      runtime.current.active = false
      runtime.current.lastTime = 0
    }
    const resume = () => {
      if (document.hidden) return
      runtime.current.active = true
      runtime.current.lastTime = 0
      if (remaining > 0) {
        waitStarted = performance.now()
        timer = setTimeout(() => {
          waitStarted = null
          remaining = 0
          data.elapsed = DEPARTURE_DELAY / 1000
          data.phase = 'cleaning'
          invalidate()
        }, remaining)
      } else invalidate()
    }
    const visibility = () => { stop(); resume() }
    document.addEventListener('visibilitychange', visibility)
    resume()
    return () => {
      clearTimeout(timer)
      runtime.current.active = false
      runtime.current.lastTime = 0
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [data, invalidate])

  useFrame(() => {
    const state = runtime.current
    if (!state.active || document.hidden || data.phase !== 'cleaning' || !motion.current || !robot.current || !route.current) return
    const now = performance.now()
    const dt = state.lastTime ? Math.min((now - state.lastTime) / 1000, 0.1) : 0
    state.lastTime = now
    advanceVacuum(motion.current, route.current, dt)
    robot.current.position.set(motion.current.x, plan.floorY, motion.current.z)
    robot.current.rotation.y = motion.current.heading
    data.elapsed += dt
    invalidate()
  })

  return <>
    <group name="Dreame X50 Ultra Complete dock" position={[plan.dock.x, plan.floorY, plan.dock.z]}><DreameDockModel /></group>
    <group ref={robot} name="Dreame X50 Ultra Complete" userData={data}><DreameVacuumModel /></group>
  </>
}
