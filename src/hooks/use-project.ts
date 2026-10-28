import { useCallback, useEffect, useRef, useState } from 'react'
import { createStarterProject, parseProject } from '@/lib/model'
import { repairLegacyShelf } from '@/lib/legacy-shelf'
import type { Project } from '@/lib/types'
const STORAGE_KEY = 'playwood-studio-project-v1'
function initialProject(): Project {
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return parseProject(JSON.parse(saved)) } catch { /* A broken or unavailable store must not prevent opening the editor. */ }
  return createStarterProject('shelf')
}
export function useProject() {
  const [history, setHistory] = useState<{past:Project[];present:Project;future:Project[]}>(() => ({past:[], present:initialProject(), future:[]}))
  const [saveStatus, setSaveStatus] = useState('Saved on this device')
  const [repairNotice, setRepairNotice] = useState('')
  const checkedLegacyShelf = useRef(false)
  const latest = useRef(history.present)
  latest.current = history.present
  const commit = useCallback((next:Project|((current:Project)=>Project)) => {
    setHistory(h=>{ const present = typeof next === 'function' ? next(h.present) : next; if (JSON.stringify(present) === JSON.stringify(h.present)) return h; return {past:[...h.past.slice(-59),h.present],present,future:[]} })
  },[])
  const undo = useCallback(()=>setHistory(h=>h.past.length ? {past:h.past.slice(0,-1),present:h.past[h.past.length-1],future:[h.present,...h.future]} : h),[])
  const redo = useCallback(()=>setHistory(h=>h.future.length ? {past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)} : h),[])
  useEffect(() => {
    if (checkedLegacyShelf.current) return
    checkedLegacyShelf.current = true
    const repaired = repairLegacyShelf(latest.current)
    if (repaired !== latest.current) {
      commit(repaired)
      setRepairNotice('Middle shelf joints corrected to T connectors. Undo is available.')
    }
  }, [commit])
  useEffect(()=>{ setSaveStatus('Saving…'); const timer = window.setTimeout(()=>{ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.present)); setSaveStatus('Saved on this device') } catch { setSaveStatus('Storage unavailable · export to save') } },400); return ()=>window.clearTimeout(timer) },[history.present])
  useEffect(()=>{const save = ()=>{try{localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current))}catch{/* status already communicates unavailable storage */}};window.addEventListener('pagehide',save);return()=>window.removeEventListener('pagehide',save)},[])
  return {project:history.present,commit,undo,redo,canUndo:!!history.past.length,canRedo:!!history.future.length,saveStatus,repairNotice}
}
