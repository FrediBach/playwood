import { useLayoutEffect, useMemo, useRef } from 'react'
import { Html, Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { DoubleSide, OrthographicCamera, Vector3 } from 'three'
import { attachmentSideAnchors, layoutAttachmentSideLabels, type SideLabelPoint } from '@/lib/attachment-side-guide'
import type { Panel, Side, Vec3 } from '@/lib/types'
import './attachment-side-guide.css'

export interface AttachmentSideGuideState {
  panelId: string
  side: Side
  highlightedSide: Side | null
  onHighlight: (side: Side | null) => void
  onSelect: (side: Side) => void
}

const MM = 0.001
const ACCENT = '#cb4f2c'

/** Labels stay screen-sized while their leaders and highlighted sides follow the panel. */
export function AttachmentSideGuide({ panel, guide }: { panel: Panel; guide: AttachmentSideGuideState }) {
  const { camera, gl, size, invalidate } = useThree()
  const portal = useMemo(() => ({ current: gl.domElement.parentElement! }), [gl])
  const elements = useRef(new Map<Side, HTMLDivElement>())
  const anchors = useMemo(() => attachmentSideAnchors(panel), [panel])
  const projection = useMemo(() => ({ world: new Vector3(), point: new Vector3(), tip: new Vector3(), towards: new Vector3(), direction: new Vector3() }), [])
  useLayoutEffect(() => { invalidate() }, [anchors, guide.side, guide.highlightedSide, camera, size, invalidate])
  useFrame(() => {
    camera.updateMatrixWorld()
    const points: SideLabelPoint[] = []
    const { world, point, tip, towards, direction } = projection
    for (const anchor of anchors) {
      const element = elements.current.get(anchor.side)
      if (!element) continue
      world.set(...anchor.position).multiplyScalar(MM)
      direction.set(...anchor.direction)
      point.copy(world).project(camera)
      tip.copy(world).addScaledVector(direction, 0.01).project(camera)
      const x = (point.x + 1) * size.width / 2, y = (1 - point.y) * size.height / 2
      const visible = point.z >= -1 && point.z <= 1 && x >= 0 && x <= size.width && y >= 0 && y <= size.height
      element.style.visibility = visible ? 'visible' : 'hidden'
      if (!visible) continue
      if (camera instanceof OrthographicCamera) camera.getWorldDirection(towards).negate()
      else towards.copy(camera.position).sub(world).normalize()
      const rear = towards.dot(direction) < -0.04
      element.classList.toggle('is-rear', rear)
      element.dataset.rear = String(rear)
      // Keep anchors out of separate stacking contexts so every label sits
      // above every leader, including when opposite sides overlap in a view.
      element.style.left = `${x}px`
      element.style.top = `${y}px`
      points.push({ side: anchor.side, x, y, dx: (tip.x - point.x) * size.width / 2, dy: (point.y - tip.y) * size.height / 2 })
    }
    for (const label of layoutAttachmentSideLabels(points, size.width, size.height)) {
      const element = elements.current.get(label.side)!
      const anchor = points.find(point => point.side === label.side)!
      const dx = label.x - anchor.x, dy = label.y - anchor.y
      element.style.setProperty('--side-label-x', `${dx}px`)
      element.style.setProperty('--side-label-y', `${dy}px`)
      element.style.setProperty('--side-leader-length', `${Math.hypot(dx, dy)}px`)
      element.style.setProperty('--side-leader-angle', `${Math.atan2(dy, dx)}rad`)
    }
  })
  const activeSide = guide.highlightedSide ?? guide.side
  const anchor = anchors.find(anchor => anchor.side === activeSide)!
  const w = panel.width * MM / 2, h = panel.height * MM / 2, t = panel.thickness * MM / 2
  const edge: [Vec3, Vec3] = activeSide === 'left' || activeSide === 'right'
    ? [[anchor.localPosition[0] * MM, -h, 0], [anchor.localPosition[0] * MM, h, 0]]
    : [[-w, anchor.localPosition[1] * MM, 0], [w, anchor.localPosition[1] * MM, 0]]
  const face = activeSide === 'front' || activeSide === 'back'
  return <>
    <group position={panel.position.map(value => value * MM) as Vec3} rotation={panel.rotation}>
      {face ? <>
        <mesh position={[0, 0, activeSide === 'front' ? t + 0.001 : -t - 0.001]} raycast={() => null} renderOrder={5}>
          <planeGeometry args={[w * 2, h * 2]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0.16} side={DoubleSide} depthTest={false} depthWrite={false} />
        </mesh>
        <Line points={[[-w, -h, anchor.localPosition[2] * MM], [w, -h, anchor.localPosition[2] * MM], [w, h, anchor.localPosition[2] * MM], [-w, h, anchor.localPosition[2] * MM], [-w, -h, anchor.localPosition[2] * MM]]}
          color={ACCENT} lineWidth={3} depthTest={false} depthWrite={false} raycast={() => null} />
      </> : <Line points={edge} color={ACCENT} lineWidth={5} depthTest={false} depthWrite={false} raycast={() => null} />}
    </group>
    <Html fullscreen portal={portal} zIndexRange={[2, 2]} position={panel.position.map(value => value * MM) as Vec3}
      calculatePosition={(_object, _camera, viewport) => [viewport.width / 2, viewport.height / 2]} style={{ pointerEvents: 'none' }}>
      <div className="attachment-side-guide" role="group" aria-label="Choose an attachment side in the preview">
        {anchors.map(anchor => <div key={anchor.side} className={`attachment-side-anchor${guide.side === anchor.side ? ' is-selected' : ''}${guide.highlightedSide === anchor.side ? ' is-highlighted' : ''}`}
          ref={element => { if (element) { elements.current.set(anchor.side, element); invalidate() } else elements.current.delete(anchor.side) }}>
          <span className="attachment-side-root" aria-hidden="true" />
          <span className="attachment-side-leader" aria-hidden="true" />
          <button type="button" className={`attachment-side-label${guide.side === anchor.side ? ' is-selected' : ''}${guide.highlightedSide === anchor.side ? ' is-highlighted' : ''}`}
            data-attachment-side={anchor.side} aria-label={`Choose ${anchor.label} side`} aria-pressed={guide.side === anchor.side}
            title={`${anchor.label} side of ${panel.name}${guide.side === anchor.side ? ' · Click again to flip joint direction' : ''}`}
            onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
            onPointerEnter={() => guide.onHighlight(anchor.side)} onPointerLeave={event => { if (document.activeElement !== event.currentTarget) guide.onHighlight(null) }}
            onFocus={() => guide.onHighlight(anchor.side)} onBlur={() => guide.onHighlight(null)}
            onKeyDown={event => { if (event.key !== 'Escape' && !event.ctrlKey && !event.metaKey) event.stopPropagation() }}
            onClick={event => { event.stopPropagation(); guide.onSelect(anchor.side) }}>
            <span className="attachment-side-badge" aria-hidden="true">{anchor.badge}</span><span>{anchor.label}</span>
          </button>
        </div>)}
      </div>
    </Html>
  </>
}
