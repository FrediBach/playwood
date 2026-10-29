import { describe, expect, it } from 'vitest'
import { Euler, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3, type Camera } from 'three'
import { getPanelMovementDelta } from './panel-movement-direction'
import type { Vec3 } from './types'

const viewport = { width: 1000, height: 700 }
const origin: Vec3 = [0, 0, 0]
const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const

function cameraAt(position: Vec3, perspective = false, up: Vec3 = [0, 1, 0]) {
  const aspect = viewport.width / viewport.height
  const camera = perspective
    ? new PerspectiveCamera(35, aspect, 0.01, 200)
    : new OrthographicCamera(-aspect * 2, aspect * 2, 2, -2, 0.01, 200)
  camera.position.set(...position)
  camera.up.set(...up)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return camera
}

function move(camera: Camera, key: string, options: { shiftKey?: boolean; position?: Vec3; rotation?: Vec3 } = {}) {
  return getPanelMovementDelta({ camera, key, viewport, position: origin, ...options })
}

function expectVector(actual: Vec3 | null, expected: Vec3) {
  expect(actual).not.toBeNull()
  expected.forEach((value, index) => expect(actual![index]).toBeCloseTo(value, 8))
}

function screenDelta(camera: Camera, position: Vec3, delta: Vec3) {
  const start = new Vector3(...position).multiplyScalar(0.001).project(camera)
  const end = new Vector3(...position).add(new Vector3(...delta)).multiplyScalar(0.001).project(camera)
  return { x: (end.x - start.x) * viewport.width, y: (end.y - start.y) * viewport.height }
}

describe('camera-aware panel movement', () => {
  it.each([
    { name: 'front', camera: [0, 0, 5], right: [10, 0, 0], up: [0, 10, 0] },
    { name: 'rear', camera: [0, 0, -5], right: [-10, 0, 0], up: [0, 10, 0] },
    { name: 'right', camera: [5, 0, 0], right: [0, 0, -10], up: [0, 10, 0] },
    { name: 'left', camera: [-5, 0, 0], right: [0, 0, 10], up: [0, 10, 0] },
  ])('uses screen directions from the $name', ({ camera: position, right, up }) => {
    for (const perspective of [false, true]) {
      const camera = cameraAt(position as Vec3, perspective)
      expectVector(move(camera, 'ArrowRight'), right as Vec3)
      expectVector(move(camera, 'ArrowUp'), up as Vec3)
      expectVector(move(camera, 'ArrowLeft'), right.map(value => -value) as Vec3)
      expectVector(move(camera, 'ArrowDown'), up.map(value => -value) as Vec3)
    }
  })

  it('moves in depth when looking down from above or up from below', () => {
    const top = cameraAt([0, 5, 0], false, [0, 0, -1])
    expectVector(move(top, 'ArrowRight'), [10, 0, 0])
    expectVector(move(top, 'ArrowUp'), [0, 0, -10])
    const bottom = cameraAt([0, -5, 0], false, [0, 0, 1])
    expectVector(move(bottom, 'ArrowRight'), [10, 0, 0])
    expectVector(move(bottom, 'ArrowUp'), [0, 0, 10])
  })

  it('handles the near-pole top-view camera used by the scene', () => {
    const camera = cameraAt([0, 5, 0.0001])
    expectVector(move(camera, 'ArrowRight'), [10, 0, 0])
    expectVector(move(camera, 'ArrowUp'), [0, 0, -10])
  })

  it('uses 1 cm normally and 10 cm with Shift along the same axis', () => {
    const camera = cameraAt([4, 2, 3], true)
    const rotation: Vec3 = [0.23, -0.67, 0.19]
    for (const key of keys) {
      const small = move(camera, key, { rotation })!
      const large = move(camera, key, { rotation, shiftKey: true })!
      expect(new Vector3(...small).length()).toBeCloseTo(10, 10)
      expect(new Vector3(...large).length()).toBeCloseTo(100, 10)
      expectVector(large, small.map(value => value * 10) as Vec3)
    }
  })

  it('follows the panel basis after arbitrary whole-creation rotation', () => {
    const rotation: Vec3 = [0.47, 0.92, -0.39]
    const orientation = new Quaternion().setFromEuler(new Euler(...rotation))
    const camera = cameraAt([0, 0, 5])
    camera.position.applyQuaternion(orientation)
    camera.quaternion.premultiply(orientation)
    camera.updateMatrixWorld(true)
    expectVector(move(camera, 'ArrowRight', { rotation }), new Vector3(10, 0, 0).applyQuaternion(orientation).toArray())
    expectVector(move(camera, 'ArrowUp', { rotation }), new Vector3(0, 10, 0).applyQuaternion(orientation).toArray())
  })

  it('keeps horizontal and vertical arrows distinct at a 45-degree roll', () => {
    const camera = cameraAt([0, 0, 5])
    camera.rotateZ(Math.PI / 4)
    camera.updateMatrixWorld(true)
    const right = move(camera, 'ArrowRight')!
    const up = move(camera, 'ArrowUp')!
    expect(new Vector3(...right).dot(new Vector3(...up))).toBeCloseTo(0, 8)
    expect(screenDelta(camera, origin, right).x).toBeGreaterThan(0)
    expect(screenDelta(camera, origin, up).y).toBeGreaterThan(0)
  })

  it('reads the live camera after orbiting, with no view-preset assumption', () => {
    const camera = cameraAt([0, 0, 5], true)
    expectVector(move(camera, 'ArrowRight'), [10, 0, 0])
    camera.position.set(0, 0, -5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    expectVector(move(camera, 'ArrowRight'), [-10, 0, 0])
  })

  it('never follows an almost hidden direction instead of a visible structural axis', () => {
    const camera = cameraAt([0, 0, 5], true)
    expectVector(getPanelMovementDelta({ camera, key: 'ArrowRight', position: origin, viewport,
      axes: [[0.001, 0, 1], [1, 0.1, 0], [0, 1, 0]] }), new Vector3(1, 0.1, 0).setLength(10).toArray())
    expect(getPanelMovementDelta({ camera, key: 'ArrowRight', position: origin, viewport, axes: [[0, 1, 0]] })).toBeNull()
  })

  it('projects at the panel center and keeps opposite keys symmetric in perspective', () => {
    const camera = cameraAt([3, 2, 5], true)
    const position: Vec3 = [900, 500, -250]
    const rotation: Vec3 = [0.4, 0.8, 0.2]
    for (const [positive, negative] of [['ArrowRight', 'ArrowLeft'], ['ArrowUp', 'ArrowDown']]) {
      const delta = move(camera, positive, { position, rotation })!
      expectVector(move(camera, negative, { position, rotation }), delta.map(value => -value) as Vec3)
      const screen = screenDelta(camera, position, delta)
      expect(positive === 'ArrowRight' ? screen.x : screen.y).toBeGreaterThan(0)
    }
  })

  it('keeps both arrow directions available for a foreshortened panel away from screen center', () => {
    const camera = cameraAt([0, 0, 5], true)
    const position: Vec3 = [0, 1000, 0]
    const rotation: Vec3 = [Math.atan(0.2), 0, Math.PI / 4]
    for (const key of keys) {
      const delta = move(camera, key, { position, rotation })
      expect(delta).not.toBeNull()
      const screen = screenDelta(camera, position, delta!)
      const sign = key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 1
      expect((key === 'ArrowLeft' || key === 'ArrowRight' ? screen.x : screen.y) * sign).toBeGreaterThan(0)
    }
  })

  it('keeps the requested direction dominant throughout an orbit around rotated panels', () => {
    for (const perspective of [false, true]) for (const rotation of [[0, 0, 0], [0.47, 0.92, -0.39]] as Vec3[]) {
      for (const elevation of [-1.3, -0.5, 0, 0.5, 1.3]) for (let azimuth = 0; azimuth < Math.PI * 2; azimuth += Math.PI / 8) {
        const camera = cameraAt([5 * Math.cos(elevation) * Math.sin(azimuth), 5 * Math.sin(elevation), 5 * Math.cos(elevation) * Math.cos(azimuth)], perspective)
        for (const key of keys) {
          const delta = move(camera, key, { rotation })
          expect(delta).not.toBeNull()
          const screen = screenDelta(camera, origin, delta!)
          const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
          const sign = key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 1
          const primary = (horizontal ? screen.x : screen.y) * sign
          const secondary = Math.abs(horizontal ? screen.y : screen.x)
          expect(primary).toBeGreaterThan(0)
          expect(primary + 1e-7).toBeGreaterThanOrEqual(secondary)
        }
      }
    }
  })

  it('uses actual viewport proportions when comparing screen directions', () => {
    const camera = cameraAt([0, 0, 5], true)
    const rotation: Vec3 = [0, 0, Math.PI / 3]
    const narrow = { width: 400, height: 1200 }
    if (camera instanceof PerspectiveCamera) camera.aspect = narrow.width / narrow.height
    camera.updateProjectionMatrix()
    expectVector(getPanelMovementDelta({ camera, key: 'ArrowRight', position: origin, rotation, viewport: narrow }),
      new Vector3(0, -10, 0).applyEuler(new Euler(...rotation)).toArray())
  })

  it('ignores non-arrow keys and unusable projections without modifying the camera', () => {
    const camera = cameraAt([0, 0, 5], true)
    const before = camera.toJSON()
    expect(move(camera, 'Enter')).toBeNull()
    expect(move(camera, 'ArrowRight', { position: [0, 0, 6000] })).toBeNull()
    expect(getPanelMovementDelta({ camera, key: 'ArrowRight', position: origin, viewport: { width: 0, height: 700 } })).toBeNull()
    expect(getPanelMovementDelta({ camera, key: 'ArrowRight', position: origin, viewport, axes: [] })).toBeNull()
    move(camera, 'ArrowUp')
    expect(camera.toJSON()).toEqual(before)
  })
})
