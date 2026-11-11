import { restoreRemovedConnectors } from './restore-connectors'
import { describe, expect, it } from 'vitest'
import { roundTripProject } from '../test/project-round-trip'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { editConnectors, getPhysicalConnectors } from './connector-selection'
import { attachPanel, createPanel, resolvePanels, validateProject } from './model'
import { resizePanels } from './structure-edit'
import { synthShelfProject } from './synth-shelf'
import type { Project } from './types'

function positions(project: Project) {
  const panels = resolvePanels(project).map(panel => ({ ...panel, visible: true }))
  return getPhysicalConnectors(project).filter(piece => piece.connection.type === '150').map(piece => {
    const rail = getConnectorRail(piece.connection, panels, project.connections)!
    const along = rail.along[piece.index] + connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
    return { id: piece.id, fraction: (along - rail.lower) / (rail.upper - rail.lower) }
  })
}

describe('connector placement during connected resizing', () => {
  it.each([600, 1200])('scales the optimized synth shelf hardware proportionally at width %i', width => {
    const source = synthShelfProject()
    const snapshot = structuredClone(source)
    const next = resizePanels(source, [source.panels[0].id], { width })
    const before = positions(source), after = positions(next)
    expect(after.map(piece => piece.id)).toEqual(before.map(piece => piece.id))
    after.forEach((piece, index) => expect(piece.fraction).toBeCloseTo(before[index].fraction, 7))
    expect(source).toEqual(snapshot)
    expect(roundTripProject(next)).toEqual(next)
    const restored = resizePanels(next, [source.panels[0].id], { width: 900 })
    positions(restored).forEach((piece, index) => expect(piece.fraction).toBeCloseTo(before[index].fraction, 7))
  })

  it('rejects shrinking when the scaled distribution would crowd installed pieces', () => {
    const source = synthShelfProject()
    const snapshot = structuredClone(source)
    expect(() => resizePanels(source, [source.panels[0].id], { width: 200 })).toThrow('crowd connectors')
    expect(source).toEqual(snapshot)
  })

  it('scales hidden hardware and removed-piece positions without losing appearance overrides', () => {
    const source = synthShelfProject()
    source.panels = source.panels.map(panel => ({ ...panel, visible: false }))
    const key = Object.keys(source.connectorOverrides!)[0]
    source.connectorOverrides![key] = { ...source.connectorOverrides![key], removed: true, color: '#123456' }
    const next = resizePanels(source, [source.panels[0].id], { width: 1200 })
    expect(next.connectorOverrides![key]).toMatchObject({ removed: true, color: '#123456' })
    expect(next.connectorOverrides![key].slide).toBeCloseTo(70 * 1160 / 860)
    const before = positions(source)
    positions(next).forEach((piece, index) => expect(piece.fraction).toBeCloseTo(before[index].fraction, 7))
  })
})

function joint(type:'90'|'t'|'cross') {
  const parent=createPanel({width:200,height:200,position:[0,0,0]})
  return attachPanel({version:1,name:'Removed hardware',panels:[parent],connections:[]},parent.id,
    createPanel({width:200,height:200}),{type,side:'top',offset:0,inset:0,flip:false,color:'#ffffff',count:4})
}

describe('shrinking joints after removing hardware',()=>{
  it.each(['90','t','cross'] as const)('%s shrinks with one installed piece and retains removed identities',type=>{
    const source=joint(type)
    const pieces=getPhysicalConnectors(source)
    const removed=editConnectors(source,pieces.slice(1).map(piece=>piece.id),{removed:true,color:'#123456'})
    const original=structuredClone(removed)
    const resized=resizePanels(removed,removed.panels.map(panel=>panel.id),{width:100})
    expect(validateProject(resized)).toEqual([])
    expect(resized.connections).toEqual(removed.connections)
    expect(getPhysicalConnectors(resized).map(piece=>piece.id)).toEqual([pieces[0].id])
    for(const piece of pieces.slice(1))expect(resized.connectorOverrides![piece.id]).toMatchObject({removed:true,color:'#123456'})
    expect(removed).toEqual(original)
    expect(roundTripProject(resized)).toEqual(resized)
    // Only saved positions that still fit may be restored; the full four do not fit.
    const partial=restoreRemovedConnectors(resized)
    expect(partial.connectors).toBeGreaterThan(0)
    expect(getPhysicalConnectors(partial.project).length).toBeLessThan(4)
    expect(validateProject(partial.project)).toEqual([])
    const expanded=resizePanels(resized,resized.panels.map(panel=>panel.id),{width:200})
    const restored=restoreRemovedConnectors(expanded)
    expect(restored.connectors).toBe(3)
    expect(getPhysicalConnectors(restored.project).map(piece=>piece.id)).toEqual(pieces.map(piece=>piece.id))
    expect(validateProject(restored.project)).toEqual([])
    expect(roundTripProject(restored.project)).toEqual(restored.project)
  })

  it.each(['90','t','cross'] as const)('%s with no installed pieces retains structural checks',type=>{
    const source=joint(type)
    const removed=editConnectors(source,getPhysicalConnectors(source).map(piece=>piece.id),{removed:true})
    const resized=resizePanels(removed,removed.panels.map(panel=>panel.id),{width:40})
    expect(getPhysicalConnectors(resized)).toEqual([])
    expect(validateProject(resized)).toEqual([])
    const misaligned={...resized,connections:resized.connections.map(connection=>({...connection,role:'support' as const})),
      panels:resolvePanels(resized).map((panel,index)=>index?{...panel,position:[panel.position[0]+10,panel.position[1],panel.position[2]] as [number,number,number]}:panel)}
    expect(validateProject(misaligned).some(issue=>issue.id.endsWith('-alignment'))).toBe(true)
  })

  it('still rejects installed pieces whose actual proportional positions would crowd',()=>{
    const source=joint('90')
    const pieces=getPhysicalConnectors(source)
    const removed=editConnectors(source,pieces.slice(2).map(piece=>piece.id),{removed:true})
    // Two pieces could fit on a 100 mm edge, but these adjacent indices would be 20 mm apart.
    expect(()=>resizePanels(removed,removed.panels.map(panel=>panel.id),{width:100})).toThrow('crowd connectors')
  })
})
