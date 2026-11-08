import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Vector3 } from 'three'
import type { DesignConstraint, Vec3 } from '@/lib/types'

interface Props {
  id: string
  from: Vec3
  to: Vec3
  leaders?: [Vec3, Vec3][]
  kind: DesignConstraint['kind']
  color: string
  paused: boolean
  active: boolean
  onPointerEnter: () => void
  onPointerLeave: () => void
}
type Point = { x: number; y: number }
const segment = (a: Point, b: Point) => `M${a.x},${a.y}L${b.x},${b.y}`
interface LineInteraction {
  points: [Point, Point] | null
  hovered: boolean
  enter: () => void
  leave: () => void
}
const LineInteractionContext = createContext<Map<string, LineInteraction> | null>(null)

/** Canvas proximity keeps hover targets generous without blocking orbit, drag, or selection. */
export function ConstraintLineInteractions({ children }: { children: ReactNode }) {
  const canvas = useThree(state => state.gl.domElement)
  const entries = useMemo(() => new Map<string, LineInteraction>(), [])
  const pointer = useRef<Point | null>(null)
  const active = useRef<LineInteraction | null>(null)
  const update = useCallback(() => {
    let nearest: LineInteraction | null = null, distance = 7 ** 2
    if (pointer.current) for (const entry of entries.values()) {
      if (!entry.points) continue
      const [a, b] = entry.points, dx = b.x - a.x, dy = b.y - a.y
      const lengthSquared = dx * dx + dy * dy
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((pointer.current.x - a.x) * dx + (pointer.current.y - a.y) * dy) / lengthSquared)) : 0
      const candidate = (pointer.current.x - a.x - t * dx) ** 2 + (pointer.current.y - a.y - t * dy) ** 2
      if (candidate < distance || (candidate === distance && entry === active.current)) { nearest = entry; distance = candidate }
    }
    if (active.current === nearest) return
    if (active.current?.hovered) { active.current.hovered = false; active.current.leave() }
    active.current = nearest
    if (nearest) { nearest.hovered = true; nearest.enter() }
  }, [entries])
  useEffect(() => {
    const clear = () => { pointer.current = null; update() }
    const move = (event: PointerEvent) => {
      if (event.buttons || event.pointerType === 'touch') { clear(); return }
      const bounds = canvas.getBoundingClientRect()
      pointer.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
      update()
    }
    canvas.addEventListener('pointermove', move, { passive: true })
    canvas.addEventListener('pointerleave', clear)
    canvas.addEventListener('pointerdown', clear)
    window.addEventListener('blur', clear)
    return () => {
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', clear)
      canvas.removeEventListener('pointerdown', clear)
      window.removeEventListener('blur', clear)
      clear()
    }
  }, [canvas, update])
  // Projection runs first; stationary pointers also follow camera and viewport changes.
  useFrame(update)
  return <LineInteractionContext value={entries}>{children}</LineInteractionContext>
}

/** Measurements stay anchored in 3D; drafting marks keep a readable size on screen. */
export function ConstraintMeasurementLine({ id, from, to, leaders, kind, color, paused, active, onPointerEnter, onPointerLeave }: Props) {
  const invalidate = useThree(state => state.invalidate)
  const interactions = useContext(LineInteractionContext)
  const interaction = useMemo<LineInteraction>(() => ({ points: null, hovered: false, enter: () => {}, leave: () => {} }), [])
  const svg = useRef<SVGSVGElement | null>(null)
  const main = useRef<SVGPathElement>(null)
  const marks = useRef<SVGPathElement>(null)
  const halo = useRef<SVGPathElement>(null)
  const extensions = useRef<SVGPathElement>(null)
  const clip = useRef<SVGRectElement>(null)
  const clipId = useId()
  const point = useMemo(() => new Vector3(), [])
  const midpoint: Vec3 = from.map((coordinate, axis) => (coordinate + to[axis]) / 2) as Vec3
  const register = useCallback((element: SVGSVGElement | null) => {
    svg.current = element
    if (element) invalidate()
  }, [invalidate])
  useLayoutEffect(() => { interaction.enter = onPointerEnter; interaction.leave = onPointerLeave })
  useLayoutEffect(() => {
    interactions?.set(clipId, interaction)
    return () => {
      interactions?.delete(clipId)
      if (interaction.hovered) { interaction.hovered = false; interaction.leave() }
    }
  }, [interactions, clipId, interaction])

  useFrame(({ camera, size }) => {
    if (!svg.current || !main.current || !marks.current || !halo.current || !extensions.current || !clip.current) return
    camera.updateMatrixWorld()
    const project = (position: Vec3) => {
      point.set(...position).project(camera)
      return { x: (point.x + 1) * size.width / 2, y: (1 - point.y) * size.height / 2, z: point.z }
    }
    const origin = project(midpoint), start = project(from), end = project(to)
    // Hide near/far-plane crossings instead of drawing unstable projected segments.
    const visible = [origin, start, end].every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.z >= -1 && p.z <= 1)
    svg.current.style.visibility = visible ? 'visible' : 'hidden'
    interaction.points = visible ? [start, end] : null
    if (!visible) return
    clip.current.setAttribute('x', String(-origin.x))
    clip.current.setAttribute('y', String(-origin.y))
    clip.current.setAttribute('width', String(size.width))
    clip.current.setAttribute('height', String(size.height))
    const a = { x: start.x - origin.x, y: start.y - origin.y }
    const b = { x: end.x - origin.x, y: end.y - origin.y }
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const direction = length > 0.5 ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 1, y: 0 }
    const offset = (p: Point, along: number, across = 0): Point => ({ x: p.x + direction.x * along - direction.y * across, y: p.y + direction.y * along + direction.x * across })
    const tick = (p: Point, half = 5) => segment(offset(p, 0, -half), offset(p, 0, half))
    const arrow = (p: Point, toward: number) => `${segment(offset(p, -toward * 7, -4), p)}L${offset(p, -toward * 7, 4).x},${offset(p, -toward * 7, 4).y}`
    const diamond = (p: Point) => `M${p.x - 5},${p.y}L${p.x},${p.y - 5}L${p.x + 5},${p.y}L${p.x},${p.y + 5}Z`
    let endpoints: string
    if (length < 1) {
      endpoints = diamond(a)
    } else if (kind === 'dimension') {
      endpoints = tick(a) + tick(b)
    } else if (kind === 'equal-dimension') {
      endpoints = tick(a) + tick(offset(a, 4)) + tick(b) + tick(offset(b, -4))
    } else if (kind === 'gap' || kind === 'opening-ratio') {
      endpoints = tick(a) + tick(b)
      if (length > 24) endpoints += arrow(offset(a, 7), 1) + arrow(offset(b, -7), -1)
    } else if (kind === 'floor') {
      endpoints = tick(a, 9) + [-6, 0, 6].map(across => segment(offset(a, 0, across), offset(a, -4, across - 3))).join('') + arrow(b, 1)
    } else if (kind === 'level') {
      endpoints = tick(a) + segment(offset(a, -5), offset(a, 5)) + tick(b) + segment(offset(b, -5), offset(b, 5))
    } else if (kind === 'position') {
      endpoints = diamond(a) + tick(b) + arrow(b, 1)
    } else {
      endpoints = tick(a) + arrow(b, 1)
    }
    const line = segment(a, b)
    main.current.setAttribute('d', line)
    marks.current.setAttribute('d', endpoints)
    halo.current.setAttribute('d', line + endpoints)
    extensions.current.setAttribute('d', (leaders ?? []).flatMap(([first, second]) => {
      const c = project(first), d = project(second)
      return c.z >= -1 && c.z <= 1 && d.z >= -1 && d.z <= 1
        ? [segment({ x: c.x - origin.x, y: c.y - origin.y }, { x: d.x - origin.x, y: d.y - origin.y })] : []
    }).join(''))
  // After OrbitControls (-1), before Html and hover projection consumers (0).
  }, -0.5)

  return <Html position={midpoint} style={{ pointerEvents: 'none' }} zIndexRange={[100, 0]}>
    <svg ref={register} width="1" height="1" style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', visibility: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
      <defs><clipPath id={clipId}><rect ref={clip}/></clipPath></defs>
      <g clipPath={`url(#${clipId})`} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        <path ref={extensions} strokeWidth="1" opacity={active ? 0.8 : 0.5}/>
        <path ref={halo} stroke="#fafcf4" strokeWidth={active ? 5 : 4} opacity="0.7"/>
        <path ref={main} data-constraint-line={id} data-active={active} strokeWidth={active ? 2.5 : 1.8} strokeDasharray={paused ? '4 4' : kind === 'level' ? '8 4' : undefined} opacity={active ? 1 : 0.85}/>
        <path ref={marks} strokeWidth={active ? 2 : 1.5} opacity={active ? 1 : 0.85}/>
      </g>
    </svg>
  </Html>
}
