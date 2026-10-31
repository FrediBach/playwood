import { memo, useId, useMemo } from 'react'
import { Color, Euler, Vector3 } from 'three'
import { getGuideScene, type GuideScene } from '@/lib/guide-scenes'
import type { GuideId } from '@/lib/build-guide-types'
import type { ConnectorType, Panel } from '@/lib/types'
import { getProjectBounds, resolvePanels } from '@/lib/model'
import { panelOutlineCorners, panelOutlineSvgPath } from '@/lib/panel-shape'
import { getPhysicalConnectors } from '@/lib/connector-selection'
import { connectorSlide, getConnectorRail } from '@/lib/connector-movement'
import { getConnectorGeometry } from './connector-geometry'
import './guide-preview.css'

type Point = [number, number]
type DrawingFace = { depth: number; color: string; points?: Point[]; path?: string; transform?: string; selected?: boolean; ghost?: boolean; hardware?: boolean }
const vertexCache = new Map<ConnectorType, Vector3[][]>()

function wrapLabel(text: string, max = 25) {
  const lines: string[] = []
  for (const word of text.split(' ')) {
    if (!lines.length || `${lines.at(-1)} ${word}`.length > max) lines.push(word)
    else lines[lines.length - 1] += ` ${word}`
  }
  return lines
}

function connectorVertices(type: ConnectorType) {
  let parts = vertexCache.get(type)
  if (!parts) {
    parts = getConnectorGeometry(type).map(part => {
      const positions = part.geometry.getAttribute('position'), unique = new Map<string, Vector3>()
      for (let index = 0; index < positions.count; index++) {
        const point = new Vector3().fromBufferAttribute(positions, index).multiplyScalar(1000)
        unique.set(point.toArray().map(value => value.toFixed(3)).join(','), point)
      }
      return [...unique.values()]
    })
    vertexCache.set(type, parts)
  }
  return parts
}

/** The convex silhouette keeps the real CAD outline without thousands of SVG triangles. */
function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = (items: Point[]) => {
    const result: Point[] = []
    for (const point of items) {
      while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], point) <= 0) result.pop()
      result.push(point)
    }
    return result.slice(0, -1)
  }
  return [...half(sorted), ...half(sorted.reverse())]
}

function contour(panel: Panel): Point[] {
  return panelOutlineCorners(panel).flatMap(corner => {
    const entry: Point = [corner.entry.x, corner.entry.y]
    if (!corner.radius) return [entry]
    const start = Math.atan2(corner.entry.y - corner.center.y, corner.entry.x - corner.center.x)
    let delta = Math.atan2(corner.exit.y - corner.center.y, corner.exit.x - corner.center.x) - start
    if (corner.sweep && delta < 0) delta += Math.PI * 2
    if (!corner.sweep && delta > 0) delta -= Math.PI * 2
    return [entry, ...Array.from({ length: 6 }, (_, index): Point => {
      const angle = start + delta * (index + 1) / 6
      return [corner.center.x + Math.cos(angle) * corner.radius, corner.center.y + Math.sin(angle) * corner.radius]
    })]
  })
}

function facePath(panel: Panel): string {
  let path = panelOutlineSvgPath(panel)
  if (panel.pattern === 'solid') return path
  const radius = Math.max(1, panel.holeSize) / 2
  const spacing = Math.max(panel.holeSpacing, panel.holeSize + 5, 15)
  const slotLength = Math.min(spacing * .72, radius * 7)
  const marginX = Math.max(spacing * .65, radius * 2)
  const marginY = panel.pattern === 'slots' ? Math.max(spacing * .65, slotLength / 2 + radius) : marginX
  const cols = Math.max(0, Math.floor((panel.width - marginX * 2) / spacing) + 1)
  const rows = Math.max(0, Math.floor((panel.height - marginY * 2) / spacing) + 1)
  for (let col = 0; col < cols; col++) for (let row = 0; row < rows; row++) {
    const x = panel.width / 2 + (col - (cols - 1) / 2) * spacing
    const y = panel.height / 2 + (row - (rows - 1) / 2) * spacing
    const straight = panel.pattern === 'slots' ? Math.max(0, slotLength / 2 - radius) : 0
    path += ` M ${x - radius} ${y - straight} A ${radius} ${radius} 0 0 1 ${x + radius} ${y - straight} L ${x + radius} ${y + straight} A ${radius} ${radius} 0 0 1 ${x - radius} ${y + straight} Z`
  }
  return path
}

function drawingFor(scene: GuideScene, guideId: GuideId) {
  const direction = scene.view === 'front' ? new Vector3(0, 0, 1)
    : scene.view === 'side' ? new Vector3(-1, .65, 1).normalize()
      : scene.view === 'top' ? new Vector3(0, 1, .001).normalize() : new Vector3(1, .65, 1.4).normalize()
  const right = new Vector3(direction.z, 0, -direction.x).normalize()
  const up = new Vector3().crossVectors(direction, right)
  const projectRaw = (point: Vector3): Point => [point.dot(right), -point.dot(up)]
  const reference = [0, 1, 2, 3].flatMap(step => resolvePanels(getGuideScene(guideId, step).project))
  const modelBounds = getProjectBounds(resolvePanels(scene.project))
  const lampX = modelBounds.max[0] + 440, lampBase = modelBounds.min[1]
  const lampWorld = scene.room ? [
    [[lampX, lampBase, 0], [lampX, lampBase + 1430, 0]],
    [[lampX - 145, lampBase, 0], [lampX + 145, lampBase, 0]],
    [[lampX - 175, lampBase + 1400, 0], [lampX - 110, lampBase + 1650, 0], [lampX + 110, lampBase + 1650, 0], [lampX + 175, lampBase + 1400, 0], [lampX - 175, lampBase + 1400, 0]],
  ].map(line => line.map(point => new Vector3(...point as [number, number, number]))) : []
  const points = reference.flatMap(panel => {
    const rotation = new Euler(...panel.rotation)
    return Array.from({ length: 8 }, (_, index) => projectRaw(new Vector3(
      (index & 1 ? 1 : -1) * panel.width / 2, (index & 2 ? 1 : -1) * panel.height / 2, (index & 4 ? 1 : -1) * panel.thickness / 2,
    ).applyEuler(rotation).add(new Vector3(...panel.position))))
  }).concat(lampWorld.flatMap(line => line.map(projectRaw)))
  const minX = Math.min(...points.map(point => point[0])), maxX = Math.max(...points.map(point => point[0]))
  const minY = Math.min(...points.map(point => point[1])), maxY = Math.max(...points.map(point => point[1]))
  const hasDocuments = [0, 1, 2, 3].some(step => !!getGuideScene(guideId, step).document)
  const scale = Math.min((hasDocuments ? 330 : 460) / Math.max(1, maxX - minX), 215 / Math.max(1, maxY - minY))
  const centerX = hasDocuments ? 210 : 300, centerY = 185
  const project = (point: Vector3): Point => {
    const [x, y] = projectRaw(point)
    return [centerX + (x - (minX + maxX) / 2) * scale, centerY + (y - (minY + maxY) / 2) * scale]
  }
  const panels = resolvePanels(scene.project), faces: DrawingFace[] = []
  const selected = new Set(scene.selected), ghosts = new Set(scene.ghost)
  for (const panel of panels) {
    const rotation = new Euler(...panel.rotation), center = new Vector3(...panel.position)
    const world = (x: number, y: number, z: number) => new Vector3(x - panel.width / 2, panel.height / 2 - y, z).applyEuler(rotation).add(center)
    const faceSign = new Vector3(0, 0, 1).applyEuler(rotation).dot(direction) >= 0 ? 1 : -1
    const normal = new Vector3(0, 0, faceSign).applyEuler(rotation)
    const origin = project(world(0, 0, panel.thickness / 2 * faceSign))
    const xAxis = project(world(1, 0, panel.thickness / 2 * faceSign)), yAxis = project(world(0, 1, panel.thickness / 2 * faceSign))
    const shade = (n: Vector3) => `#${new Color(panel.color).multiplyScalar(.8 + .2 * Math.max(0, n.dot(new Vector3(.2, 1, .8).normalize()))).getHexString()}`
    faces.push({ path: facePath(panel), transform: `matrix(${xAxis[0] - origin[0]} ${xAxis[1] - origin[1]} ${yAxis[0] - origin[0]} ${yAxis[1] - origin[1]} ${origin[0]} ${origin[1]})`,
      depth: center.clone().addScaledVector(normal, panel.thickness / 2).dot(direction), color: shade(normal), selected: selected.has(panel.id), ghost: ghosts.has(panel.id) })
    const outline = contour(panel)
    for (let index = 0; index < outline.length; index++) {
      const a = outline[index], b = outline[(index + 1) % outline.length]
      const normal = new Vector3(b[1] - a[1], b[0] - a[0], 0).normalize().applyEuler(rotation)
      if (normal.dot(direction) < 0) continue
      const vertices = [world(a[0], a[1], panel.thickness / 2), world(b[0], b[1], panel.thickness / 2), world(b[0], b[1], -panel.thickness / 2), world(a[0], a[1], -panel.thickness / 2)]
      faces.push({ points: vertices.map(project), depth: vertices.reduce((sum, point) => sum + point.dot(direction), 0) / 4, color: shade(normal), selected: selected.has(panel.id), ghost: ghosts.has(panel.id) })
    }
  }
  const connectorPositions: { point: Point; selected: boolean }[] = []
  for (const piece of getPhysicalConnectors(scene.project)) {
    const rail = getConnectorRail(piece.connection, panels, scene.project.connections)
    if (!rail) continue
    const pose = rail.placements[piece.index], rotation = new Euler(...pose.rotation)
    const slide = connectorSlide(rail, piece.index, scene.project.connectorOverrides?.[piece.id]?.slide)
    const center = new Vector3(...pose.position).addScaledVector(new Vector3(...rail.tangent), slide)
    const selected = scene.selectedConnectors?.includes(piece.id)
    connectorPositions.push({ point: project(center), selected: !!selected })
    const ghost = [piece.connection.parentId, piece.connection.childId].some(id => ghosts.has(id))
    for (const [index, vertices] of connectorVertices(piece.type).entries()) {
      const world = vertices.map(point => point.clone().applyEuler(rotation).add(center))
      faces.push({ points: hull(world.map(project)), color: `#${new Color(piece.color).multiplyScalar(index ? .86 : 1).getHexString()}`,
        depth: center.dot(direction) + 22, selected, ghost, hardware: true })
    }
  }
  faces.sort((a, b) => a.depth - b.depth)
  const labels = scene.labels.flatMap(item => {
    const panel = panels.find(panel => panel.id === item.panelId)
    const point = item.point ?? panel?.position
    return point ? [{ text: item.text, point: project(new Vector3(...point)) }] : []
  })
  const vertices = scene.outlinePoints ? panels.flatMap(panel => (panel.customOutline ?? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]).map(point => project(new Vector3((point.x - .5) * panel.width, (.5 - point.y) * panel.height, panel.thickness / 2).applyEuler(new Euler(...panel.rotation)).add(new Vector3(...panel.position))))) : []
  const resizeHandles = (scene.resizeHandles ?? []).flatMap(handle => {
    const root = project(new Vector3(...handle.position)), axis = new Vector3(...handle.direction)
    const dx = axis.dot(right), dy = -axis.dot(up), length = Math.hypot(dx, dy)
    if (length < .1) return []
    const tip: Point = [root[0] + dx / length * 34, root[1] + dy / length * 34]
    return [{ ...handle, root, tip, angle: Math.atan2(dy, dx) * 180 / Math.PI }]
  })
  const bounds = getProjectBounds(panels)
  return { faces, labels, vertices, connectorPositions, resizeHandles, bounds, centerX, scale,
    lamp: lampWorld.map(line => line.map(project)), lampLabel: project(new Vector3(lampX, lampBase + 1750, 0)) }
}

export const GuidePreview = memo(function GuidePreview({ guideId, step, caption }: { guideId: GuideId; step: number; caption: string }) {
  const id = useId(), scene = getGuideScene(guideId, step)
  const drawing = useMemo(() => drawingFor(scene, guideId), [scene, guideId])
  const dimension = scene.dimensions ? Math.round(drawing.bounds.max[0] - drawing.bounds.min[0]) : null
  return <div className="guide-preview" data-guide-scene={`${guideId}-${step}`}>
    <svg viewBox="0 0 600 330" role="img" aria-label={caption} aria-describedby={`${id}-description`}>
      <title>{caption}</title><desc id={`${id}-description`}>{scene.note} {scene.labels.map(label => label.text).join('. ')}</desc>
      <defs><pattern id={`${id}-grid`} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#c8c7bc"/></pattern></defs>
      <rect width="600" height="330" fill="#eeede6"/>
      <rect y="55" width="600" height="265" fill={`url(#${id}-grid)`} opacity=".65"/>
      {scene.room && <g aria-hidden="true" stroke="#929780" strokeWidth="2" fill="none"><path d="M 25 300 H 580" stroke="#cbcdbf"/>{drawing.lamp.map((line, index) => <polyline key={index} points={line.map(point => point.join(',')).join(' ')} fill={index === 2 ? '#e1e3d5' : 'none'}/>)}<text x={drawing.lampLabel[0]} y={drawing.lampLabel[1]} textAnchor="middle" stroke="none" className="guide-svg-label">165 cm</text></g>}
      <text x="20" y="26" className="guide-svg-kicker">PROJECT STUDY · {String(step + 1).padStart(2, '0')}</text>
      <text x="580" y="26" textAnchor="end" className="guide-svg-small">{scene.view === 'front' ? 'Front view' : scene.view === 'top' ? 'Top view' : 'Isometric view'}</text>
      <ellipse cx={drawing.centerX} cy="288" rx="175" ry="15" fill="#575d3f" opacity=".06"/>
      {drawing.faces.map((face, index) => {
        const style = { fill: face.ghost ? face.hardware ? '#9aae83' : '#bdd1ad' : face.color, fillOpacity: face.ghost ? face.hardware ? .75 : .42 : 1, stroke: face.selected ? '#be482b' : face.ghost ? '#66805a' : '#655e4e',
          strokeOpacity: face.selected || face.ghost ? 1 : face.hardware ? .5 : .45, strokeWidth: face.selected ? 2 : face.ghost ? 1.2 : .65, strokeDasharray: face.ghost ? '5 3' : undefined }
        return face.path ? <path key={index} d={face.path} transform={face.transform} fillRule="evenodd" vectorEffect="non-scaling-stroke" strokeLinejoin="round" {...style}/>
          : <polygon key={index} points={face.points!.map(point => point.join(',')).join(' ')} strokeLinejoin="round" {...style}/>
      })}
      {drawing.connectorPositions.filter(item => item.selected).map((item, index) => <circle key={index} cx={item.point[0]} cy={item.point[1]} r="14" stroke="#be482b" strokeWidth="2" fill="none" strokeDasharray="3 3"/>)}
      {drawing.resizeHandles.map(handle => <g key={handle.id} data-guide-resize-handle={handle.id} className={`guide-resize-handle${handle.distance === undefined ? '' : ' is-active'}`} aria-hidden="true">
        <path d={`M ${handle.root.join(' ')} L ${handle.tip.join(' ')}`} fill="none" stroke="#c94727" strokeWidth="1.6"/>
        <circle cx={handle.root[0]} cy={handle.root[1]} r="3" fill="#fbfaf7" stroke="#c94727" strokeWidth="1.5"/>
        <g transform={`translate(${handle.tip.join(' ')}) rotate(${handle.angle})`}><circle r="11" className="guide-resize-button"/><path d="M -5 0 H 5 M 1 -4 L 5 0 L 1 4" className="guide-resize-arrow"/></g>
        {handle.distance !== undefined && <g transform={`translate(${Math.max(8, Math.min(500, handle.tip[0] + 17))} ${Math.max(36, Math.min(268, handle.tip[1] - 14))})`}>
          <rect width="92" height="28" rx="5" fill="#fbfaf7" stroke="#d6d7cc"/><text x="46" y="19" textAnchor="middle" className="guide-svg-small">{handle.distance >= 0 ? '+' : ''}{Math.round(handle.distance)} mm</text>
        </g>}
      </g>)}
      {drawing.vertices.map((point, index) => <g key={index}><circle cx={point[0]} cy={point[1]} r="4" fill="#fbfaf7" stroke="#be482b" strokeWidth="2"/><text x={point[0] + 9} y={point[1] - 8} className="guide-svg-small">{index + 1}</text></g>)}
      {drawing.labels.map((label, index) => {
        const lines = wrapLabel(label.text), left = index === 0, x = left ? 20 : 580
        const width = Math.min(275, Math.max(...lines.map(line => line.length)) * 8.7 + 24), start = left ? x : x - width, height = lines.length * 21 + 12
        return <g key={label.text}><path d={`M ${start + width / 2} ${43 + height} L ${label.point[0]} ${label.point[1]}`} fill="none" stroke="#8a917c" strokeWidth="1" strokeDasharray="3 3"/><circle cx={label.point[0]} cy={label.point[1]} r="3" fill="#c94727"/><rect x={start} y="43" width={width} height={height} rx="5" fill="#fbfaf7" stroke="#d6d7cc"/>{lines.map((line, lineIndex) => <text key={lineIndex} x={start + 12} y={66 + lineIndex * 21} className="guide-svg-label">{line}</text>)}</g>
      })}
      {dimension !== null && <g className="guide-svg-dimension"><path d={`M 90 305 H 510 M 90 300 V 310 M 510 300 V 310`} fill="none" stroke="#7a826d"/><rect x="193" y="292" width="214" height="25" fill="#eeede6"/><text x="300" y="311" textAnchor="middle">{dimension} mm overall width</text></g>}
      {scene.document && <g><rect x="397" y="110" width="188" height="176" rx="8" fill="#fbfaf7" stroke="#cfd2c3"/><rect x="397" y="110" width="4" height="176" rx="2" fill="#7e8d66"/>{wrapLabel(scene.document.title, 19).map((line, index) => <text key={index} x="411" y={137 + index * 21} className="guide-svg-label">{line}</text>)}{scene.document.lines.flatMap(line => wrapLabel(line, 20)).map((line, index) => <text key={index} x="411" y={153 + wrapLabel(scene.document!.title, 19).length * 21 + index * 21} className="guide-svg-document-line">{line}</text>)}</g>}
    </svg>
    <div className="guide-preview-legend" aria-label="Drawing legend"><span><i className="guide-legend-panel"/>Panel</span><span><i className="guide-legend-connector"/>Connector</span>{(scene.selected.length > 0 || !!scene.selectedConnectors?.length) && <span><i className="guide-legend-selected"/>Selected</span>}{scene.ghost.length > 0 && <span><i className="guide-legend-ghost"/>Preview</span>}{drawing.resizeHandles.length > 0 && <span><svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="8" stroke="#c94727"/><path d="M4 9h9M9 5l4 4-4 4" stroke="#c94727" strokeLinecap="round" strokeLinejoin="round"/></svg>Resize handle</span>}</div>
    <p className="guide-preview-note">{scene.note}</p>
  </div>
})
