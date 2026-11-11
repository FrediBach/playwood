import {describe,it,expect} from 'vitest'
import {attachPanel,createPanel,duplicatePanel,parseProject} from './model'
import {assertProjectSaveBounds,MAX_PROJECT_PANELS} from './project-limits'
import type {Project} from './types'
const project=(count:number):Project=>({version:1,name:'Limit test',panels:Array.from({length:count},(_,i)=>createPanel({id:`panel-${i}`,name:'x'.repeat(120),position:[i*450,0,0]})),connections:[]})
const options={type:'90',side:'top',offset:0,inset:0,flip:false,color:'#ffffff',count:1} as const
const roundTrip=(p:Project)=>parseProject(JSON.parse(JSON.stringify(p)))
describe('saved format bounds',()=>{
  it('duplicates at the boundary with a reloadable generated name',()=>{
    const next=duplicatePanel(project(MAX_PROJECT_PANELS-1),'panel-0')
    expect(next.panels.at(-1)!.name).toHaveLength(120)
    expect(next.panels.at(-1)!.name.endsWith(' copy')).toBe(true)
    expect(roundTrip(next).panels).toHaveLength(MAX_PROJECT_PANELS)
    expect(()=>duplicatePanel(next,'panel-0')).toThrow('200 panels')
  })
  it('rejects oversized attachment atomically, including shared branches',()=>{
    const original=project(199),before=JSON.stringify(original)
    expect(()=>attachPanel(original,'panel-0',createPanel(),{...options,type:'t'})).toThrow('200 panels')
    expect(JSON.stringify(original)).toBe(before)
    expect(roundTrip(attachPanel(original,'panel-0',createPanel(),options)).panels).toHaveLength(200)
  })
  it('keeps generated shared branch names reloadable',()=>{
    const next=attachPanel(project(1),'panel-0',createPanel({name:'y'.repeat(120)}),{...options,type:'cross'})
    expect(roundTrip(next).panels.every(p=>p.name.length<=120)).toBe(true)
  })
  it('shares connection bounds with parsing and rejects invalid names before history',()=>{
    const base=project(2)
    const connections=Array.from({length:400},(_,i)=>({...options,id:`joint-${i}`,parentId:'panel-0',childId:'panel-1',role:'support' as const}))
    const full={...base,connections}
    expect(roundTrip(full).connections).toHaveLength(400)
    expect(()=>assertProjectSaveBounds({...full,connections:[...connections,connections[0]]})).toThrow('400 connections')
    expect(()=>attachPanel(full,'panel-0',createPanel(),options)).toThrow('400 connections')
    expect(()=>assertProjectSaveBounds({...base,panels:[{...base.panels[0],name:'x'.repeat(121)}]})).toThrow('Panel name')
  })
})
