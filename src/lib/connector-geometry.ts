import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import connectorSource from '../../resources/connectors-3d/Connettori sharing.obj?raw'
import type { ConnectorType, Vec3 } from '@/lib/types'

interface ConnectorProfile {
  objects: readonly number[]
  /** Intersection of the 18 mm panel-slot centerlines in the original CAD export. */
  origin: Vec3
  rotationY: number
}

const profiles: Record<ConnectorType, ConnectorProfile> = {
  '90': { objects: [3, 4], origin: [66.269861, 566.567749, -150.566093], rotationY: -3 * Math.PI / 4 },
  '105': { objects: [1, 2], origin: [294.650577, 566.567749, -154.460632], rotationY: -19 * Math.PI / 24 },
  '150': { objects: [6, 9], origin: [523.412979, 566.567749, -166.605614], rotationY: -11 * Math.PI / 12 },
  t: { objects: [7, 11, 12], origin: [1113.919189, 566.567749, -141.439789], rotationY: Math.PI },
  cross: { objects: [5, 8, 10], origin: [801.126465, 526.567749, -140.727955], rotationY: Math.PI },
}

export interface ConnectorPart {
  name: string
  geometry: THREE.BufferGeometry
}

let connectorGeometry: Record<ConnectorType, ConnectorPart[]> | undefined

/**
 * Shared CAD bodies at their original dimensions. Local +X points into the parent panel, +Z toward
 * the child, and +Y follows the 40 mm joint depth. The origin is the intersection
 * of the panel centerlines. Source millimeters become scene meters here only.
 * Callers must not mutate or dispose these application-lifetime geometries.
 */
export function getConnectorGeometry(type: ConnectorType): readonly ConnectorPart[] {
  if (!connectorGeometry) {
    const source = new OBJLoader().parse(connectorSource)
    connectorGeometry = Object.fromEntries(Object.entries(profiles).map(([key, profile]) => {
      const parts = profile.objects.map((number, index) => {
        const mesh = source.getObjectByName(`object_${number}`)
        if (!(mesh instanceof THREE.Mesh)) throw new Error(`Missing Playwood connector CAD body object_${number}`)
        const geometry = mesh.geometry as THREE.BufferGeometry
        geometry.translate(-profile.origin[0], -profile.origin[1], -profile.origin[2])
        geometry.rotateY(profile.rotationY)
        geometry.scale(0.001, 0.001, 0.001)
        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()
        geometry.name = `Playwood ${key} ${index === 0 ? 'body' : `jaw ${index}`}`
        return { name: mesh.name, geometry }
      })
      return [key, parts]
    })) as Record<ConnectorType, ConnectorPart[]>
    // Materials in this untextured OBJ are loader defaults; the scene supplies
    // the selected connector finish instead.
    source.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach(material => material.dispose())
      }
    })
  }
  return connectorGeometry[type]
}
