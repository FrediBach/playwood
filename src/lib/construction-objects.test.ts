import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { addConstructionBox, combineConstructionObjects, copyConstructionObjects, duplicateConstructionObjects,
  parseConstructionObjects, pasteConstructionObjects, preserveConstructionObjects, removeConstructionObjects, updateConstructionObject } from './construction-objects'
import { createStarterProject, parseProject, projectToCsv, removePanel } from './model'
import { createExampleProject } from './example-library'
import { createAssemblyFile } from './assembly-file'
import { duplicateAssembly } from './assemblies'
import type { ConstructionObject, ConstructionObjects, Project } from './types'

const box = (id: string): Extract<ConstructionObject, { kind: 'box' }> => ({ id, name: id, kind: 'box', visible: true,
  width: 600, height: 800, depth: 400, position: [0, 400, 0], rotation: [0, Math.PI / 2, 0] })
const tree = (): ConstructionObjects => ({ roots: ['difference'], nodes: [box('outer'), box('cutter'),
  { id: 'difference', name: 'Opening', kind: 'boolean', visible: false, operation: 'subtract', children: ['outer', 'cutter'] }] })
const project = (): Project => ({ ...createStarterProject('blank'), constructionObjects: tree() })

describe('saved construction objects', () => {
  it('keeps legacy projects unchanged and round trips an object-only project without fabricating parts', () => {
    const legacy = createStarterProject('blank')
    expect(parseProject(legacy)).not.toHaveProperty('constructionObjects')
    const original = project(), loaded = roundTripProject(original)
    expect(loaded).toEqual(original)
    expect(loaded.constructionObjects).not.toBe(original.constructionObjects)
    expect(projectToCsv(loaded)).toBe(projectToCsv(legacy))
    expect(loaded.panels).toEqual([])
    expect(loaded.connections).toEqual([])
  })

  it('keeps source volumes outside standalone assemblies while preserving them through panel and assembly edits', () => {
    const source = { ...createExampleProject('assembly-cube'), constructionObjects: tree() }
    const instance = source.assemblies!.instances[0]
    const plain = { ...source, constructionObjects: undefined }
    expect(createAssemblyFile(source, instance.id)).toEqual(createAssemblyFile(plain, instance.id))
    expect(projectToCsv(source)).toBe(projectToCsv(plain))
    expect(duplicateAssembly(source, instance.id).constructionObjects).toEqual(tree())
    expect(removePanel(source, source.panels[0].id).constructionObjects).toEqual(tree())
  })

  it('retains omitted sources for ordinary reconstructed edits and allows explicit clearing', () => {
    const source = project(), blank = createStarterProject('blank')
    expect(preserveConstructionObjects(source, blank).constructionObjects).toEqual(tree())
    const cleared = { ...blank, constructionObjects: { roots: [], nodes: [] } }
    expect(preserveConstructionObjects(source, cleared)).toBe(cleared)
    expect(preserveConstructionObjects(blank, blank)).toBe(blank)
  })

  it.each(['union', 'subtract', 'intersect'] as const)('creates editable ordered %s operands without moving boxes', operation => {
    const first = addConstructionBox(createStarterProject('blank')), second = addConstructionBox(first.project)
    const before = structuredClone(second.project)
    const combined = combineConstructionObjects(second.project, [second.objectId, first.objectId], operation)
    expect(combined.project.constructionObjects!.roots).toEqual([combined.objectId])
    expect(combined.project.constructionObjects!.nodes.at(-1)).toMatchObject({ operation, children: [second.objectId, first.objectId] })
    expect(combined.project.constructionObjects!.nodes.slice(0, 2)).toEqual(before.constructionObjects!.nodes)
    const edited = updateConstructionObject(combined.project, { ...combined.project.constructionObjects!.nodes[0], name: 'Editable operand', visible: false })
    expect(edited.constructionObjects!.nodes[0].name).toBe('Editable operand')
    expect(combined.project.constructionObjects!.nodes[0].name).toBe('Box')
    expect(second.project).toEqual(before)
  })

  it('copies a detached snapshot and remaps all IDs and ordered references on each paste', () => {
    const source = project(), before = structuredClone(source)
    const clipboard = copyConstructionObjects(source, ['difference'])
    const pasted = pasteConstructionObjects(source, clipboard, [100, 0, -50])
    const duplicated = duplicateConstructionObjects(pasted.project, pasted.objectIds)
    const objects = duplicated.project.constructionObjects!
    expect(objects.roots).toHaveLength(3)
    expect(new Set(objects.nodes.map(node => node.id)).size).toBe(9)
    const pastedNodes = pasted.project.constructionObjects!.nodes.slice(3)
    expect(pastedNodes[0]).toMatchObject({ position: [100, 400, -50] })
    expect(pastedNodes[2]).toMatchObject({ children: pastedNodes.slice(0, 2).map(node => node.id), visible: false })
    expect(roundTripProject(duplicated.project)).toEqual(duplicated.project)
    clipboard.nodes[0].name = 'Clipboard only'
    expect(source).toEqual(before)
    expect(pasted.project.constructionObjects!.nodes[3].name).toBe('outer')
    expect(removeConstructionObjects(duplicated.project, objects.roots).constructionObjects).toEqual({ roots: [], nodes: [] })
  })

  it('rejects partial-tree deletion and invalid edits without changing the source', () => {
    const source = project(), before = structuredClone(source)
    expect(() => removeConstructionObjects(source, ['cutter'])).toThrow('top-level')
    expect(() => duplicateConstructionObjects(source, ['difference', 'difference'])).toThrow('distinct')
    expect(() => updateConstructionObject(source, { ...box('outer'), kind: 'box', width: 0 })).toThrow()
    expect(() => pasteConstructionObjects(source, tree(), [100001, 0, 0])).toThrow()
    expect(source).toEqual(before)
  })

  it.each([
    { width: 0 }, { height: Infinity }, { depth: 10001 }, { visible: 'yes' }, { name: '' },
    { rotation: [0, 0.1, 0] }, { position: [NaN, 0, 0] }, { position: [0, 0] },
  ])('rejects malformed box fields: %j', patch => {
    expect(() => parseConstructionObjects({ roots: ['box'], nodes: [{ ...box('box'), ...patch }] })).toThrow()
  })

  it('rejects dangling, repeated, shared, orphaned and cyclic nodes and invalid operations', () => {
    const malformed: unknown[] = [
      { roots: ['missing'], nodes: [] },
      { roots: ['outer', 'outer'], nodes: [box('outer')] },
      { roots: ['outer'], nodes: [box('outer'), box('outer')] },
      { roots: [], nodes: [box('orphan')] },
      { ...tree(), roots: ['difference', 'cutter'] },
      { ...tree(), nodes: [...tree().nodes.slice(0, 2), { ...tree().nodes[2], children: ['outer', 'difference'] }] },
      { ...tree(), nodes: [...tree().nodes.slice(0, 2), { ...tree().nodes[2], children: ['outer'] }] },
      { ...tree(), nodes: [...tree().nodes.slice(0, 2), { ...tree().nodes[2], operation: 'xor' }] },
    ]
    for (const constructionObjects of malformed) expect(() => parseProject({ ...project(), constructionObjects })).toThrow()
  })

  it('enforces total node and nesting limits on imports and commands', () => {
    const nodes = Array.from({ length: 200 }, (_, index) => box(`box-${index}`))
    const full = { roots: nodes.map(node => node.id), nodes }
    expect(parseConstructionObjects(full).nodes).toHaveLength(200)
    expect(() => addConstructionBox({ ...project(), constructionObjects: full })).toThrow('200')
    expect(() => duplicateConstructionObjects({ ...project(), constructionObjects: full }, ['box-0'])).toThrow('200')
    let nested: ConstructionObjects = { roots: ['leaf'], nodes: [box('leaf')] }
    for (let depth = 2; depth <= 17; depth++) {
      nested = { roots: [`level-${depth}`], nodes: [...nested.nodes, box(`leaf-${depth}`),
        { id: `level-${depth}`, name: 'Union', visible: true, kind: 'boolean', operation: 'union', children: [nested.roots[0], `leaf-${depth}`] }] }
      if (depth <= 16) expect(parseConstructionObjects(nested)).toEqual(nested)
    }
    expect(() => parseConstructionObjects(nested)).toThrow('16 levels')
  })
})
