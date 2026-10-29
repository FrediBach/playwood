import { createAssembly } from './assemblies'
import { groundProject } from './example-geometry'
import { attachPanel, createPanel } from './model'
import type { ExampleDefinition } from './example-library'
import type { AttachmentOptions, Project } from './types'

/** Four 105° corners and two 150° shoulders close a symmetric six-panel ring. */
export function angledBoxProject(name: string, width: number, sideLength: number, depth: number, color: string, connectorColor: string): Project {
  const panel = (label: string, length: number) => createPanel({ name: label, width: length, height: depth, material: 'painted', color })
  const bottom = panel('Bottom shelf', width)
  bottom.position = [0, 0, 0]
  bottom.rotation = [-Math.PI / 2, 0, 0]
  let project: Project = { version: 1, name, panels: [bottom], connections: [] }
  const options: AttachmentOptions = { type: '105', side: 'right', flip: false, offset: 0, inset: 0, count: 2, color: connectorColor }
  for (const [label, length, type] of [
    ['Lower right side', sideLength, '105'],
    ['Upper right side', sideLength, '150'],
    ['Top shelf', width, '105'],
    ['Upper left side', sideLength, '105'],
    ['Lower left side', sideLength, '150'],
  ] as const) {
    project = attachPanel(project, project.panels.at(-1)!.id, panel(label, length), { ...options, type })
  }
  // The sixth joint closes the loop without adding another driving parent.
  project.connections.push({ ...options, id: `${crypto.randomUUID()}:0`, parentId: project.panels.at(-1)!.id, childId: bottom.id, role: 'support' })
  project = groundProject(project)
  return createAssembly(project, project.panels.map(part => part.id), name)
}

export const ANGLED_ASSEMBLIES: readonly ExampleDefinition[] = [
  { id: 'assembly-angled-den', name: 'Angled den module', category: 'Angled modules', description: 'A wide six-panel nook with white panels, blue hardware, and 105° / 150° joints.', create: () => angledBoxProject('Angled den module', 600, 220, 450, '#eeede7', '#1689ed') },
  { id: 'assembly-hex-cubby', name: 'Hexagonal cubby', category: 'Angled modules', description: 'A tall black compartment inspired by the reference shelving, with 105° corners and 150° shoulders.', create: () => angledBoxProject('Hexagonal cubby', 350, 300, 350, '#30312f', '#20211f') },
  { id: 'assembly-wide-hex', name: 'Wide hexagonal shelf', category: 'Angled modules', description: 'An elongated open shelf with sloping sides and 105° / 150° connectors.', create: () => angledBoxProject('Wide hexagonal shelf', 700, 180, 350, '#eeede7', '#e75a35') },
  { id: 'assembly-hex-display', name: 'Shallow hexagonal display', category: 'Angled modules', description: 'A compact 200 mm deep display compartment using 105° and 150° connectors.', create: () => angledBoxProject('Shallow hexagonal display', 300, 180, 200, '#eeede7', '#20211f') },
]
