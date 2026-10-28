import { attachPanel, createPanel, resolvePanels } from './model'
import type { AttachmentOptions, Panel, Project } from './types'

const joint: AttachmentOptions = {
  type: '90', side: 'left', offset: 0, inset: 0, flip: false,
  color: '#e75a35', count: 2,
}

const board = (name: string, width: number, height: number) => createPanel({
  name, width, height, material: 'painted', color: '#e8e7df',
})

function support(project: Project, parent: Panel, child: Panel, options: Partial<AttachmentOptions>): Project {
  return {
    ...project,
    connections: [...project.connections, {
      ...joint, ...options, id: `${parent.id}-support-${child.id}:0`,
      parentId: parent.id, childId: child.id, role: 'support',
    }],
  }
}

/** Workstation 08 / workshop table with shelves: seven structural panels, sixteen 90° clamps. */
export function workstationProject(): Project {
  const top = createPanel({
    ...board('Worktop', 1480, 735), position: [0, 796.5, 0], rotation: [-Math.PI / 2, 0, 0],
  })
  let project: Project = { version: 1, name: 'Workshop table with shelves', panels: [top], connections: [] }

  for (const [label, x] of [['Left', -565], ['Right', 565]] as const) {
    const back = board(`${label} pedestal back`, 350, 735)
    const front = board(`${label} pedestal front`, 350, 735)
    const base = board(`${label} pedestal base`, 350, 735)
    project = attachPanel(project, top.id, back, { ...joint, side: 'top', offset: x, flip: true })
    project = attachPanel(project, top.id, front, { ...joint, side: 'bottom', offset: x, flip: true })
    project = attachPanel(project, back.id, base, { ...joint, side: 'top', flip: true })
    project = support(project, base, front, { side: 'top', flip: true })

    // The source's folded/slotted inserts are accessories rather than connector
    // panels. Represent their four compartments with a divider and split shelf;
    // preserve clearance around the 18 mm structural boards and clamp bodies.
    const divider = createPanel({
      name: `${label} insert divider`, width: 350, height: 735, thickness: 5,
      position: [x, 411.5, 0],
    })
    const shelves = [-187.5, 187.5].map((z, index) => createPanel({
      name: `${label} insert shelf ${index + 1}`, width: 350, height: 355, thickness: 5,
      position: [x, 411.5, z], rotation: [-Math.PI / 2, 0, 0],
    }))
    project = { ...project, panels: [...project.panels, divider, ...shelves] }
  }
  return { ...project, panels: resolvePanels(project) }
}

/** Island display: two 1120 mm square platforms and a narrow upper tier, twenty-four clamps. */
export function islandProject(): Project {
  const base = createPanel({
    ...board('Island base', 1120, 1120), position: [0, 26.5, 0], rotation: [-Math.PI / 2, 0, 0],
  })
  const middle = board('Island middle platform', 1120, 1120)
  const top = board('Island upper shelf', 1120, 350)
  let project: Project = { version: 1, name: 'Island display', panels: [base], connections: [] }

  const lowerLegs: { panel: Panel; side: 'left' | 'right'; offset: number }[] = []
  for (const side of ['left', 'right'] as const) {
    for (const offset of [-385, 385]) {
      const panel = board(`${side === 'left' ? 'Left' : 'Right'} lower side ${offset < 0 ? 'front' : 'back'}`, 350, 350)
      project = attachPanel(project, base.id, panel, { ...joint, side, offset })
      lowerLegs.push({ panel, side, offset })
    }
  }
  lowerLegs.forEach(({ panel, side, offset }, index) => {
    const options = { ...joint, side, offset: -offset }
    project = index === 0
      ? attachPanel(project, panel.id, middle, options)
      : support(project, panel, middle, options)
  })

  // The middle platform's local X direction is reversed after the two bends.
  // Flip the upper joints so that both upper sides rise from that platform.
  for (const [index, side] of (['left', 'right'] as const).entries()) {
    const leg = board(`${side === 'left' ? 'Right' : 'Left'} upper side`, 350, 350)
    project = attachPanel(project, middle.id, leg, { ...joint, side, flip: true })
    project = index === 0
      ? attachPanel(project, leg.id, top, { ...joint, side, flip: true })
      : support(project, leg, top, { side, flip: true })
  }
  return { ...project, panels: resolvePanels(project) }
}
