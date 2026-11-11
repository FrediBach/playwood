import { expect, it } from 'vitest'
import { resizeIntentCorpus } from '../test/resize-intent-corpus'
import { createResizeIntent } from './resize-intent'
import { prepareResizeCandidateValidator, validateResizeCandidate } from './resize-candidate-validation'
import { resizePanelEdge } from './structure-edit'

it('rechecks every candidate after warming source validation and accepts subsequent valid distances', () => {
  const source = resizeIntentCorpus.find(item => item.id === 'single-edge')!.source()
  const original = JSON.stringify(source)
  const intentAt = (distance: number) => createResizeIntent(source, { kind: 'panel-edge', local: false,
    edge: { panelId: 'panel', dimension: 'width', side: 1, distance } })
  const validate = prepareResizeCandidateValidator(intentAt(10))
  const cuts = new Set<string>()
  for (const distance of [10, 20, -10, 30]) {
    const intent = intentAt(distance), candidate = resizePanelEdge(source, 'panel', 'width', 1, distance)
    expect(validate(intent, candidate, [], cuts)).toEqual(validateResizeCandidate(intent, candidate, [], cuts))
    const shifted = structuredClone(candidate)
    shifted.panels[0].position[0] += 1
    expect(() => validate(intent, shifted, [], cuts)).toThrow(/opposite edge/)
    const recut = structuredClone(candidate)
    recut.panels[0].height += 1
    expect(() => validate(intent, recut, [], cuts)).toThrow(/preserved cut/)
    const removed = { ...candidate, panels: [] }
    expect(() => validate(intent, removed, [], cuts)).toThrow(/identities/)
  }
  const intent = intentAt(10)
  expect(() => validate({ ...intent, source: structuredClone(source) }, source, [], cuts)).toThrow(/changed source/)
  expect(() => validate({ ...intent, validation: { trofastWorld: !intent.validation.trofastWorld } }, source, [], cuts)).toThrow(/validation mode/)
  expect(JSON.stringify(source)).toBe(original)
})
