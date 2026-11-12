import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FLOOR_LAMP_HEIGHT, pendantLayout, type FloorLampStyle, type PendantStyle, type RoomLighting } from '@/lib/room-lighting'
import type { ResolvedTheme } from '@/lib/preview-furnishing-variation'
import type { WindowOpening } from './RoomWalls'

type Triple = [number, number, number]

/** Emission of a lit shade, scaled with the bulb so a switched-off lamp stays dark. */
const glowStrength = (intensity: number, scale: number) => Math.min(1.6, intensity * scale)

function LampBase({ style }: { style: FloorLampStyle }) {
  const material = <meshStandardMaterial color={style.metal} roughness={0.55} metalness={style.metalness} />
  switch (style.base) {
    case 'disc': return <mesh position={[0, 0.018, 0]} castShadow receiveShadow><cylinderGeometry args={[0.18, 0.19, 0.036, 48]} /><meshStandardMaterial color="#343834" roughness={0.65} /></mesh>
    case 'block': return <mesh position={[0, 0.03, 0]} castShadow receiveShadow><boxGeometry args={[0.26, 0.06, 0.26]} /><meshStandardMaterial color="#d9d5cc" roughness={0.35} /></mesh>
    case 'tripod': return <>{[0, 1, 2].map(index => {
      // Legs splay from 85 cm down to a 34 cm footprint, inside the vacuum's clearance.
      const angle = index * Math.PI * 2 / 3 + 0.4, spread = 0.17, top = 0.85
      const length = Math.hypot(spread, top), tilt = Math.atan2(spread, top)
      return <mesh key={index} position={[Math.cos(angle) * spread / 2, top / 2, Math.sin(angle) * spread / 2]} rotation={[0, -angle, tilt]} castShadow>
        <cylinderGeometry args={[0.011, 0.014, length, 10]} />{material}
      </mesh>
    })}</>
  }
}

function LampShade({ style }: { style: FloorLampStyle }) {
  const lit = style.intensity > 0
  const outer = <meshStandardMaterial color={style.shadeColor} roughness={0.66} side={THREE.DoubleSide}
    emissive={style.glow} emissiveIntensity={lit ? glowStrength(style.intensity, 0.12) : 0} />
  const inner = <meshStandardMaterial color="#fff3d4" emissive={style.glow} emissiveIntensity={lit ? glowStrength(style.intensity, 0.55) : 0} roughness={0.9} />
  const top = FLOOR_LAMP_HEIGHT
  switch (style.shade) {
    case 'dome': return <>
      <mesh position={[0, top - 0.25, 0]} castShadow><sphereGeometry args={[0.25, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />{outer}</mesh>
      <mesh position={[0, top - 0.25, 0]}><cylinderGeometry args={[0.246, 0.246, 0.012, 40]} />{inner}</mesh>
    </>
    case 'drum': return <>
      <mesh position={[0, top - 0.15, 0]} castShadow><cylinderGeometry args={[0.22, 0.22, 0.3, 48, 1, true]} />{outer}</mesh>
      <mesh position={[0, top - 0.29, 0]}><cylinderGeometry args={[0.215, 0.215, 0.006, 40]} />{inner}</mesh>
    </>
    case 'cone': return <>
      <mesh position={[0, top - 0.16, 0]} castShadow><cylinderGeometry args={[0.12, 0.235, 0.32, 48, 1, true]} />{outer}</mesh>
      <mesh position={[0, top - 0.3, 0]}><cylinderGeometry args={[0.225, 0.225, 0.006, 40]} />{inner}</mesh>
    </>
    case 'globe': return <mesh position={[0, top - 0.17, 0]} castShadow>
      <sphereGeometry args={[0.17, 40, 28]} />
      <meshStandardMaterial color={style.shadeColor} roughness={0.4} emissive={style.glow} emissiveIntensity={lit ? glowStrength(style.intensity, 0.45) : 0.02} />
    </mesh>
  }
}

/** A floor lamp whose shade top stays at the 165 cm scale reference. */
export function FloorLamp({ position, style }: { position: Triple; style: FloorLampStyle }) {
  const stemTop = FLOOR_LAMP_HEIGHT - (style.shade === 'globe' ? 0.3 : 0.25)
  const stemBottom = style.base === 'tripod' ? 0.85 : 0.03
  const lightY = FLOOR_LAMP_HEIGHT - (style.shade === 'globe' ? 0.17 : 0.28)
  return <group position={position} name={`Floor lamp, 165 cm high, ${style.shade} shade`}>
    <LampBase style={style} />
    <mesh position={[0, (stemTop + stemBottom) / 2, 0]} castShadow><cylinderGeometry args={[0.012, 0.012, stemTop - stemBottom, 16]} /><meshStandardMaterial color={style.metal} roughness={0.5} metalness={style.metalness} /></mesh>
    {style.base === 'tripod' && <mesh position={[0, stemBottom, 0]}><sphereGeometry args={[0.022, 16, 12]} /><meshStandardMaterial color={style.metal} roughness={0.5} metalness={style.metalness} /></mesh>}
    <LampShade style={style} />
    {/* Always mounted so switching moods does not change the shader light count. */}
    <pointLight position={[0, lightY, 0]} color={style.glow} intensity={style.intensity} distance={4} decay={2} />
  </group>
}

function PendantShade({ style, barLength }: { style: PendantStyle; barLength: number }) {
  const { size, color, metalness, glow, intensity } = style
  const lit = intensity > 0
  const shell = <meshStandardMaterial color={color} roughness={metalness > 0 ? 0.4 : 0.7} metalness={metalness} side={THREE.DoubleSide} />
  const bulb = <meshStandardMaterial color="#fff6e0" emissive={glow} emissiveIntensity={lit ? glowStrength(intensity, 0.8) : 0} roughness={0.5} />
  const opal = (shade: string, scale: number) => <meshStandardMaterial color={shade} roughness={0.45} emissive={glow} emissiveIntensity={lit ? glowStrength(intensity, scale) : 0.02} />
  switch (style.kind) {
    // Every shade's top is at y = 0; the cord continues upwards.
    case 'globe': return <mesh position={[0, -size, 0]} castShadow><sphereGeometry args={[size, 36, 24]} />{opal(color, 0.45)}</mesh>
    case 'lantern': return <group position={[0, -size * 0.9, 0]}>
      <mesh scale={[1, 0.9, 1]} castShadow><sphereGeometry args={[size, 32, 20]} />{opal(color, 0.55)}</mesh>
      {[-0.5, 0, 0.5].map(y => <mesh key={y} position={[0, y * size * 0.9, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[size * Math.sqrt(1 - y * y) * 1.003, 0.0015, 4, 48]} /><meshStandardMaterial color="#ffffff" roughness={0.8} /></mesh>)}
    </group>
    case 'dome': return <group position={[0, -size * 0.6, 0]}>
      <mesh castShadow scale={[1, 0.6, 1]}><sphereGeometry args={[size, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />{shell}</mesh>
      <mesh position={[0, -0.01, 0]}><sphereGeometry args={[size * 0.22, 16, 12]} />{bulb}</mesh>
    </group>
    case 'bell': return <group position={[0, -size * 0.7, 0]}>
      <mesh castShadow><cylinderGeometry args={[size * 0.32, size, size * 1.4, 40, 1, true]} />{shell}</mesh>
      <mesh position={[0, -size * 0.45, 0]}><sphereGeometry args={[size * 0.25, 16, 12]} />{bulb}</mesh>
    </group>
    case 'cone': return <group position={[0, -size * 0.8, 0]}>
      <mesh castShadow><cylinderGeometry args={[size * 0.12, size, size * 1.6, 40, 1, true]} />{shell}</mesh>
      <mesh position={[0, -size * 0.65, 0]}><cylinderGeometry args={[size * 0.95, size * 0.95, 0.004, 32]} />{bulb}</mesh>
    </group>
    case 'drum': return <group position={[0, -size * 0.45, 0]}>
      <mesh castShadow><cylinderGeometry args={[size, size, size * 0.9, 48, 1, true]} />
        <meshStandardMaterial color={color} roughness={0.9} side={THREE.DoubleSide} emissive={glow} emissiveIntensity={lit ? glowStrength(intensity, 0.14) : 0} />
      </mesh>
      <mesh position={[0, -size * 0.43, 0]}><cylinderGeometry args={[size * 0.98, size * 0.98, 0.004, 40]} />{bulb}</mesh>
    </group>
    case 'bar': return <group position={[0, -0.025, 0]}>
      <mesh castShadow><boxGeometry args={[barLength, 0.04, 0.07]} />{shell}</mesh>
      <mesh position={[0, -0.021, 0]}><boxGeometry args={[barLength - 0.02, 0.002, 0.055]} />{bulb}</mesh>
    </group>
  }
}

/** Ceiling pendants; returns their light position for the evening key light. */
function usePendants(style: PendantStyle, theme: ResolvedTheme, bounds: THREE.Box3, floorY: number, ceiling: number) {
  const { min, max } = bounds
  return useMemo(() => pendantLayout(style, theme, { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z, top: max.y - floorY }, ceiling),
    [style, theme, min.x, max.x, min.z, max.z, max.y, floorY, ceiling])
}

function Pendants({ style, layout, floorY, ceiling }: { style: PendantStyle; layout: ReturnType<typeof pendantLayout>; floorY: number; ceiling: number }) {
  const { positions, bottom, shadeHeight, barLength } = layout
  const shadeTop = bottom + shadeHeight
  const cord = ceiling - shadeTop
  const centre = positions.reduce((sum, { x, z }) => [sum[0] + x / positions.length, sum[1] + z / positions.length], [0, 0])
  // Bars hang from two cables at their ends.
  const cables = style.kind === 'bar' ? [-barLength / 2 + 0.05, barLength / 2 - 0.05] : [0]
  return <group name={`Ceiling pendant${positions.length > 1 ? `s, ${positions.length}` : ''}, ${style.kind}`}>
    {positions.map(({ x, z }) => <group key={`${x}:${z}`} position={[x, floorY + shadeTop, z]}>
      {cables.map(offset => <group key={offset}>
        <mesh position={[offset, cord / 2, 0]}><cylinderGeometry args={[0.003, 0.003, cord, 6]} /><meshStandardMaterial color={style.cord} roughness={0.6} /></mesh>
        <mesh position={[offset, cord - 0.012, 0]}><cylinderGeometry args={[0.045, 0.045, 0.024, 24]} /><meshStandardMaterial color={style.cord} roughness={0.5} /></mesh>
      </group>)}
      <PendantShade style={style} barLength={barLength} />
    </group>)}
    {/* One light for the whole group keeps the shader light count constant. */}
    <pointLight position={[centre[0], floorY + bottom - 0.04, centre[1]]} color={style.glow} intensity={style.intensity} distance={5} decay={2} />
  </group>
}

const SHAFT_SLICES = 5
/** Metres from the window to the sun's spot light; far enough for near-parallel rays. */
const SUN_DISTANCE = 14

const shaftVertex = /* glsl */`
attribute float weight;
varying vec2 vUv;
varying float vWeight;
varying float vFacing;
void main() {
  vUv = uv;
  vWeight = weight;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vec3 normal = normalize(normalMatrix * normal);
  // Slices seen edge-on would show as bright lines; fade them out.
  vFacing = abs(dot(normal, normalize(-view.xyz)));
  gl_Position = projectionMatrix * view;
}`

const shaftFragment = /* glsl */`
uniform vec3 color;
uniform float strength;
varying vec2 vUv;
varying float vWeight;
varying float vFacing;
void main() {
  float across = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
  // Uneven streaks read as rays through dust rather than a flat slab.
  across *= 0.7 + 0.3 * sin(vUv.x * 23.0 + vWeight * 31.0) * sin(vUv.x * 9.0 - vWeight * 17.0);
  float along = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, 1.4);
  float alpha = strength * vWeight * across * along * smoothstep(0.05, 0.45, vFacing);
  gl_FragColor = vec4(color * alpha, 1.0);
}`

/**
 * Sunbeams through hazy air: a few additive slices swept from the window along
 * the light. One static draw call with no textures, so it costs almost nothing.
 */
function WindowLightShafts({ leftX, floorY, window, direction, color, strength }: {
  leftX: number; floorY: number; window: WindowOpening; direction: THREE.Vector3; color: string; strength: number
}) {
  const { x: dx, y: dy, z: dz } = direction
  const geometry = useMemo(() => {
    // Travel until the window's top edge reaches the floor, at most 7 m.
    const top = window.bottom + window.height
    const length = dy < -0.05 ? Math.min(7, top / -dy) : 7
    const positions: number[] = [], uvs: number[] = [], weights: number[] = [], indices: number[] = []
    for (let slice = 0; slice < SHAFT_SLICES; slice++) {
      const t = (slice + 0.5) / SHAFT_SLICES
      const z = window.z - window.width / 2 + t * window.width
      const base = positions.length / 3
      for (const [along, up] of [[0, 0], [0, 1], [1, 1], [1, 0]]) {
        const y = floorY + window.bottom + up * window.height
        positions.push(leftX + along * length * dx, y + along * length * dy, z + along * length * dz)
        uvs.push(up, along)
        // Deterministic per-slice variation; it also phases the streaks.
        weights.push(Math.sin(Math.PI * t) * (0.65 + 0.35 * Math.abs(Math.sin(slice * 12.9898))))
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    const shafts = new THREE.BufferGeometry()
    shafts.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    shafts.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    shafts.setAttribute('weight', new THREE.Float32BufferAttribute(weights, 1))
    shafts.setIndex(indices)
    shafts.computeVertexNormals()
    return shafts
  }, [leftX, floorY, window, dx, dy, dz])
  useEffect(() => () => geometry.dispose(), [geometry])
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, strength: { value: 0 } },
    vertexShader: shaftVertex, fragmentShader: shaftFragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }), [])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    material.uniforms.color.value.set(color)
    material.uniforms.strength.value = strength / SHAFT_SLICES * 3.6
  }, [material, color, strength])
  // Shader effects do not survive glTF export; the GLB omits the beams.
  return <mesh name="Window light shafts" geometry={geometry} material={material} raycast={() => null} renderOrder={2} visible={strength > 0} userData={{ previewOnly: true }} />
}

/** Sets the renderer exposure for the room, restoring it when the room closes. */
function Exposure({ value }: { value: number }) {
  const gl = useThree(state => state.gl)
  const invalidate = useThree(state => state.invalidate)
  useEffect(() => {
    const previous = gl.toneMappingExposure
    gl.toneMappingExposure = value
    invalidate()
    return () => { gl.toneMappingExposure = previous; invalidate() }
  }, [gl, value, invalidate])
  return null
}

export interface RoomLightsProps {
  lighting: RoomLighting
  theme: ResolvedTheme
  bounds: THREE.Box3
  floorY: number
  leftX: number
  width: number
  height: number
  window: WindowOpening
  lampPosition: Triple
  /** A sheer curtain diffuses the beams. */
  sheer: boolean
}

export function RoomLights({ lighting, theme, bounds, floorY, leftX, width, height, window, lampPosition, sheer }: RoomLightsProps) {
  const { sun, haze } = lighting
  const pendants = usePendants(lighting.pendant, theme, bounds, floorY, height)
  const targetX = (bounds.min.x + bounds.max.x) / 2, targetZ = (bounds.min.z + bounds.max.z) / 2
  // Daylight is a distant, narrow spot aimed through a point in the window at
  // the creation: rays are nearly parallel, the walls shape a window-shaped
  // patch of sun, and the shadow map only spends its resolution on the beam.
  // After dark the key light is the pendant's downlight instead.
  const key = useMemo(() => {
    const target = new THREE.Vector3(targetX, floorY + 0.55, targetZ)
    if (sun.source === 'window') {
      const aim = new THREE.Vector3(leftX, floorY + sun.aim, window.z + sun.offset)
      const toSource = aim.clone().sub(target)
      const span = toSource.length()
      toSource.normalize()
      const far = SUN_DISTANCE + span
      // Wide enough to cover the whole window from the aim point, plus a soft edge.
      const reach = Math.max(...[window.bottom, window.bottom + window.height].flatMap(y => [-1, 1].map(side =>
        Math.hypot(y - sun.aim, window.z + side * window.width / 2 - aim.z)))) + 0.5
      return {
        position: target.clone().addScaledVector(toSource, far).toArray() as Triple, direction: toSource.clone().negate(),
        angle: Math.atan(reach / SUN_DISTANCE), penumbra: 0.15, decay: 0, intensity: sun.intensity, near: SUN_DISTANCE - 1.5, far: far + width + height,
      }
    }
    const { positions, bottom } = pendants
    const source = new THREE.Vector3(positions[0].x, floorY + bottom - 0.05, positions[0].z)
    const toSource = source.clone().sub(target)
    const span = toSource.length()
    const halfWidth = (bounds.max.x - bounds.min.x) / 2 + 0.8
    // Candela giving the mood's illuminance at the creation.
    return {
      position: source.toArray() as Triple, direction: toSource.normalize().negate(),
      angle: THREE.MathUtils.clamp(Math.atan(halfWidth / span), 0.6, 1.15), penumbra: 0.7, decay: 2, intensity: sun.intensity * span * span, near: 0.05, far: span + height + 4,
    }
  }, [targetX, targetZ, floorY, leftX, width, height, window, sun.source, sun.aim, sun.offset, sun.intensity, pendants, bounds])
  const target = useMemo(() => new THREE.Object3D(), [])
  useEffect(() => { target.position.set(targetX, floorY + 0.55, targetZ); target.updateMatrixWorld() }, [target, targetX, targetZ, floorY])
  const shafts = sun.source === 'window' ? haze.shafts * (sheer ? 0.45 : 1) : 0
  return <group name={`Room lighting, ${lighting.mood}`}>
    <Exposure value={lighting.exposure} />
    {haze.density > 0 && <fogExp2 attach="fog" args={[haze.color, haze.density]} />}
    <ambientLight intensity={lighting.ambient.intensity} color={lighting.ambient.color} />
    <hemisphereLight args={[lighting.hemisphere.sky, lighting.hemisphere.ground, lighting.hemisphere.intensity]} />
    <primitive object={target} />
    <spotLight name={sun.source === 'window' ? 'Sunlight' : 'Pendant downlight'} position={key.position} target={target} color={sun.color} intensity={key.intensity}
      angle={key.angle} penumbra={key.penumbra} decay={key.decay} distance={0} castShadow
      shadow-mapSize={[2048, 2048]} shadow-bias={-0.0001} shadow-normalBias={0.003} shadow-camera-near={key.near} shadow-camera-far={key.far} />
    <rectAreaLight position={[leftX + 0.15, floorY + window.bottom + window.height / 2, window.z]} rotation={[0, -Math.PI / 2, 0]} width={window.width} height={window.height}
      color={lighting.window.color} intensity={lighting.window.intensity} />
    <directionalLight name="Room fill" position={[leftX + width, floorY + 3, targetZ + 4]} target={target} color={lighting.fill.color} intensity={lighting.fill.intensity} />
    {/* Mounted while dimmed too, so the shader program is stable across moods. */}
    <WindowLightShafts leftX={leftX} floorY={floorY} window={window} direction={key.direction} color={sun.color} strength={shafts} />
    <FloorLamp position={lampPosition} style={lighting.lamp} />
    <Pendants style={lighting.pendant} layout={pendants} floorY={floorY} ceiling={height} />
  </group>
}
