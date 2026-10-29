import { gridProject } from './example-geometry'
import { getProjectBounds, rotateProject } from './model'
import { createAssembly, getAssemblyAttachmentTargets, moveAssemblies } from './assemblies'
import type { Project } from './types'

/** Four linked boxes enclose a fifth compartment between their shared corners. */
export function diamondShelfProject(): Project {
  const box = gridProject('Diamond shelf', [350], [350], {
    depth: 350,
    color: '#eeede7',
    connectorColor: '#292b27',
  })
  let project = createAssembly(box, box.panels.map(panel => panel.id), 'Box')
  for (const corner of ['Top right', 'Bottom right', 'Bottom left']) {
    const instance = project.assemblies!.instances.at(-1)!
    const target = getAssemblyAttachmentTargets(project, instance.id).find(item => item.label === corner)
    if (!target?.project) throw new Error(`Could not build Diamond shelf: ${target?.error ?? corner}`)
    project = target.project
  }
  const bounds = getProjectBounds(project.panels)
  project = moveAssemblies(project, project.assemblies!.instances.map(instance => instance.id), [-(bounds.min[0] + bounds.max[0]) / 2, -bounds.min[1], 0])
  return rotateProject(project, 'z', 45)
}
