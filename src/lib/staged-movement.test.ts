import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject, getProjectBounds, resolvePanels, rotateProject, validateProject } from './model'
import { Euler, Quaternion, Vector3 } from 'three'
import { gridProject } from './example-geometry'
import { acceptMovementAlternative, MovementReviewRequired, movePanels, movePanelsWithReview } from './structure-edit'
import type { Project, Vec3 } from './types'

const named = (project: Project, name: string) => resolvePanels(project).find(panel => panel.name === name)!

describe('staged interior movement', () => {
  it('keeps nearby cuts and outside faces when adjacent spans can absorb the move', () => {
    const before = createStarterProject()
    const middle = named(before, 'Middle shelf')
    const next = movePanelsWithReview(before, [middle.id], [0, 10, 0])
    expect(next.panels).toEqual(movePanels(before, [middle.id], [0, 10, 0]).panels)
    expect(validateProject(next)).toEqual([])
  })

  it('offers an outer-frame change only after local stock reaches its limit', () => {
    const before = createStarterProject()
    const middle = named(before, 'Middle shelf')
    const snapshot = JSON.stringify(before)
    let failure: unknown
    try { movePanelsWithReview(before, [middle.id], [0, 500, 0]) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(MovementReviewRequired)
    const review = (failure as MovementReviewRequired).review
    expect(review.alternatives).toHaveLength(1)
    const next = acceptMovementAlternative(before, review, 0)
    expect(named(next, 'Middle shelf').position[1]).toBeCloseTo(middle.position[1] + 500)
    expect(named(next, 'Bottom shelf')).toEqual(named(before, 'Bottom shelf'))
    expect(named(next, 'Top shelf').position[1]).toBeGreaterThan(named(before, 'Top shelf').position[1])
    expect(review.alternatives[0].outsideSize.after).toBeGreaterThan(review.alternatives[0].outsideSize.before)
    expect(validateProject(next)).toEqual([])
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(() => acceptMovementAlternative({ ...before }, review, 0)).toThrow(/project changed/)
  })

  it('offers a nearer compartment before an outer-frame alternative', () => {
    const before = gridProject('Four compartments', [400], [200, 100, 250, 300])
    const selected = named(before, 'Shelf 1.2')
    let failure: unknown
    try { movePanelsWithReview(before, [selected.id], [0, 100, 0]) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(MovementReviewRequired)
    const review = (failure as MovementReviewRequired).review
    expect(review.alternatives).toHaveLength(2)
    expect(review.alternatives[0].outsideSize.after).toBeCloseTo(review.alternatives[0].outsideSize.before)
    expect(named(review.alternatives[0].project, 'Shelf 1.3').position[1]).toBeGreaterThan(named(before, 'Shelf 1.3').position[1])
    expect(named(review.alternatives[0].project, 'Shelf 1.4')).toEqual(named(before, 'Shelf 1.4'))
    for (const alternative of review.alternatives) expect(validateProject(alternative.project)).toEqual([])
  })

  it('uses the panel normal and keeps the opposite face in rotated construction', () => {
    const before = rotateProject(createStarterProject(), 'z', 32)
    const middle = named(before, 'Middle shelf')
    const axis = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().setFromEuler(new Euler(...middle.rotation)))
    if (axis.y < 0) axis.negate()
    const delta = axis.multiplyScalar(500).toArray() as Vec3
    try { movePanelsWithReview(before, [middle.id], delta); expect.fail('Expected review') }
    catch (error) {
      expect(error).toBeInstanceOf(MovementReviewRequired)
      const next = (error as MovementReviewRequired).review.alternatives[0].project
      named(next, 'Middle shelf').position.forEach((value, index) => expect(value).toBeCloseTo(middle.position[index] + delta[index], 4))
      expect(named(next, 'Bottom shelf')).toEqual(named(before, 'Bottom shelf'))
      expect(validateProject(next)).toEqual([])
    }
  })

  it.each(['authored rule', 'build space', 'collision'] as const)('never expands through a %s', blocker => {
    let before = createStarterProject()
    const middle = named(before, 'Middle shelf'), top = named(before, 'Top shelf')
    if (blocker === 'authored rule') before = { ...before, constraints: [{ id: 'top', enabled: true, kind: 'floor',
      panelId: top.id, reference: 'center', value: top.position[1] }] }
    if (blocker === 'build space') {
      const bounds = getProjectBounds(resolvePanels(before))
      before = { ...before, spaceConstraint: { enabled: true, width: bounds.max[0] - bounds.min[0] + 10,
        depth: bounds.max[2] - bounds.min[2] + 10, height: bounds.max[1] + 10,
        centerX: (bounds.max[0] + bounds.min[0]) / 2, centerZ: (bounds.max[2] + bounds.min[2]) / 2 } }
    }
    if (blocker === 'collision') before = { ...before, panels: [...before.panels,
      createPanel({ ...top, id: 'obstacle', name: 'Obstacle', position: [top.position[0], top.position[1] + 500, top.position[2]] })] }
    const snapshot = JSON.stringify(before)
    expect(validateProject(before)).toEqual([])
    let failure: unknown
    try { movePanelsWithReview(before, [middle.id], [0, 500, 0]) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(MovementReviewRequired)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
