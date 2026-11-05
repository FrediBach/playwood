import { expect, it } from 'vitest'
import { conversionFailurePreview, ObjectConversionError } from './object-conversion-diagnostics'
import { convertConstructionObject } from './object-conversion'
import { createStarterProject } from './model'
import type { ConstructionObject, Project } from './types'
const options = { thickness: 18, material: 'birch' as const, color: '#d9bb87', finishCoverage: 0, connectorColor: '#ff0000', connectorMaterial: 'plastic' as const }
function source(): Project {
  const nodes: ConstructionObject[] = [0, 1200].map((x, i) => ({ id: `box-${i}`, name: `Box ${i}`, kind: 'box', visible: false, width: 600, height: 600, depth: 400, position: [x, 300, 0], rotation: [0, 0, 0] }))
  return { ...createStarterProject('blank'), constructionObjects: { roots: nodes.map(n => n.id), nodes } }
}
function failure(project: Project) {
  try { convertConstructionObject(project, project.constructionObjects!.roots, options) }
  catch (error) { return error }
  throw new Error('Expected failure')
}
it('locates only the piece whose panel cuts fail and preserves hidden source visibility', () => {
  const project = source(), box = project.constructionObjects!.nodes[1]
  if (box.kind !== 'box') throw new Error('Expected box')
  box.width = 50
  const before = structuredClone(project), error = failure(project)
  expect(error).toBeInstanceOf(ObjectConversionError)
  const preview = conversionFailurePreview(project, project.constructionObjects!.roots, error)!
  expect(preview.regions.map(r => r.name)).toEqual(['Box 1'])
  expect(preview.regions[0].bounds).toEqual({ min: [1175, 0, -200], max: [1225, 600, 200] })
  expect(preview.surfaces).toHaveLength(2)
  expect(preview.objects.nodes.every(n => n.visible)).toBe(true)
  expect(project).toEqual(before)
})
it('identifies both overlapping roots without blaming a third separated object', () => {
  const project = source(), box = project.constructionObjects!.nodes[1]
  if (box.kind !== 'box') throw new Error('Expected box')
  box.position[0] = 300
  project.constructionObjects!.nodes.push({ ...box, id: 'third', name: 'Separate', position: [3000, 300, 0] })
  project.constructionObjects!.roots.push('third')
  const preview = conversionFailurePreview(project, project.constructionObjects!.roots, failure(project))!
  expect(preview.regions.map(r => r.name)).toEqual(['Box 0', 'Box 1'])
})
it('marks the evaluated unsupported shape, with hidden cutters retaining their Boolean meaning', () => {
  const project = source(), nodes = project.constructionObjects!.nodes, cutter = nodes[1]
  if (cutter.kind !== 'box') throw new Error('Expected box')
  cutter.width = cutter.height = cutter.depth = 100; cutter.position = [0, 300, 0]
  nodes.push({ id: 'cavity', name: 'Enclosed cavity', visible: false, kind: 'boolean', operation: 'subtract', children: ['box-0', 'box-1'] })
  project.constructionObjects!.roots = ['cavity']
  const preview = conversionFailurePreview(project, ['cavity'], failure(project))!
  expect(preview.regions.map(r => r.name)).toEqual(['Enclosed cavity'])
  expect(preview.surfaces![0].volume).toBe(600 * 600 * 400 - 100 ** 3)
  expect(preview.objects.nodes.find(n => n.id === 'box-1')!.visible).toBe(false)
})
it('falls back to source bounds for an empty result and to all selected roots for global errors', () => {
  const project = source()
  const preview = conversionFailurePreview(project, ['box-1'], new Error('Project limit'))!
  expect(preview.regions.map(r => r.name)).toEqual(['Box 1'])
  const nodes = project.constructionObjects!.nodes
  nodes.push({ id: 'empty', name: 'Empty intersection', visible: true, kind: 'boolean', operation: 'intersect', children: ['box-0', 'box-1'] })
  project.constructionObjects!.roots = ['empty']
  const empty = conversionFailurePreview(project, ['empty'], failure(project))!
  expect(empty.surfaces![0].positions).toHaveLength(0)
  expect(empty.regions[0].bounds).toEqual({ min: [-300, 0, -200], max: [1500, 600, 200] })
})
it('keeps complexity failures bounded and provides outlines without surface meshes', () => {
  const project = source()
  const nodes: ConstructionObject[] = Array.from({ length: 50 }, (_, i) => ({ id: `box-${i}`, name: `Box ${i}`, kind: 'box', visible: true, width: 5, height: 5, depth: 5, position: [i * 10, i * 11, i * 12], rotation: [0, 0, 0] }))
  nodes.push({ id: 'complex', name: 'Complex', kind: 'boolean', visible: true, operation: 'union', children: nodes.map(n => n.id) })
  project.constructionObjects = { roots: ['complex'], nodes }
  const error = failure(project), preview = conversionFailurePreview(project, ['complex'], error)!
  expect((error as Error).message).toMatch(/complex/)
  expect(preview.surfaces).toBeUndefined()
  expect(preview.regions.map(r => r.name)).toEqual(['Complex'])
  expect(preview.bounds.max).toEqual([492.5, 541.5, 590.5])
})
