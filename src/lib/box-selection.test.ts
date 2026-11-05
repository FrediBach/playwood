import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Scene } from 'three'
import { getBoxSelection, type SelectionRectangle } from './box-selection'

const full: SelectionRectangle = { left: -1, right: 1, top: 1, bottom: -1 }
const middle: SelectionRectangle = { left: -.3, right: .3, top: .3, bottom: -.3 }
function panel(id: string, x = 0, y = 0, z = 0) {
  const mesh = new Mesh(new BoxGeometry(1, 1, .1), new MeshBasicMaterial())
  mesh.userData.panelId = id
  mesh.position.set(x, y, z)
  return mesh
}
function camera(perspective = false) {
  const result = perspective ? new PerspectiveCamera(50, 1, .1, 20) : new OrthographicCamera(-2, 2, 2, -2, .1, 20)
  result.position.z = 5
  result.lookAt(0, 0, 0)
  return result
}

describe('box selection of rendered parts', () => {
  it('selects object results separately from furniture and excludes invisible operand picking meshes', () => {
    const scene = new Scene(), object = panel('unused'), cutter = panel('unused-cutter')
    delete object.userData.panelId; delete cutter.userData.panelId
    object.userData.objectId = 'boolean-root'; cutter.userData.objectId = 'cutter'
    cutter.material.visible = false
    scene.add(object, cutter, panel('board'))
    expect(getBoxSelection(scene, camera(), full, 'objects')).toEqual(['boolean-root'])
    expect(getBoxSelection(scene, camera(), full, 'panels')).toEqual(['board'])
  })
  it.each([false, true])('requires full projected containment with perspective=%s', perspective => {
    const scene = new Scene()
    scene.add(panel('inside'), panel('crossing', .8), panel('outside', 1.5))
    expect(getBoxSelection(scene, camera(perspective), middle, 'panels')).toEqual(['inside'])
    expect(getBoxSelection(scene, camera(perspective), full, 'panels')).toEqual(['inside', 'crossing', 'outside'])
  })

  it('uses current world transforms, including rotated and exploded groups', () => {
    const scene = new Scene(), group = new Group()
    const board = panel('board')
    group.add(board); scene.add(group)
    expect(getBoxSelection(scene, camera(), middle, 'panels')).toEqual(['board'])
    group.rotation.z = Math.PI / 4
    expect(getBoxSelection(scene, camera(), middle, 'panels')).toEqual([])
    group.position.x = 1.5
    expect(getBoxSelection(scene, camera(), full, 'panels')).toEqual([])
    group.position.x = 0
    board.rotation.y = Math.PI / 2
    expect(getBoxSelection(scene, camera(), full, 'panels')).toEqual(['board'])
  })

  it('excludes hidden objects, ancestors, materials, layers and untagged ghosts', () => {
    const scene = new Scene(), hidden = new Group(), parent = new Group()
    hidden.visible = false; hidden.add(panel('hidden-parent'))
    const invisible = panel('invisible'); invisible.visible = false
    const materialHidden = panel('material-hidden'); materialHidden.material.visible = false
    const layerHidden = panel('layer-hidden'); layerHidden.layers.set(1)
    const ghost = panel('ghost'); delete ghost.userData.panelId
    scene.add(hidden, invisible, materialHidden, layerHidden, ghost, panel('shown'))
    expect(getBoxSelection(scene, camera(), full, 'panels')).toEqual(['shown'])
    parent.add(scene); parent.visible = false
    expect(getBoxSelection(scene, camera(), full, 'panels')).toEqual([])
  })

  it.each([false, true])('rejects clipped and behind-camera geometry with perspective=%s', perspective => {
    const scene = new Scene()
    scene.add(panel('behind', 0, 0, 6), panel('near-clipped', 0, 0, 4.89), panel('far', 0, 0, -16), panel('visible'))
    expect(getBoxSelection(scene, camera(perspective), full, 'panels')).toEqual(['visible'])
  })

  it('includes enclosed parts behind other parts', () => {
    const scene = new Scene()
    scene.add(panel('front', 0, 0, 1), panel('back', 0, 0, -1))
    expect(getBoxSelection(scene, camera(), middle, 'panels')).toEqual(['front', 'back'])
  })

  it('combines connector descendant meshes and ignores panel IDs in connector mode', () => {
    const scene = new Scene(), connector = new Group(), nested = new Group()
    connector.userData.connectorId = 'connector'
    const left = panel('left', -.2), right = panel('right', .2)
    delete left.userData.panelId; delete right.userData.panelId
    nested.add(right); connector.add(left, nested); scene.add(connector, panel('board'))
    expect(getBoxSelection(scene, camera(), middle, 'connectors')).toEqual([])
    expect(getBoxSelection(scene, camera(), full, 'connectors')).toEqual(['connector'])
    expect(getBoxSelection(scene, camera(), full, 'panels')).toEqual(['board'])
    nested.visible = false
    connector.position.x = .2
    expect(getBoxSelection(scene, camera(), middle, 'connectors')).toEqual(['connector'])
  })

  it('keeps a part on a rectangle boundary and rejects empty or invalid rectangles', () => {
    const scene = new Scene(); scene.add(panel('board'))
    expect(getBoxSelection(scene, camera(), { left: -.25, right: .25, top: .25, bottom: -.25 }, 'panels')).toEqual(['board'])
    expect(getBoxSelection(scene, camera(), { left: 0, right: 0, top: 0, bottom: 0 }, 'panels')).toEqual([])
    expect(getBoxSelection(scene, camera(), { ...full, left: NaN }, 'panels')).toEqual([])
  })
})
