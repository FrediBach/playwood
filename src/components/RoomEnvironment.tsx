import { useEffect, useMemo } from 'react'
import { getRoomLayout } from './room-layout'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'

RectAreaLightUniformsLib.init()

type Triple = [number, number, number]

function floorTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const ctx = canvas.getContext('2d')!
  for (let row = 0; row < 12; row++) {
    const y = row * 1024 / 12
    const shade = Math.sin(row * 12.65) * 6
    ctx.fillStyle = `rgb(${173 + shade}, ${145 + shade}, ${109 + shade})`
    ctx.fillRect(0, y, 1024, 1024 / 12 + 1)
    for (let line = 0; line < 42; line++) {
      ctx.beginPath()
      ctx.strokeStyle = line % 3 === 0 ? 'rgba(96,65,36,0.10)' : 'rgba(246,221,176,0.11)'
      ctx.lineWidth = 0.55 + (line % 4) * 0.25
      const lineY = y + line * 2
      for (let x = 0; x <= 1024; x += 8) {
        const grainY = lineY + Math.sin(x * 0.007 + row * 3) * 1.8 + Math.sin(x * 0.031 + line) * 0.45
        if (x === 0) ctx.moveTo(x, grainY)
        else ctx.lineTo(x, grainY)
      }
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(83,61,37,0.23)'
    ctx.fillRect(0, y, 1024, 1.1)
    ctx.fillStyle = 'rgba(255,236,207,0.22)'
    ctx.fillRect(0, y + 1.1, 1024, 0.9)
    const seam = ((row * 317) % 900) + 50
    ctx.fillStyle = 'rgba(89,62,35,0.2)'
    ctx.fillRect(seam, y, 1.1, 1024 / 12)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function textileTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ded7c8'
  ctx.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 128; i += 2) {
    ctx.fillStyle = i % 4 === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(75,63,45,0.09)'
    ctx.fillRect(i, 0, 1, 128)
    ctx.fillRect(0, i, 128, 1)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(12, 10)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function artworkTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 640
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#eee9df'
  ctx.fillRect(0, 0, 512, 640)
  ctx.fillStyle = '#a86647'
  ctx.beginPath()
  ctx.arc(309, 228, 117, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#b6ac8e'
  ctx.beginPath()
  ctx.roundRect(82, 202, 178, 347, [89, 89, 0, 0])
  ctx.fill()
  ctx.strokeStyle = '#494c42'
  ctx.lineWidth = 5
  for (let i = 0; i < 7; i++) {
    ctx.beginPath()
    ctx.roundRect(172 + i * 13, 345 - i * 12, 230 - i * 26, 270, [80, 80, 0, 0])
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function Box({ position, size, color, radius = 0, rotation, roughness = 0.85, metalness = 0 }: {
  position: Triple; size: Triple; color: string; radius?: number; rotation?: Triple; roughness?: number; metalness?: number
}) {
  const material = <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
  return radius > 0
    ? <RoundedBox position={position} args={size} radius={radius} smoothness={3} rotation={rotation} castShadow receiveShadow>{material}</RoundedBox>
    : <mesh position={position} rotation={rotation} castShadow receiveShadow><boxGeometry args={size} />{material}</mesh>
}

function LoungeChair({ position }: { position: Triple }) {
  return <group position={position} rotation={[0, -0.2, 0]} name="Lounge chair, 43 cm seat height">
    {[-1, 1].flatMap(x => [-1, 1].map(z => <Box key={`${x}-${z}`} position={[x * 0.29, 0.16, z * 0.275]} size={[0.045, 0.32, 0.045]} color="#68513b" radius={0.008} rotation={[z * 0.06, 0, -x * 0.06]} />))}
    <Box position={[0, 0.325, 0]} size={[0.78, 0.13, 0.76]} color="#ae9b81" radius={0.045} />
    <Box position={[0, 0.395, 0.015]} size={[0.61, 0.07, 0.65]} color="#c6b79f" radius={0.03} />
    <Box position={[0, 0.64, -0.29]} size={[0.76, 0.46, 0.14]} color="#b3a18b" radius={0.06} rotation={[-0.13, 0, 0]} />
    <Box position={[0, 0.635, -0.195]} size={[0.58, 0.35, 0.095]} color="#c6b79f" radius={0.045} rotation={[-0.13, 0, 0]} />
    {[-1, 1].map(side => <Box key={side} position={[side * 0.35, 0.5, 0]} size={[0.12, 0.26, 0.74]} color="#b9a88f" radius={0.055} />)}
    <Box position={[0.14, 0.57, -0.05]} size={[0.3, 0.29, 0.105]} color="#62705d" radius={0.045} rotation={[-0.25, -0.15, -0.12]} />
  </group>
}

function FloorLamp({ position }: { position: Triple }) {
  return <group position={position} name="Floor lamp, 165 cm high">
    <mesh position={[0, 0.018, 0]} castShadow receiveShadow><cylinderGeometry args={[0.18, 0.19, 0.036, 48]} /><meshStandardMaterial color="#343834" roughness={0.65} /></mesh>
    <mesh position={[0, 0.738, 0]} castShadow><cylinderGeometry args={[0.012, 0.012, 1.44, 16]} /><meshStandardMaterial color="#43473e" roughness={0.5} metalness={0.25} /></mesh>
    <mesh position={[0, 1.4, 0]} castShadow><sphereGeometry args={[0.25, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#ece4cf" roughness={0.66} side={THREE.DoubleSide} /></mesh>
    <mesh position={[0, 1.4, 0]}><cylinderGeometry args={[0.246, 0.246, 0.012, 40]} /><meshStandardMaterial color="#fff3d4" emissive="#ffd891" emissiveIntensity={0.4} roughness={0.9} /></mesh>
    <pointLight position={[0, 1.37, 0]} color="#ffdcb2" intensity={0.7} distance={2.5} decay={2} />
  </group>
}

function Plant({ position }: { position: Triple }) {
  const branches = useMemo(() => Array.from({ length: 15 }, (_, i) => {
    const angle = i * 2.4
    const height = 0.55 + i * 0.065
    const radius = 0.23 + Math.sin(i * 1.3) * 0.09
    const tip = new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius)
    const start = new THREE.Vector3(0, height - 0.24, 0)
    const delta = tip.clone().sub(start)
    return { tip, middle: start.add(tip).multiplyScalar(0.5), length: delta.length(), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()), angle }
  }), [])
  return <group position={position} name="Indoor ficus">
    <mesh position={[0, 0.185, 0]} castShadow receiveShadow><cylinderGeometry args={[0.205, 0.15, 0.37, 48]} /><meshStandardMaterial color="#c3b5a0" roughness={0.95} /></mesh>
    <mesh position={[0, 0.371, 0]}><cylinderGeometry args={[0.192, 0.192, 0.008, 32]} /><meshStandardMaterial color="#4c4231" roughness={1} /></mesh>
    <mesh position={[0, 0.91, 0]} castShadow><cylinderGeometry args={[0.009, 0.02, 1.08, 10]} /><meshStandardMaterial color="#6e5e3c" roughness={1} /></mesh>
    {branches.map((branch, i) => <group key={i}>
      <mesh position={branch.middle} quaternion={branch.quaternion} castShadow><cylinderGeometry args={[0.003, 0.005, branch.length, 6]} /><meshStandardMaterial color="#6b7247" roughness={1} /></mesh>
      <mesh position={branch.tip} rotation={[0.35 + Math.sin(i) * 0.4, -branch.angle, 0.25]} scale={[0.095, 0.027, 0.18]} castShadow receiveShadow><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color={i % 3 === 0 ? '#76805a' : i % 3 === 1 ? '#536748' : '#637750'} roughness={0.8} /></mesh>
    </group>)}
  </group>
}

function SideTable({ position }: { position: Triple }) {
  return <group position={position} name="Side table">
    <mesh position={[0, 0.235, 0]} castShadow receiveShadow><cylinderGeometry args={[0.105, 0.13, 0.47, 40]} /><meshStandardMaterial color="#9a6d4b" roughness={0.75} /></mesh>
    <mesh position={[0, 0.49, 0]} castShadow receiveShadow><cylinderGeometry args={[0.235, 0.235, 0.04, 48]} /><meshStandardMaterial color="#ad815b" roughness={0.65} /></mesh>
    <Box position={[-0.03, 0.52, 0.015]} size={[0.19, 0.023, 0.14]} color="#e5ddd0" rotation={[0, 0.1, 0]} />
    <Box position={[-0.03, 0.534, 0.015]} size={[0.19, 0.005, 0.14]} color="#667161" rotation={[0, 0.1, 0]} />
    <mesh position={[0.07, 0.563, -0.07]} castShadow><cylinderGeometry args={[0.035, 0.029, 0.1, 24]} /><meshStandardMaterial color="#ece6d9" roughness={0.45} /></mesh>
  </group>
}

function Curtain({ position, height }: { position: Triple; height: number }) {
  const geometry = useMemo(() => {
    const mesh = new THREE.PlaneGeometry(0.58, height, 36, 1)
    const positions = mesh.attributes.position
    for (let i = 0; i < positions.count; i++) positions.setZ(i, Math.cos((positions.getX(i) + 0.29) * 65) * 0.035)
    mesh.computeVertexNormals()
    return mesh
  }, [height])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh position={position} rotation={[0, Math.PI / 2, 0]} geometry={geometry} castShadow receiveShadow><meshStandardMaterial color="#e7dfd1" roughness={1} side={THREE.DoubleSide} /></mesh>
}

export function RoomEnvironment({ bounds }: { bounds: THREE.Box3 }) {
  const layout = getRoomLayout(bounds)
  const { floorY, leftX, rightX, backZ, width, depth, height, chairX, chairZ } = layout
  const centerX = (leftX + rightX) / 2
  const centerZ = backZ + depth / 2
  const oak = useMemo(floorTexture, [])
  const linen = useMemo(textileTexture, [])
  const art = useMemo(artworkTexture, [])
  useEffect(() => () => { oak.dispose(); linen.dispose(); art.dispose() }, [oak, linen, art])
  useEffect(() => { oak.repeat.set(width / 2.4, depth / 2.4) }, [oak, width, depth])
  const lightTarget = useMemo(() => new THREE.Object3D(), [])
  const furnitureCenterZ = (bounds.min.z + bounds.max.z) / 2
  useEffect(() => { lightTarget.position.set(layout.centerX, floorY + 0.55, furnitureCenterZ) }, [lightTarget, layout.centerX, floorY, furnitureCenterZ])
  const windowZ = backZ + 2.1
  const windowWidth = 2.4
  const windowHeight = 2.25
  const windowBottom = 0.35
  const artY = Math.max(1.85, bounds.max.y - floorY + 0.65)
  const rugWidth = Math.max(2.5, bounds.max.x - bounds.min.x + 1.3)
  const rugDepth = Math.max(1.8, bounds.max.z - bounds.min.z + 1.3)
  return <group name="Modern home">
    <ambientLight intensity={0.28} color="#fff5e4" />
    <hemisphereLight args={['#edf3ff', '#b69c7a', 0.85]} />
    <primitive object={lightTarget} />
    <directionalLight position={[leftX + 0.5, floorY + 5.5, backZ + 4]} target={lightTarget} color="#fff1d8" intensity={2.8} castShadow
      shadow-mapSize={[2048, 2048]} shadow-bias={-0.00015} shadow-normalBias={0.002} shadow-radius={4}
      shadow-camera-left={-width} shadow-camera-right={width} shadow-camera-top={height + 2} shadow-camera-bottom={-height - 2} shadow-camera-near={0.1} shadow-camera-far={Math.max(30, width * 3)} />
    <rectAreaLight position={[leftX + 0.15, floorY + 1.7, windowZ]} rotation={[0, -Math.PI / 2, 0]} width={windowWidth} height={windowHeight} color="#f4f7ff" intensity={3} />
    <directionalLight position={[rightX, floorY + 3, backZ + 4]} target={lightTarget} color="#fff7e9" intensity={0.4} />

    <mesh position={[centerX, floorY - 0.006, centerZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} /><meshStandardMaterial map={oak} bumpMap={oak} bumpScale={0.003} roughness={0.72} />
    </mesh>
    {/* A single-sided ceiling fills the upper view from inside the room while
        allowing an elevated orbit to see through it. It does not block daylight. */}
    <mesh position={[centerX, floorY + height, centerZ]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} /><meshStandardMaterial color="#edeae3" emissive="#edeae3" emissiveIntensity={0.65} roughness={1} />
    </mesh>
    <Box position={[centerX, floorY + height / 2, backZ - 0.09]} size={[width, height, 0.18]} color="#e5e1d7" />
    <Box position={[centerX, floorY + 0.055, backZ + 0.012]} size={[width, 0.11, 0.027]} color="#eee9df" />

    {/* The left wall is built around a real opening; daylight remains spatial. */}
    <Box position={[leftX - 0.09, floorY + windowBottom / 2, centerZ]} size={[0.18, windowBottom, depth]} color="#e9e5dc" />
    <Box position={[leftX - 0.09, floorY + (windowBottom + windowHeight + height) / 2, centerZ]} size={[0.18, height - windowBottom - windowHeight, depth]} color="#e9e5dc" />
    <Box position={[leftX - 0.09, floorY + (windowBottom + windowHeight / 2), (backZ + windowZ - windowWidth / 2) / 2]} size={[0.18, windowHeight, windowZ - windowWidth / 2 - backZ]} color="#e9e5dc" />
    <Box position={[leftX - 0.09, floorY + (windowBottom + windowHeight / 2), (windowZ + windowWidth / 2 + backZ + depth) / 2]} size={[0.18, windowHeight, backZ + depth - windowZ - windowWidth / 2]} color="#e9e5dc" />
    <Box position={[leftX + 0.012, floorY + 0.055, centerZ]} size={[0.027, 0.11, depth]} color="#eee9df" />
    <mesh position={[leftX - 0.13, floorY + windowBottom + windowHeight / 2, windowZ]} rotation={[0, Math.PI / 2, 0]}>
      <planeGeometry args={[windowWidth, windowHeight]} /><meshBasicMaterial color="#d9e5e8" />
    </mesh>
    {[windowZ - windowWidth / 2, windowZ, windowZ + windowWidth / 2].map(z => <Box key={z} position={[leftX, floorY + windowBottom + windowHeight / 2, z]} size={[0.055, windowHeight + 0.04, 0.035]} color="#6c716c" />)}
    {[windowBottom, windowBottom + windowHeight].map(y => <Box key={y} position={[leftX, floorY + y, windowZ]} size={[0.055, 0.035, windowWidth + 0.04]} color="#6c716c" />)}
    <Box position={[leftX + 0.04, floorY + windowBottom - 0.012, windowZ]} size={[0.23, 0.035, windowWidth + 0.15]} color="#eeebe1" />
    <Curtain position={[leftX + 0.14, floorY + 1.41, windowZ - windowWidth / 2 - 0.12]} height={2.72} />
    <Curtain position={[leftX + 0.14, floorY + 1.41, windowZ + windowWidth / 2 + 0.12]} height={2.72} />

    <mesh position={[layout.centerX + 0.12, floorY + 0.004, furnitureCenterZ + 0.16]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[rugWidth, rugDepth]} /><meshStandardMaterial map={linen} roughness={1} bumpMap={linen} bumpScale={0.004} color="#ded5c2" />
    </mesh>
    <Box position={[layout.centerX - 0.05, floorY + artY, backZ + 0.035]} size={[0.85, 1.05, 0.045]} color="#66543f" />
    <mesh position={[layout.centerX - 0.05, floorY + artY, backZ + 0.059]} receiveShadow><planeGeometry args={[0.806, 1.006]} /><meshStandardMaterial map={art} roughness={1} /></mesh>

    <LoungeChair position={[chairX, floorY, chairZ]} />
    <FloorLamp position={[chairX + 0.63, floorY, chairZ - 0.34]} />
    <SideTable position={[chairX + 0.68, floorY, chairZ + 0.42]} />
    <Plant position={[bounds.min.x - 0.7, floorY, bounds.min.z + 0.12]} />
  </group>
}
