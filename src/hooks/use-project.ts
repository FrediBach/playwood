import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createStarterProject, parseProject } from '@/lib/model'
import { repairLegacyShelf } from '@/lib/legacy-shelf'
import { repairLegacyExampleInserts } from '@/lib/legacy-example-inserts'
import type { Project } from '@/lib/types'
const STORAGE_KEY = 'playwood-studio-project-v1'
function initialProject(): Project {
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return parseProject(JSON.parse(saved)) } catch { /* A broken or unavailable store must not prevent opening the editor. */ }
  return createStarterProject('shelf')
}
export function useProject() {
  // Prepare repairs before the first render, so the displayed project and the
  // initial autosave share one version. Retain the saved original for Undo.
  const [history, setHistory] = useState<{past:Project[];present:Project;future:Project[];repairNotice:string}>(() => {
    const original = initialProject()
    const shelf = repairLegacyShelf(original)
    const present = repairLegacyExampleInserts(shelf)
    const repairNotice = present === original ? '' : present !== shelf
      ? 'Library inserts fitted to their compartments. Undo is available.'
      : 'Middle shelf joints corrected to T connectors. Undo is available.'
    return { past: present === original ? [] : [original], present, future: [], repairNotice }
  })
  const [saveStatus, setSaveStatus] = useState('Saved on this device')
  const latest = useRef(history.present)
  useLayoutEffect(() => { latest.current = history.present }, [history.present])
  const commit = useCallback((next:Project|((current:Project)=>Project)) => {
    setHistory(h=>{ const present = typeof next === 'function' ? next(h.present) : next; if (JSON.stringify(present) === JSON.stringify(h.present)) return h; return {...h,past:[...h.past.slice(-59),h.present],present,future:[]} })
  },[])
  const undo = useCallback(()=>setHistory(h=>h.past.length ? {...h,past:h.past.slice(0,-1),present:h.past[h.past.length-1],future:[h.present,...h.future]} : h),[])
  const redo = useCallback(()=>setHistory(h=>h.future.length ? {...h,past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)} : h),[])
  useEffect(()=>{ setSaveStatus('Saving…'); const timer = window.setTimeout(()=>{ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current)); setSaveStatus('Saved on this device') } catch { setSaveStatus('Storage unavailable · export to save') } },400); return ()=>window.clearTimeout(timer) },[history.present])
  useEffect(()=>{const save = ()=>{try{localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current))}catch{/* status already communicates unavailable storage */}};window.addEventListener('pagehide',save);return()=>window.removeEventListener('pagehide',save)},[])
  return {project:history.present,commit,undo,redo,canUndo:!!history.past.length,canRedo:!!history.future.length,saveStatus,repairNotice:history.repairNotice}
}
