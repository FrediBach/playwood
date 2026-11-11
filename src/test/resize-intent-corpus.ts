import { attachPanel, createPanel, parseProject, resolvePanels } from '../lib/model'
import synthStorage from '../lib/__fixtures__/synth-storage-resize.json'
import type { Project } from '../lib/types'

/** Test-only labels: these are proposed intent, not production inference rules. */
export interface ResizeBenchmarkCase {
  id: string
  family: string
  source: () => Project
  target: { panel: string; dimension: 'width' | 'height'; value: number }
  operation: 'numeric' | 'edge' | 'local-edge'
  anchor: string
  allowedAdaptingCuts: string[]
  invariants: string[]
  acceptableAlternatives: string[]
  ambiguity: 'none' | 'review' | 'conflict'
  policy: 'compatibility' | 'intent-gap'
  current: { rejected?: boolean; reviewCount: number; cuts: Record<string, number> }
}

function seam(height = 200, offset = 0, locked = false): Project {
  const parent = createPanel({ id: 'parent', name: 'Parent', width: 600, height: 400, position: [0, 800, 0] })
  const project = attachPanel({ version: 1, name: 'Seam benchmark', panels: [parent], connections: [] }, parent.id,
    createPanel({ id: 'child', name: 'Child', width: 400, height }),
    { type: '90', side: 'right', offset, inset: 0, flip: false, color: '#292b27', count: 2 })
  // Stable fixture identities make reports reproducible without depending on UUIDs.
  return { ...project, connections: project.connections.map((connection, index) => ({ ...connection, id: `joint-${index}` })),
    constraints: locked ? [{ id: 'child-lock', enabled: true, kind: 'dimension', panelId: 'child', dimension: 'height', value: height }] : [] }
}

const physical = ['Exact requested cut', 'Preserve rotations, panel/joint/installed-piece IDs and saved rules',
  'No new validation issues', 'Source remains immutable', 'Unlisted cuts remain unchanged']
const seamCases: ResizeBenchmarkCase[] = [199.99, 200, 200.01].map(height => ({
  id: `overlap-${height}`, family: '50% overlap', source: () => seam(height),
  target: { panel: 'Parent', dimension: 'height', value: 500 }, operation: 'numeric',
  anchor: 'Selected parent center (default preference)', allowedAdaptingCuts: ['Parent.height', 'Child.height'],
  invariants: physical, acceptableAlternatives: ['Keep child cut and translate', 'Preserve both child setbacks with explicit review'],
  ambiguity: 'review', policy: 'intent-gap',
  current: { reviewCount: 0, cuts: { 'Parent.height': 500, 'Child.height': height > 200 ? height + 100 : height } },
}))

export const resizeIntentCorpus: ResizeBenchmarkCase[] = [
  ...(['numeric', 'edge', 'local-edge'] as const).map(operation => ({
    id: `single-${operation}`, family: 'Explicit anchor',
    source: (): Project => ({ version: 1, name: 'Single panel', panels: [createPanel({ id: 'panel', name: 'Panel', width: 400, height: 300, position: [0, 800, 0] })], connections: [] }),
    target: { panel: 'Panel', dimension: 'width' as const, value: 500 }, operation,
    anchor: operation === 'numeric' ? 'Selected center' : 'Exact negative local-X edge',
    allowedAdaptingCuts: ['Panel.width'], invariants: physical, acceptableAlternatives: ['Only the requested cut changes; respect the anchor'],
    ambiguity: 'none' as const, policy: 'compatibility' as const, current: { reviewCount: 0, cuts: { 'Panel.width': 500 } },
  })),
  {
    id: 'connected-local-edge', family: 'Local resize hardware anchor', source: () => seam(300),
    target: { panel: 'Parent', dimension: 'height', value: 500 }, operation: 'local-edge', anchor: 'Exact negative local-Y edge; other panels and hardware fixed',
    allowedAdaptingCuts: ['Parent.height'], invariants: physical, acceptableAlternatives: ['Only parent grows; installed hardware stays in world position'],
    ambiguity: 'none', policy: 'compatibility', current: { reviewCount: 0, cuts: { 'Parent.height': 500, 'Child.height': 300 } },
  },
  ...seamCases,
  ...[319.99, 320, 320.01].map(width => ({
    id: `occupancy-${width}`, family: '80% supported insert occupancy',
    source: (): Project => ({ version: 1, name: 'Supported insert', connections: [], panels: [
      createPanel({ id: 'support', name: 'Support', width: 400, height: 600, position: [0, 800, 0] }),
      createPanel({ id: 'insert', name: 'Insert', width, height: 200, position: [0, 800, 18] }),
    ] }),
    target: { panel: 'Support', dimension: 'width' as const, value: 500 }, operation: 'numeric' as const,
    anchor: 'Selected support center', allowedAdaptingCuts: ['Support.width', 'Insert.width'], invariants: physical,
    acceptableAlternatives: ['Keep insert cut on support', 'Preserve both fitted margins with explicit review'],
    ambiguity: 'review' as const, policy: 'intent-gap' as const,
    current: { reviewCount: 0, cuts: { 'Support.width': 500, 'Insert.width': width > 320 ? width + 100 : width } },
  })),
  ...[139.99, 140.01].map(offset => ({
    id: `setback-${offset}`, family: 'Setback threshold',
    source: () => { const project = seam(400, offset); return { ...project, panels: project.panels.map(panel => panel.id === 'parent' ? { ...panel, height: 600 } : panel) } },
    target: { panel: 'Parent', dimension: 'height' as const, value: 700 }, operation: 'numeric' as const,
    anchor: 'Selected parent center (default preference)', allowedAdaptingCuts: ['Parent.height', 'Child.height'],
    invariants: physical, acceptableAlternatives: ['Keep child cut and near end', 'Preserve both setbacks with explicit review'],
    ambiguity: 'review' as const, policy: 'intent-gap' as const,
    current: { reviewCount: 0, cuts: { 'Parent.height': 700, 'Child.height': offset < 140 ? 500 : 400 } },
  })),
  {
    id: 'locked-child', family: 'Authored requirement versus inferred setbacks', source: () => seam(300, 0, true),
    target: { panel: 'Parent', dimension: 'height', value: 500 }, operation: 'numeric', anchor: 'Selected parent center',
    allowedAdaptingCuts: ['Parent.height'], invariants: physical,
    acceptableAlternatives: ['Keep child cut and negative setback', 'Keep child cut and positive setback'],
    ambiguity: 'review', policy: 'compatibility', current: { rejected: true, reviewCount: 2, cuts: { 'Parent.height': 500, 'Child.height': 300 } },
  },
  {
    id: 'stock-limit', family: 'Physical cut limit', source: () => seam(),
    target: { panel: 'Parent', dimension: 'height', value: 4001 }, operation: 'numeric', anchor: 'Selected parent center',
    allowedAdaptingCuts: [], invariants: ['Reject atomically at the stock bound'], acceptableAlternatives: ['Reject'],
    ambiguity: 'conflict', policy: 'compatibility', current: { rejected: true, reviewCount: 0, cuts: {} },
  },
  {
    id: 'locked-target', family: 'Hard conflict', source: () => seam(300, 0, true),
    target: { panel: 'Child', dimension: 'height', value: 350 }, operation: 'numeric', anchor: 'Selected child center',
    allowedAdaptingCuts: [], invariants: ['Reject atomically; never release an authored cut'], acceptableAlternatives: ['Reject'],
    ambiguity: 'conflict', policy: 'compatibility', current: { rejected: true, reviewCount: 0, cuts: {} },
  },
  {
    id: 'unrelated-equal-cut', family: 'Equal numbers without topology',
    source: () => { const project = seam(200); return { ...project, panels: [...project.panels, createPanel({ id: 'peer', name: 'Peer', width: 600, height: 400, position: [3000, 800, 0] })] } },
    target: { panel: 'Parent', dimension: 'height', value: 500 }, operation: 'numeric', anchor: 'Selected parent center',
    allowedAdaptingCuts: ['Parent.height', 'Child.height'], invariants: physical, acceptableAlternatives: ['Peer stays fixed; child travels without recutting', 'Peer stays fixed; preserve both child setbacks with explicit review'],
    ambiguity: 'review', policy: 'compatibility', current: { reviewCount: 0, cuts: { 'Parent.height': 500, 'Peer.height': 400, 'Child.height': 200 } },
  },
  {
    id: 'angled-trays', family: 'Real synth/storage fixture', source: () => parseProject(synthStorage),
    target: { panel: 'Upright 1.1', dimension: 'width', value: 400 }, operation: 'numeric', anchor: 'Selected upright center',
    allowedAdaptingCuts: parseProject(synthStorage).panels.filter(panel => panel.name.includes('upright') || panel.name.startsWith('Upright')).map(panel => `${panel.name}.width`), invariants: physical,
    acceptableAlternatives: ['Angled trays and stoppers travel with unchanged cuts'], ambiguity: 'none', policy: 'compatibility',
    current: { reviewCount: 0, cuts: { 'Upright 1.1.width': 400 } },
  },
]

export function targetPanel(project: Project, scenario: ResizeBenchmarkCase) {
  const panel = resolvePanels(project).find(panel => panel.name === scenario.target.panel)
  if (!panel) throw new Error(`Missing benchmark panel: ${scenario.target.panel}`)
  return panel
}
