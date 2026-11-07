import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Vector3 } from 'three'
import { layoutConstraintLabels } from '@/lib/constraint-label-layout'
import type { Vec3 } from '@/lib/types'

interface LabelEntry {
  position: Vec3
  element: HTMLDivElement
  leader: SVGLineElement
}
const LabelContext = createContext<Map<string, LabelEntry> | null>(null)

/** One screen-space collision pass per requested frame, shared by all constraint labels. */
export function ConstraintLabels({ children }: { children: ReactNode }) {
  const entries = useMemo(() => new Map<string, LabelEntry>(), [])
  const point = useMemo(() => new Vector3(), [])
  const anchors = useMemo(() => new Map<string, { x: number; y: number }>(), [])
  useFrame(({ camera, size }) => {
    if (!entries.size) return
    anchors.clear()
    const labels = [...entries].flatMap(([id, entry]) => {
      point.set(...entry.position).project(camera)
      const visible = point.z >= -1 && point.z <= 1
      if (!visible) return []
      const anchor = { x: (point.x + 1) * size.width / 2, y: (1 - point.y) * size.height / 2 }
      anchors.set(id, anchor)
      return [{ id, ...anchor, width: entry.element.offsetWidth, height: entry.element.offsetHeight }]
    })
    // Complete all DOM size reads before updating positions.
    for (const [id, entry] of entries) {
      if (!anchors.has(id)) entry.element.style.visibility = 'hidden'
      entry.leader.style.visibility = anchors.has(id) ? 'visible' : 'hidden'
    }
    for (const box of layoutConstraintLabels(labels, size.width, size.height)) {
      const entry = entries.get(box.id)!, anchor = anchors.get(box.id)!
      const x = box.x - anchor.x, y = box.y - anchor.y
      const style = `visibility: visible; transform: translate(${x}px, ${y}px);`
      if (entry.element.style.cssText !== style) entry.element.style.cssText = style
      // End at the nearest label edge, keeping the measurement midpoint unobscured.
      entry.leader.setAttribute('x2', String(Math.max(x, Math.min(0, x + box.width))))
      entry.leader.setAttribute('y2', String(Math.max(y, Math.min(0, y + box.height))))
    }
  })
  return <LabelContext value={entries}>{children}</LabelContext>
}

export function ConstraintLabel({ id, position, color, children }: {
  id: string; position: Vec3; color: string; children: ReactNode
}) {
  const entries = useContext(LabelContext)
  const invalidate = useThree(state => state.invalidate)
  return <Html position={position} style={{ pointerEvents: 'none' }}>
    <RegisteredConstraintLabel entries={entries} invalidate={invalidate} id={id} position={position} color={color}>{children}</RegisteredConstraintLabel>
  </Html>
}

// Html mounts its DOM in a separate React root; register only after those refs exist.
function RegisteredConstraintLabel({ entries, invalidate, id, position, color, children }: {
  entries: Map<string, LabelEntry> | null; invalidate: () => void
  id: string; position: Vec3; color: string; children: ReactNode
}) {
  const element = useRef<HTMLDivElement>(null)
  const leader = useRef<SVGLineElement>(null)
  const [x, y, z] = position
  useLayoutEffect(() => {
    if (!entries || !element.current || !leader.current) return
    entries.set(id, { position: [x, y, z], element: element.current, leader: leader.current })
    const observer = new ResizeObserver(() => invalidate())
    observer.observe(element.current)
    invalidate()
    return () => { observer.disconnect(); entries.delete(id); invalidate() }
  }, [entries, id, x, y, z, invalidate])
  return <>
    <svg className="constraint-label-leader" width="1" height="1" aria-hidden="true"><line ref={leader} x1="0" y1="0" x2="0" y2="0" stroke={color} strokeWidth="1.5"/></svg>
    <div ref={element} className="constraint-label-position">{children}</div>
  </>
}
