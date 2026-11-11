import {afterEach,describe,expect,it,vi} from 'vitest'
import {PROJECT_STORAGE_KEY,writeBrowserProject} from './browser-save'

afterEach(()=>vi.unstubAllGlobals())
describe('coordinated browser writes',()=>{
  it('serializes contenders and allows only the writer based on the current save',async()=>{
    let content:string|null='original'
    let queue=Promise.resolve()
    vi.stubGlobal('localStorage',{getItem:()=>content,setItem:(key:string,value:string)=>{expect(key).toBe(PROJECT_STORAGE_KEY);content=value}})
    vi.stubGlobal('navigator',{locks:{request:(_key:string,write:()=>boolean)=>{
      const result=queue.then(write)
      queue=result.then(()=>{})
      return result
    }}})
    expect(await Promise.all([writeBrowserProject('original','first'),writeBrowserProject('original','second')])).toEqual([true,false])
    expect(content).toBe('first')
    expect(await writeBrowserProject('first','next revision')).toBe(true)
    expect(content).toBe('next revision')
  })
  it('does not fall back to unsafe writes when coordination is unavailable',async()=>{
    const setItem=vi.fn()
    vi.stubGlobal('localStorage',{setItem})
    vi.stubGlobal('navigator',{})
    await expect(writeBrowserProject(null,'project')).rejects.toThrow('coordination unavailable')
    expect(setItem).not.toHaveBeenCalled()
  })
})
