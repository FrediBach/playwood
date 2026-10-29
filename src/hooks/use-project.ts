import { useCallback, useEffect, useRef, useState } from 'react'
import { createStarterProject, parseProject } from '@/lib/model'
import { repairLegacyShelf } from '@/lib/legacy-shelf'
import { repairLegacyExampleInserts } from '@/lib/legacy-example-inserts'
import type { Project } from '@/lib/types'
const STORAGE_KEY = 'playwood-studio-project-v1'
interface ProjectHistory {past:Project[];present:Project;future:Project[];repairNotice:string;group?:string}
function initialProject(): Project {
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return parseProject(JSON.parse(saved)) } catch { /* A broken or unavailable store must not prevent opening the editor. */ }
  return createStarterProject('shelf')
}
export function useProject() {
  // Prepare repairs before the first render, so the displayed project and the
  // initial autosave share one version. Retain the saved original for Undo.
  const [history, setHistory] = useState<ProjectHistory>(() => {
    const original = initialProject()
    const shelf = repairLegacyShelf(original)
    const present = repairLegacyExampleInserts(shelf)
    const repairNotice = present === original ? '' : present !== shelf
      ? 'Library inserts fitted to their compartments. Undo is available.'
      : 'Middle shelf joints corrected to T connectors. Undo is available.'
    return { past: present === original ? [] : [original], present, future: [], repairNotice }
  })
  const [saveStatus, setSaveStatus] = useState('Saved on this device')
  const latest = useRef(history)
  // Serialize commands before React renders: held arrow keys must never solve
  // against an older frame, and rejected geometry must throw to the caller.
  const changeHistory = useCallback((change:(current:ProjectHistory)=>ProjectHistory) => {
    const next=change(latest.current)
    if(next!==latest.current){latest.current=next;setHistory(next)}
  },[])
  const commit = useCallback((next:Project|((current:Project)=>Project), options?:{group:string;repeat:boolean}) => {
    changeHistory(h=>{ const present = typeof next === 'function' ? next(h.present) : next; if (JSON.stringify(present) === JSON.stringify(h.present)) return h; return {...h,past:options?.repeat&&h.group===options.group?h.past:[...h.past.slice(-59),h.present],present,future:[],group:options?.group} })
  },[changeHistory])
  const undo = useCallback(()=>changeHistory(h=>h.past.length ? {...h,past:h.past.slice(0,-1),present:h.past[h.past.length-1],future:[h.present,...h.future],group:undefined} : h),[changeHistory])
  const redo = useCallback(()=>changeHistory(h=>h.future.length ? {...h,past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1),group:undefined} : h),[changeHistory])
  useEffect(()=>{ setSaveStatus('Saving…'); const timer = window.setTimeout(()=>{ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current.present)); setSaveStatus('Saved on this device') } catch { setSaveStatus('Storage unavailable · export to save') } },400); return ()=>window.clearTimeout(timer) },[history.present])
  useEffect(()=>{const save = ()=>{try{localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current.present))}catch{/* status already communicates unavailable storage */}};window.addEventListener('pagehide',save);return()=>window.removeEventListener('pagehide',save)},[])
  return {project:history.present,commit,undo,redo,canUndo:!!history.past.length,canRedo:!!history.future.length,saveStatus,repairNotice:history.repairNotice}
}
