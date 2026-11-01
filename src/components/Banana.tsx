import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

// Dimensions are in metres, like the rest of the room. The peel rests at y=0.
function bananaGeometry() {
  const segments = 80
  const sides = 40
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const color = new THREE.Color()
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const x = -0.11 + 0.22 * t
    const z = 0.052 * Math.pow(2 * t - 1, 2)
    const tangent = new THREE.Vector3(0.22, 0, 0.208 * (2 * t - 1)).normalize()
    const sideways = new THREE.Vector3(-tangent.z, 0, tangent.x)
    // A plump body tapers into a narrow stalk at one end and a blossom tip at the other.
    const body = Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.91)), 0.48)
    const radius = t > 0.91 ? 0.0045 * (1 - (t - 0.91) * 4) : 0.003 + 0.015 * body
    const y = 0.018 + 0.008 * Math.pow(2 * t - 1, 4)
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * Math.PI * 2
      const ridge = 1 + 0.055 * Math.cos(5 * angle)
      positions.push(x + sideways.x * Math.cos(angle) * radius * ridge,
        y + Math.sin(angle) * radius,
        z + sideways.z * Math.cos(angle) * radius * ridge)
      const noise = Math.sin(i * 127.1 + (j % sides) * 311.7) * 43758.5453
      const fleck = noise - Math.floor(noise)
      if (t < 0.025 || t > 0.985) color.set('#51351c')
      else if (t > 0.91) color.set('#8d8735')
      else {
        color.set('#e8be32')
        color.lerp(new THREE.Color('#f7dc60'), 0.25 + 0.2 * Math.cos(5 * angle))
        if (fleck > 0.965) color.lerp(new THREE.Color('#88602b'), 0.45)
        if (t > 0.84) color.lerp(new THREE.Color('#9d9b3b'), (t - 0.84) * 5)
      }
      colors.push(color.r, color.g, color.b)
      if (i < segments && j < sides) {
        const a = i * (sides + 1) + j
        const b = a + sides + 1
        indices.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
  }
  // Close the tiny ends so the fruit remains solid from every orbit angle.
  for (let j = 1; j < sides - 1; j++) {
    indices.push(0, j, j + 1)
    const end = segments * (sides + 1)
    indices.push(end, end + j + 1, end + j)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function Banana() {
  const geometry = useMemo(bananaGeometry, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh name="Banana, 22 cm long" position={[0.015, 0.51, 0.115]} rotation={[0, -0.18, 0]} geometry={geometry} castShadow receiveShadow>
    <meshStandardMaterial vertexColors roughness={0.72} />
  </mesh>
}
