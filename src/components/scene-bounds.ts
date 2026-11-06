import * as THREE from 'three'
import type { Panel } from '@/lib/types'
import { getTrofastInsertLocalBounds } from '@/lib/trofast'

const MM = .001

export function boundsOf(panels: Panel[]) {
  const bounds = new THREE.Box3()
  for (const panel of panels.filter(p => p.visible)) {
    const rotation = new THREE.Euler(...panel.rotation)
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const point = new THREE.Vector3(x * panel.width / 2, y * panel.height / 2, z * panel.thickness / 2)
        .applyEuler(rotation).add(new THREE.Vector3(...panel.position)).multiplyScalar(MM)
      bounds.expandByPoint(point)
    }
    for (const insert of panel.trofastInserts ?? []) {
      const local = getTrofastInsertLocalBounds(panel, insert)
      if (!local) continue
      for (const x of [local.min[0], local.max[0]]) for (const y of [local.min[1], local.max[1]]) for (const z of [local.min[2], local.max[2]]) {
        bounds.expandByPoint(new THREE.Vector3(x, y, z).applyEuler(rotation).add(new THREE.Vector3(...panel.position)).multiplyScalar(MM))
      }
    }
  }
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-0.4, 0, -0.3), new THREE.Vector3(0.4, 0.7, 0.3))
  return bounds
}

