import type { GuideScene } from './guide-scenes'
import { addConstructionBox, combineConstructionObjects, updateConstructionObject } from './construction-objects'
import { evaluateConstructionObjects } from './object-geometry'
import { convertConstructionObject, type ObjectConversionOptions } from './object-conversion'
import { createStarterProject } from './model'
import type { Project } from './types'

const sourceScene = (project: Project, note: string): GuideScene => ({
  project, note, selected: [], ghost: [], labels: [],
  objectSurfaces: evaluateConstructionObjects(project.constructionObjects!),
})

/** Tiny real Boolean studies; their SVG surfaces and solver results are cached by the guide. */
export function buildObjectGuideScenes(solver: boolean): GuideScene[] {
  const main = addConstructionBox(createStarterProject('blank'))
  const added = addConstructionBox(main.project)
  const cutter = added.project.constructionObjects!.nodes.find(node => node.id === added.objectId)!
  if (cutter.kind !== 'box') throw new Error('Expected the guide cutter to be a box.')
  const pair = updateConstructionObject(added.project, { ...cutter, name: 'Corner cutter', width: 400, height: 400, depth: 400, position: [200, 500, 0] })
  const selection = [main.objectId, added.objectId]
  const subtraction = combineConstructionObjects(pair, selection, 'subtract')
  if (!solver) return [
    sourceScene(main.project, 'A source box defines volume; no furniture panels have been created.'),
    sourceScene(combineConstructionObjects(pair, selection, 'union').project, 'Union keeps either box’s volume and removes internal faces.'),
    sourceScene(subtraction.project, 'Subtract removes the second box from the first, leaving an L shape.'),
    sourceScene(combineConstructionObjects(pair, selection, 'intersect').project, 'Intersect keeps only the 300 × 300 × 400 mm common volume.'),
  ]
  const options: ObjectConversionOptions = { thickness: 18, material: 'oak', color: '#d7bd91', finishCoverage: 0, connectorColor: '#c94727', connectorMaterial: 'plastic' }
  const fitted = convertConstructionObject(subtraction.project, [subtraction.objectId], options)
  const rectangular = convertConstructionObject(subtraction.project, [subtraction.objectId], { ...options, rectangularOnly: true })
  const furnitureScene = (project: Project, note: string, ghost: string[] = []): GuideScene => ({ project, note, selected: [], ghost, labels: [] })
  return [
    sourceScene(subtraction.project, 'The solver starts from the evaluated L-shaped solid, including its cut corner.'),
    furnitureScene(fitted.project, 'Six rim boards and two fitted outline faces close the L-shaped shell.'),
    furnitureScene(rectangular.project, 'Rectangular panels only replaces outline faces with fitted rectangular pieces.'),
    furnitureScene(fitted.project, 'Create panels accepts ordinary furniture and keeps the source tree hidden.'),
  ]
}
