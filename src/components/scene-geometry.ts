import * as THREE from 'three'
import { makePanelShape } from '@/lib/panel-cut-geometry'

export function makePanelGeometry(panel: Parameters<typeof makePanelShape>[0]) {
  const shape = makePanelShape(panel)
  const t = panel.thickness * 0.001
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, steps: 1, curveSegments: 8 })
  geometry.translate(0, 0, -t / 2)
  // ExtrudeGeometry's face UVs use local metres. Keep that physical scale so
  // repeating grain stays the same size when a board is resized or reshaped.
  return geometry
}

