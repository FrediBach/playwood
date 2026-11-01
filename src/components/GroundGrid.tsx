import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import { CanvasTexture, Sprite, SRGBColorSpace, Vector3 } from 'three'
import type { Vec3 } from '@/lib/types'

function MeterMark({ position, label }: { position: Vec3; label: string }) {
  const sprite = useRef<Sprite>(null)
  const direction = useRef(new Vector3())
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    const font = '600 33px system-ui, sans-serif'
    context.font = font
    canvas.width = Math.ceil(context.measureText(label).width) + 30
    canvas.height = 60
    context.font = font
    context.fillStyle = 'rgba(238, 237, 232, 0.88)'
    context.beginPath()
    context.roundRect(0, 0, canvas.width, canvas.height, 9)
    context.fill()
    context.fillStyle = '#58634e'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label, canvas.width / 2, canvas.height / 2)
    const map = new CanvasTexture(canvas)
    map.colorSpace = SRGBColorSpace
    return map
  }, [label])
  useEffect(() => () => texture.dispose(), [texture])
  useFrame(({ camera, viewport, size }) => {
    if (!sprite.current) return
    // Ground labels overlap when the floor is viewed edge-on.
    sprite.current.visible = camera.getWorldDirection(direction.current).y < -0.08
    // Keep the lettering at 11 screen pixels as the camera zooms or changes view.
    const factor = size.width / viewport.getCurrentViewport(camera, sprite.current.position, size).width * 3
    sprite.current.scale.set(texture.image.width / factor, texture.image.height / factor, 1)
  })
  return <sprite ref={sprite} name={`ground-grid-label-${label}`} position={position} center={[0.5, 0]} raycast={() => null}>
    <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
  </sprite>
}

export function GroundGrid({ floorY, extent, cellSize }: { floorY: number; extent: number; cellSize: number }) {
  const radius = Math.min(20, Math.max(3, Math.ceil(extent)))
  const meters = Array.from({ length: radius * 2 + 1 }, (_, index) => index - radius).filter(meter => meter !== 0)
  const labelY = floorY + 0.004
  return <group>
    <Grid name="studio-ground-grid" position={[0, floorY, 0]} args={[extent, extent]} cellSize={cellSize} sectionSize={1}
      cellThickness={0.8} sectionThickness={1.3} cellColor="#aeb4a5" sectionColor="#858e7a"
      fadeDistance={Math.max(6, extent * 1.2)} fadeStrength={1.2} fadeFrom={0} infiniteGrid raycast={() => null} />
    <MeterMark position={[0.065, labelY, 0.065]} label="0 m" />
    {meters.map(meter => <group key={meter}>
      <MeterMark position={[meter, labelY, 0.065]} label={`${meter} m`} />
      <MeterMark position={[0.065, labelY, meter]} label={`${meter} m`} />
    </group>)}
  </group>
}
