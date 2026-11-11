import { describe,it,expect,vi } from 'vitest'
import { createProjectFileCommands } from './project-file-commands'
import { createStarterProject } from '@/lib/model'
import type { Project } from '@/lib/types'

function setup() {
  let project=createStarterProject('shelf')
  let documentId='first'
  const commit=vi.fn((next:Project)=>{project=next;documentId='replacement'})
  const setImportError=vi.fn(),setAssemblyImportError=vi.fn()
  const options=new Proxy({project,commit,getSnapshot:()=>({project,documentId}),importRequest:{current:0},
    setImportError,setAssemblyImportError,selectedIds:[],
    clipboard:{cancel:vi.fn()},constraints:{cancel:vi.fn()},assembly:{close:vi.fn()},
  },{get:(target,key)=>Reflect.get(target,key)??vi.fn()}) as unknown as Parameters<typeof createProjectFileCommands>[0]
  return {commands:createProjectFileCommands(options),commit,setImportError,setAssemblyImportError,
    edit:()=>{project={...project,name:'Intervening edit'}},replace:()=>{documentId='new document'},current:()=>project}
}
function delayedFile() {
  let resolve!:(text:string)=>void
  const text=new Promise<string>(done=>{resolve=done})
  return {file:{size:10,text:()=>text} as File,resolve}
}
describe('delayed file imports',()=>{
  for(const kind of ['importProject','importAssembly'] as const) {
    for(const change of ['edit','replace'] as const) {
      it(`${kind} rejects an intervening ${change}`,async()=>{
        const state=setup(),file=delayedFile()
        const pending=state.commands[kind](file.file)
        state[change]()
        file.resolve('{}')
        await pending
        expect(state.commit).not.toHaveBeenCalled()
        expect(kind==='importProject'?state.setImportError:state.setAssemblyImportError).toHaveBeenCalledWith(expect.stringContaining('project changed'))
      })
    }
  }
  it('keeps the newest import when reads complete in reverse order',async()=>{
    const state=setup(),first=delayedFile(),second=delayedFile()
    const old=state.commands.importProject(first.file)
    const latest=state.commands.importProject(second.file)
    second.resolve(JSON.stringify({...createStarterProject('shelf'),name:'Newest'}))
    await latest
    first.resolve(JSON.stringify({...createStarterProject('shelf'),name:'Obsolete'}))
    await old
    expect(state.current().name).toBe('Newest')
    expect(state.commit).toHaveBeenCalledTimes(1)
    expect(state.setImportError).not.toHaveBeenCalledWith(expect.stringContaining('changed'))
  })
})
