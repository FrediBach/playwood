import { describe, expect, it } from 'vitest'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { createPanel } from '@/lib/model'
import { makePanelGeometry } from './scene-geometry'
import type { Pattern } from '@/lib/types'

function rayHits(pattern: Pattern, x: number, y: number, back = false) {
  const geometry = makePanelGeometry(createPanel({ width: 240, height: 240, thickness: 18, holeSize: 12, holeSpacing: 48, pattern }))
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  const ray = new Raycaster(new Vector3(x / 1000, y / 1000, back ? -1 : 1), new Vector3(0, 0, back ? 1 : -1))
  const hit = ray.intersectObject(mesh).length > 0
  geometry.dispose(); material.dispose()
  return hit
}

describe('rendered panel openings', () => {
  it('keeps a solid panel opaque at the hole grid position', () => {
    expect(rayHits('solid', 24, 24)).toBe(true)
  })
  it('cuts a pegboard opening through both faces', () => {
    expect(rayHits('pegboard', 24, 24)).toBe(false)
    expect(rayHits('pegboard', 24, 24, true)).toBe(false)
    expect(rayHits('pegboard', 24, 35)).toBe(true)
  })
  it('cuts elongated slots while keeping material between them', () => {
    expect(rayHits('slots', 24, 24)).toBe(false)
    expect(rayHits('slots', 24, 35)).toBe(false)
    expect(rayHits('slots', 24, 35, true)).toBe(false)
    expect(rayHits('slots', 24, 44)).toBe(true)
  })
  it('uses rounded slot ends instead of rectangular cutouts', () => {
    expect(rayHits('slots', 24, 40)).toBe(false)
    expect(rayHits('slots', 29.7, 40)).toBe(true)
  })
})
