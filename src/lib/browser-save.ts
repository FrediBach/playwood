import type { Project } from './types'

export const PROJECT_STORAGE_KEY='playwood-studio-project-v1'
export const PROJECT_DRAFT_KEY='playwood-studio-project-draft-v1'
export interface BrowserDraft {base:string|null;content:string}

// Only this origin's primary writer uses this lock. Page exit writes a tab-local
// draft instead: an asynchronous lock cannot be relied upon during unload.
export async function writeBrowserProject(base:string|null,content:string):Promise<boolean> {
  if(!navigator.locks) throw new Error('Browser save coordination unavailable · export to save')
  return navigator.locks.request(PROJECT_STORAGE_KEY,()=>{
    if(localStorage.getItem(PROJECT_STORAGE_KEY)!==base)return false
    localStorage.setItem(PROJECT_STORAGE_KEY,content)
    return true
  })
}
export function readBrowserDraft():BrowserDraft|null {
  try {
    const value:unknown=JSON.parse(sessionStorage.getItem(PROJECT_DRAFT_KEY)??'null')
    if(value&&typeof value==='object'&&'base' in value&&'content' in value&&
      (value.base===null||typeof value.base==='string')&&typeof value.content==='string')return value as BrowserDraft
  } catch { /* The primary save remains available. */ }
  return null
}
export function preserveBrowserDraft(base:string|null,project:Project) {
  sessionStorage.setItem(PROJECT_DRAFT_KEY,JSON.stringify({base,content:JSON.stringify(project)}))
}
