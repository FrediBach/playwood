import * as THREE from 'three'
import { makePanelShape } from '@/lib/panel-cut-geometry'
import { panelCornerRadius } from '@/lib/panel-shape'

type PanelShape = Parameters<typeof makePanelShape>[0]
const MAX_TEMPLATE_ENTRIES = 16
const MAX_TEMPLATE_BYTES = 32 * 1024 * 1024
const templates = new Map<string, { geometry: THREE.BufferGeometry; bytes: number }>()
let templateBytes = 0

function geometryKey(panel: PanelShape) {
  // Simple solid stock is cheap to build; reserve the cache for detailed cuts.
  if (panel.pattern === 'solid' && !panel.customOutline && !panel.trofastInserts?.length) return null
  return JSON.stringify([
    panel.width, panel.height, panel.thickness, panel.pattern,
    panel.pattern === 'solid' ? null : [panel.holeSize, panel.holeSpacing],
    panelCornerRadius(panel), panel.customOutline?.map(point => [point.x, point.y]) ?? null,
    panel.trofastInserts?.map(insert => [insert.itemId, insert.x, insert.y, !!insert.quarterTurn]) ?? [],
  ])
}

function rememberGeometry(key: string, geometry: THREE.BufferGeometry) {
  const bytes = Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, geometry.index?.array.byteLength ?? 0)
  if (bytes > MAX_TEMPLATE_BYTES) return
  // Evict before allocating another copy, including when the byte limit binds first.
  while (templates.size >= MAX_TEMPLATE_ENTRIES || templateBytes + bytes > MAX_TEMPLATE_BYTES) {
    const oldest = templates.keys().next().value!
    const entry = templates.get(oldest)!
    templates.delete(oldest)
    templateBytes -= entry.bytes
    entry.geometry.dispose()
  }
  // BufferGeometry.copy keeps the exact buffers/groups without retaining Shape paths.
  // Templates never reach a renderer; callers always own separate, disposable buffers.
  const template = new THREE.BufferGeometry().copy(geometry)
  template.userData = {}
  templates.set(key, { geometry: template, bytes })
  templateBytes += bytes
}

export function makePanelGeometry(panel: PanelShape) {
  const key = geometryKey(panel)
  const cached = key === null ? undefined : templates.get(key)
  if (cached) {
    templates.delete(key!)
    templates.set(key!, cached)
    const geometry = cached.geometry.clone()
    geometry.userData = {}
    return geometry
  }
  const shape = makePanelShape(panel)
  const t = panel.thickness * 0.001
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, steps: 1, curveSegments: 8 })
  geometry.translate(0, 0, -t / 2)
  // ExtrudeGeometry's face UVs use local metres. Keep that physical scale so
  // repeating grain stays the same size when a board is resized or reshaped.
  if (key !== null) rememberGeometry(key, geometry)
  return geometry
}

