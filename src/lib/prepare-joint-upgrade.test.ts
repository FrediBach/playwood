import { describe, expect, it } from 'vitest'
import { createAssembly, duplicateAssembly, getAssemblyAttachmentTargets, materializeAssemblies, updateAssemblyFinish } from './assemblies'
import { gridProject } from './example-geometry'
import { attachPanel, createPanel, parseProject, resolvePanels, validateProject } from './model'
import { prepareJointUpgrade } from './prepare-joint-upgrade'
import type { Project } from './types'

function box(): Project {
  const loose = gridProject('Box', [350], [350], { depth: 350 })
  return createAssembly(loose, loose.panels.map(panel => panel.id), 'Box')
}

function linkedBoxes(): Project {
  const initial = box()
  return getAssemblyAttachmentTargets(initial, initial.assemblies!.instances[0].id)
    .find(target => target.label === 'Top right' && !target.warning)!.project!
}

describe('preparing assembly hardware upgrades', () => {
  it('leaves ordinary joints and supplemental joints touching instances alone', () => {
    const loose = gridProject('Loose box', [350], [350])
    expect(prepareJointUpgrade(loose, loose.connections)).toEqual({ project: loose, disassembledNames: [] })
    const project = box()
    const support = { ...project.connections[0], id: 'supplemental:0', role: 'support' as const }
    const withSupport = { ...project, connections: [...project.connections, support] }
    expect(prepareJointUpgrade(withSupport, [support]).project).toBe(withSupport)
    expect(prepareJointUpgrade(project, []).project).toBe(project)
  })

  it('bakes only the affected instance so its corner can become a T without changing linked copies', () => {
    const parent = createPanel({ width: 300, height: 300, position: [0, 500, 0] })
    const tee = attachPanel({ version: 1, name: 'T', panels: [parent], connections: [] }, parent.id, createPanel({ width: 300, height: 300 }),
      { type: 't', side: 'top', flip: false, offset: 0, inset: 0, color: '#123456', count: 2 })
    const [a, b, continuation] = resolvePanels(tee)
    const corner: Project = { ...tee, panels: [a, b], connections: [{ ...tee.connections[0], type: '90' }] }
    const initial = createAssembly(corner, [a.id, b.id], 'Corner')
    let project = duplicateAssembly(initial, initial.assemblies!.instances[0].id)
    const affected = project.assemblies!.instances[0]
    project = updateAssemblyFinish(project, affected.id, { color: '#456789', material: 'oak' })
    project = { ...project, panels: [...project.panels, continuation] }
    const before = structuredClone(project)
    const replaced = project.connections.filter(connection => Object.values(affected.connectionIds!).includes(connection.id))
    const prepared = prepareJointUpgrade(project, replaced)
    expect(prepared.disassembledNames).toEqual(['Corner'])
    expect(prepared.project.panels).toBe(project.panels)
    expect(prepared.project.connections).toBe(project.connections)
    expect(prepared.project.assemblies!.instances).toEqual([project.assemblies!.instances[1]])
    expect(prepared.project.assemblies!.definitions).toEqual(project.assemblies!.definitions)
    const next: Project = { ...prepared.project, connections: [
      ...prepared.project.connections.filter(connection => !replaced.includes(connection)),
      ...tee.connections.map(connection => ({ ...connection, role: 'support' as const })),
    ] }
    expect(resolvePanels(next)).toEqual(resolvePanels(project))
    expect(validateProject(next)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next)
    const rebuilt = materializeAssemblies(next)
    expect(new Map(rebuilt.panels.map(panel => [panel.id, panel]))).toEqual(new Map(next.panels.map(panel => [panel.id, panel])))
    expect(new Map(rebuilt.connections.map(connection => [connection.id, connection]))).toEqual(new Map(next.connections.map(connection => [connection.id, connection])))
    expect(project).toEqual(before)
  })

  it('recognizes source-owned hardware in legacy instances without explicit connection mappings', () => {
    const initial = box()
    const instance = initial.assemblies!.instances[0]
    const project = materializeAssemblies({ ...initial,
      connections: initial.connections.map(connection => ({ ...connection, id: `assembly/${instance.id}/${connection.id}` })),
      assemblies: { ...initial.assemblies!, instances: [{ ...instance, connectionIds: undefined }] },
    })
    const prepared = prepareJointUpgrade(project, [project.connections[0]])
    expect(prepared.disassembledNames).toEqual(['Box'])
    expect(prepared.project.assemblies!.instances).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(prepared.project)))).toEqual(prepared.project)
  })

  it('retains the other shared corners and their neighboring instances', () => {
    const project = linkedBoxes()
    const affected = project.assemblies!.instances[0]
    const own = project.connections.find(connection => Object.values(affected.connectionIds!).includes(connection.id))!
    const prepared = prepareJointUpgrade(project, [own])
    expect(prepared.disassembledNames).toEqual([affected.name])
    expect(prepared.project.panels).toBe(project.panels)
    expect(prepared.project.connections).toBe(project.connections)
    expect(prepared.project.assemblies!.instances).toEqual([project.assemblies!.instances[1]])
    expect(prepared.project.assemblies!.links.map(link => link.id)).toEqual(project.assemblies!.links.map(link => link.id))
    expect(prepared.project.assemblies!.loosePorts).toHaveLength(1)
    expect(parseProject(JSON.parse(JSON.stringify(prepared.project)))).toEqual(prepared.project)
    expect(validateProject(prepared.project)).toEqual([])
  })

  it('bakes both endpoints when replacing hardware owned by an assembly link', () => {
    const project = linkedBoxes()
    const replacement = project.connections.filter(connection => connection.id.startsWith('assembly-link/'))
    const prepared = prepareJointUpgrade(project, replacement)
    expect(prepared.disassembledNames).toEqual(project.assemblies!.instances.map(instance => instance.name))
    expect(prepared.project.assemblies!.instances).toEqual([])
    expect(prepared.project.assemblies!.links).toEqual([])
    expect(prepared.project.assemblies!.loosePorts).toEqual([])
    expect(prepared.project.panels).toBe(project.panels)
    expect(prepared.project.connections).toBe(project.connections)
    expect(parseProject(JSON.parse(JSON.stringify(prepared.project)))).toEqual(prepared.project)
    expect(materializeAssemblies(prepared.project)).toEqual(prepared.project)
  })
})
