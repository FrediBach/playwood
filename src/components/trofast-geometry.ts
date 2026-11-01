import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { TrofastItem } from '@/lib/trofast-catalog'

const MM = 0.001
const CORNER_STEPS = 10

export interface TrofastGeometryPart {
  role: 'body' | 'rim' | 'mesh' | 'detail'
  geometry: THREE.BufferGeometry
}

interface Ring { width: number; depth: number; radius: number; z: number }

function ringPoints({ width, depth, radius, z }: Ring) {
  const r = Math.min(radius, width / 2, depth / 2)
  const points: THREE.Vector3[] = []
  for (let corner = 0; corner < 4; corner++) {
    const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - r)
    const cy = (corner < 2 ? 1 : -1) * (depth / 2 - r)
    for (let step = 0; step < CORNER_STEPS; step++) {
      const angle = (corner + step / CORNER_STEPS) * Math.PI / 2
      points.push(new THREE.Vector3(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, z))
    }
  }
  return points
}

function outline(width: number, depth: number, radius: number) {
  const shape = new THREE.Shape()
  const points = ringPoints({ width, depth, radius, z: 0 })
  shape.moveTo(points[0].x * MM, points[0].y * MM)
  for (const point of points.slice(1)) shape.lineTo(point.x * MM, point.y * MM)
  shape.closePath()
  return shape
}

/** Join rounded rectangular rings without losing smooth molded wall highlights. */
function loft(rings: Ring[], closed = false) {
  const positions: number[] = [], indices: number[] = []
  const count = CORNER_STEPS * 4
  for (const ring of rings) for (const point of ringPoints(ring)) positions.push(point.x * MM, point.y * MM, point.z * MM)
  for (let ring = 0; ring < rings.length - (closed ? 0 : 1); ring++) for (let i = 0; i < count; i++) {
    const next = (ring + 1) % rings.length
    const a = ring * count + i, b = ring * count + (i + 1) % count
    const c = next * count + (i + 1) % count, d = next * count + i
    indices.push(a, b, d, b, c, d)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function merge(parts: THREE.BufferGeometry[]) {
  // All builders use position/normal. Omitting unused UVs keeps merging predictable.
  const triangles = parts.map(part => {
    const result = part.index ? part.toNonIndexed() : part.clone()
    result.deleteAttribute('uv')
    return result
  })
  const geometry = mergeGeometries(triangles, false)!
  for (const part of [...parts, ...triangles]) part.dispose()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function cap(ring: Ring, underside = false) {
  const geometry = new THREE.ShapeGeometry(outline(ring.width, ring.depth, ring.radius))
  geometry.translate(0, 0, ring.z * MM)
  if (underside) {
    const indices = geometry.index!
    for (let i = 0; i < indices.count; i += 3) {
      const a = indices.getX(i)
      indices.setX(i, indices.getX(i + 1)); indices.setX(i + 1, a)
    }
    geometry.computeVertexNormals()
  }
  return geometry
}

function shell(width: number, depth: number, bottom: number, top: number, radius: number, taper: number, wall = 2.2) {
  const bottomWidth = width - taper * 2, bottomDepth = depth - taper * 2
  const lowerRadius = Math.min(radius, bottomWidth / 3, bottomDepth / 3)
  const lower = { width: bottomWidth - 3, depth: bottomDepth - 3, radius: lowerRadius - 1.5, z: bottom }
  const floor = { width: bottomWidth - wall * 2 - 3, depth: bottomDepth - wall * 2 - 3, radius: lowerRadius - wall - 1.5, z: bottom + wall }
  return merge([
    loft([
      lower,
      { width: bottomWidth, depth: bottomDepth, radius: lowerRadius, z: bottom + 2 },
      { width, depth, radius, z: top - 1.2 },
      { width: width - 0.6, depth: depth - 0.6, radius: radius - 0.3, z: top },
      { width: width - wall * 2, depth: depth - wall * 2, radius: radius - wall, z: top },
      { width: bottomWidth - wall * 2, depth: bottomDepth - wall * 2, radius: lowerRadius - wall, z: bottom + wall + 2 },
      floor,
    ]),
    cap(lower, true), cap(floor),
  ])
}

function rim(item: TrofastItem) {
  const outerRadius = item.kind === 'mesh' ? 10 : 12
  const innerWidth = item.cutoutWidth - 6.4, innerDepth = item.cutoutDepth - 6.4
  const innerRadius = Math.max(5, item.cornerRadius - 3.2)
  const r = item.rimHeight
  return loft([
    { width: item.width - 1.6, depth: item.depth - 1.6, radius: outerRadius - 0.8, z: 0 },
    { width: item.width, depth: item.depth, radius: outerRadius, z: 0.8 },
    { width: item.width, depth: item.depth, radius: outerRadius, z: r - 0.8 },
    { width: item.width - 1.6, depth: item.depth - 1.6, radius: outerRadius - 0.8, z: r },
    { width: innerWidth, depth: innerDepth, radius: innerRadius, z: r },
    { width: innerWidth - 0.8, depth: innerDepth - 0.8, radius: innerRadius - 0.4, z: r - 0.8 },
    { width: innerWidth, depth: innerDepth, radius: innerRadius, z: 0 },
  ], true)
}

/** Compact cylinder writer: thousands of mesh strands remain a single draw call. */
class WireBuilder {
  positions: number[] = []
  normals: number[] = []
  indices: number[] = []

  rod(start: THREE.Vector3, end: THREE.Vector3, radius: number, sides = 5) {
    const direction = end.clone().sub(start).normalize()
    if (start.distanceToSquared(end) < 0.0001) return
    const tangent = new THREE.Vector3(Math.abs(direction.z) < 0.9 ? 0 : 1, 0, Math.abs(direction.z) < 0.9 ? 1 : 0).cross(direction).normalize()
    const bitangent = direction.clone().cross(tangent)
    const first = this.positions.length / 3
    for (const point of [start, end]) for (let i = 0; i < sides; i++) {
      const angle = i * Math.PI * 2 / sides
      const normal = tangent.clone().multiplyScalar(Math.cos(angle)).addScaledVector(bitangent, Math.sin(angle))
      this.positions.push((point.x + normal.x * radius) * MM, (point.y + normal.y * radius) * MM, (point.z + normal.z * radius) * MM)
      this.normals.push(normal.x, normal.y, normal.z)
    }
    for (let i = 0; i < sides; i++) {
      const a = first + i, b = first + (i + 1) % sides, c = b + sides, d = a + sides
      this.indices.push(a, b, d, b, c, d)
    }
  }

  hoop(ring: Ring, radius: number) {
    const points = ringPoints(ring)
    for (let i = 0; i < points.length; i++) this.rod(points[i], points[(i + 1) % points.length], radius)
  }

  geometry() {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geometry.setIndex(this.indices)
    geometry.computeBoundingBox(); geometry.computeBoundingSphere()
    return geometry
  }
}

function diamondLines(width: number, height: number, visit: (a: THREE.Vector2, b: THREE.Vector2) => void, pitch = 9) {
  for (const slope of [-1, 1]) for (let offset = -width; offset <= height + width; offset += pitch) {
    const intersections: THREE.Vector2[] = []
    const add = (x: number, y: number) => {
      if (x >= -1e-6 && x <= width + 1e-6 && y >= -1e-6 && y <= height + 1e-6
        && !intersections.some(p => p.distanceToSquared(new THREE.Vector2(x, y)) < 1e-8)) intersections.push(new THREE.Vector2(x, y))
    }
    add(0, offset); add(width, slope * width + offset)
    add(-offset / slope, 0); add((height - offset) / slope, height)
    if (intersections.length === 2) visit(intersections[0], intersections[1])
  }
}

function meshBasket(item: TrofastItem) {
  const wires = new WireBuilder()
  const height = item.height - item.rimHeight - 2
  const bottom = item.rimHeight - item.height + 1
  const width = item.cutoutWidth - 3, depth = item.cutoutDepth - 3
  const taper = height * 0.075, radius = item.cornerRadius - 1
  const widthAt = (t: number) => width - taper * 2 * (1 - t)
  const depthAt = (t: number) => depth - taper * 2 * (1 - t)
  for (const axis of [0, 1]) for (const sign of [-1, 1]) {
    const span = (axis === 0 ? width : depth) - radius * 2
    const point = (p: THREE.Vector2) => {
      const t = p.y / height
      const w = widthAt(t), d = depthAt(t)
      const along = (p.x / span - 0.5) * ((axis === 0 ? w : d) - radius * 2)
      return axis === 0 ? new THREE.Vector3(along, sign * d / 2, bottom + p.y)
        : new THREE.Vector3(sign * w / 2, along, bottom + p.y)
    }
    diamondLines(span, height, (a, b) => wires.rod(point(a), point(b), 0.52))
  }
  // Continue the lattice around the rounded corners, with heavier bottom edging.
  for (let corner = 0; corner < 4; corner++) {
    const signX = corner === 0 || corner === 3 ? 1 : -1, signY = corner < 2 ? 1 : -1
    for (let step = 0; step <= 5; step++) {
      const angle = (corner + step / 5) * Math.PI / 2
      const at = (t: number) => new THREE.Vector3(signX * (widthAt(t) / 2 - radius) + Math.cos(angle) * radius,
        signY * (depthAt(t) / 2 - radius) + Math.sin(angle) * radius, bottom + t * height)
      wires.rod(at(0), at(1), 0.52)
    }
  }
  for (let z = 0; z <= height; z += 9) {
    const t = z / height
    const points = ringPoints({ width: widthAt(t), depth: depthAt(t), radius, z: bottom + z })
    for (let corner = 0; corner < 4; corner++) for (let step = 0; step < CORNER_STEPS - 1; step++) {
      const i = corner * CORNER_STEPS + step
      wires.rod(points[i], points[i + 1], 0.48)
    }
  }
  const floorWidth = widthAt(0), floorDepth = depthAt(0)
  const inside = (p: THREE.Vector2) => Math.max(0, Math.abs(p.x - floorWidth / 2) - (floorWidth / 2 - radius)) ** 2
    + Math.max(0, Math.abs(p.y - floorDepth / 2) - (floorDepth / 2 - radius)) ** 2 <= radius ** 2
  diamondLines(floorWidth, floorDepth, (start, end) => {
    const middle = start.clone().lerp(end, 0.5)
    if (!inside(middle)) return
    const trim = (point: THREE.Vector2) => {
      if (inside(point)) return point
      let outside = point.clone(), within = middle.clone()
      for (let i = 0; i < 14; i++) {
        const p = outside.clone().lerp(within, 0.5)
        if (inside(p)) within = p; else outside = p
      }
      return within
    }
    const a = trim(start), b = trim(end)
    wires.rod(new THREE.Vector3(a.x - floorWidth / 2, a.y - floorDepth / 2, bottom), new THREE.Vector3(b.x - floorWidth / 2, b.y - floorDepth / 2, bottom), 0.52)
  })
  wires.hoop({ width: floorWidth, depth: floorDepth, radius, z: bottom }, 1)
  wires.hoop({ width, depth, radius, z: -1 }, 1.1)
  return wires.geometry()
}

function compartmentTray(item: TrofastItem): TrofastGeometryPart[] {
  // The current molded tray has five rectangular wells and a central round cup.
  // Pocket profiles follow the product photos; these are visual approximations.
  const pockets = [
    { x: -121, y: 44, width: 126, depth: 166, radius: 18 },
    { x: -121, y: -87, width: 126, depth: 80, radius: 18 },
    { x: 72, y: 87, width: 232, depth: 80, radius: 18 },
    { x: 72, y: -87, width: 232, depth: 80, radius: 18 },
    { x: 117, y: 0, width: 142, depth: 80, radius: 16 },
    { x: -1, y: 0, width: 80, depth: 80, radius: 40 },
  ]
  const plate = outline(item.width - 2, item.depth - 2, 12)
  const bodies: THREE.BufferGeometry[] = []
  for (const pocket of pockets) {
    const geometry = shell(pocket.width, pocket.depth, item.rimHeight - item.height, 2.4, pocket.radius, 5, 1.8)
    geometry.translate(pocket.x * MM, pocket.y * MM, 0)
    bodies.push(geometry)
    const path = outline(pocket.width - 3.6, pocket.depth - 3.6, pocket.radius - 1.8)
    const hole = new THREE.Path(path.getPoints().map(p => p.add(new THREE.Vector2(pocket.x * MM, pocket.y * MM))))
    plate.holes.push(hole)
  }
  const top = new THREE.ExtrudeGeometry(plate, { depth: 1.6 * MM, bevelEnabled: true, bevelSize: 0.6 * MM, bevelThickness: 0.6 * MM, bevelSegments: 2, steps: 1, curveSegments: 8 })
  top.translate(0, 0, 1.2 * MM)
  return [{ role: 'body', geometry: merge(bodies) }, { role: 'rim', geometry: merge([rim(item), top]) }]
}

/** Caller-owned geometry. Opening is local XY; the body extends down negative Z.
 * The panel top surface is Z=0. All returned vertices are in scene meters.
 */
export function makeTrofastGeometry(item: TrofastItem): TrofastGeometryPart[] {
  if (item.kind === 'tray') return compartmentTray(item)
  if (item.kind === 'mesh') return [{ role: 'mesh', geometry: meshBasket(item) }, { role: 'rim', geometry: rim(item) }]
  const body = shell(item.cutoutWidth - 2, item.cutoutDepth - 2, item.rimHeight - item.height,
    1, item.cornerRadius - 1, Math.min(26, item.height * 0.085))
  return [{ role: 'body', geometry: body }, { role: 'rim', geometry: rim(item) }]
}

const geometryCache = new Map<string, readonly TrofastGeometryPart[]>()

/** Immutable application-lifetime meshes, shared like the connector CAD geometry.
 * Render with dispose={null}; instances must never modify or dispose these parts.
 */
export function getTrofastGeometry(item: TrofastItem): readonly TrofastGeometryPart[] {
  const key = [item.id, item.width, item.depth, item.height, item.cutoutWidth, item.cutoutDepth, item.cornerRadius, item.rimHeight].join(':')
  let parts = geometryCache.get(key)
  if (!parts) { parts = makeTrofastGeometry(item); geometryCache.set(key, parts) }
  return parts
}
