import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { getConnectorGeometry, type ConnectorPart } from './connector-geometry'

let metalGeometry: ConnectorPart[] | undefined

/** CAD has no UVs. Project each flat face at a consistent 18 mm texture scale. */
export function getMetalConnectorGeometry(): readonly ConnectorPart[] {
  if (!metalGeometry) metalGeometry = getConnectorGeometry('90').map(part => {
    const geometry = part.geometry.clone()
    const positions = geometry.getAttribute('position')
    const uv = new Float32Array(positions.count * 2)
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
    for (let index = 0; index < positions.count; index += 3) {
      a.fromBufferAttribute(positions, index)
      b.fromBufferAttribute(positions, index + 1).sub(a)
      c.fromBufferAttribute(positions, index + 2).sub(a)
      const normal = b.cross(c)
      const axes = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)]
      const dominant = axes.indexOf(Math.max(...axes))
      for (let vertex = index; vertex < index + 3; vertex++) {
        uv[vertex * 2] = (dominant === 0 ? positions.getZ(vertex) : positions.getX(vertex)) / .018
        uv[vertex * 2 + 1] = (dominant === 1 ? positions.getZ(vertex) : positions.getY(vertex)) / .018
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    return { ...part, geometry }
  })
  return metalGeometry
}

function noise(x: number, y: number, period: number) {
  // Periodic, deterministic noise makes the texture tile without a visible seam.
  const hash = (a: number, b: number) => {
    const value = Math.sin(((a % period + period) % period) * 127.1 + ((b % period + period) % period) * 311.7) * 43758.5453
    return value - Math.floor(value)
  }
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
    THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v)
}

/** Shared by all metal pieces in this mesh layer; no downloaded texture/HDR assets. */
export function createConnectorMetalResources(renderer: THREE.WebGLRenderer) {
  const size = 256
  const color = new Uint8Array(size * size * 4), surface = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const coarse = noise(x / 32, y / 32, 8)
    const casting = noise(x / 4, y / 4, 64)
    const grain = noise(x, y, size)
    const tone = Math.round(211 + coarse * 18 + casting * 16 + grain * 10)
    const height = Math.round(65 + casting * 100 + grain * 70)
    const offset = (y * size + x) * 4
    color.set([tone, tone, tone, 255], offset)
    // Red drives bump; green drives roughness, leaving color variation independent.
    surface.set([height, Math.round(172 + casting * 55 + grain * 20), 0, 255], offset)
  }
  const texture = (data: Uint8Array, colorSpace: THREE.ColorSpace) => {
    const map = new THREE.DataTexture(data, size, size)
    map.colorSpace = colorSpace
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.generateMipmaps = true
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    map.needsUpdate = true
    return map
  }
  const map = texture(color, THREE.SRGBColorSpace)
  const surfaceMap = texture(surface, THREE.NoColorSpace)
  // Metals need reflected surroundings as well as direct light. Use a local,
  // prefiltered studio room on the metal only, preserving other scene materials.
  const room = new RoomEnvironment()
  const generator = new THREE.PMREMGenerator(renderer)
  const environment = generator.fromScene(room, .04)
  room.dispose()
  generator.dispose()
  return {
    map, bumpMap: surfaceMap, roughnessMap: surfaceMap, envMap: environment.texture,
    dispose() { map.dispose(); surfaceMap.dispose(); environment.dispose() },
  }
}

export type ConnectorMetalResources = ReturnType<typeof createConnectorMetalResources>
