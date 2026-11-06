import { useCallback, useEffect, useRef, useState } from 'react'
import { createStarterProject, parseProject } from '@/lib/model'
import { repairLegacyShelf } from '@/lib/legacy-shelf'
import { repairLegacyExampleInserts } from '@/lib/legacy-example-inserts'
import { ensureProjectPalette } from '@/lib/custom-colors'
import { assertDesignConstraintEdit } from '@/lib/design-constraint-edits'
import { assertOutlineConnectionEdit } from '@/lib/outline-connection-edits'
import { preserveConstructionObjects } from '@/lib/construction-objects'
import type { Project } from '@/lib/types'
const STORAGE_KEY = 'playwood-studio-project-v1'
export interface ProjectSnapshot {project:Project;documentId:string}
interface ProjectHistory {past:ProjectSnapshot[];present:Project;documentId:string;future:ProjectSnapshot[];repairNotice:string;group?:string}
const snapshot = (history:ProjectHistory):ProjectSnapshot => ({project:history.present,documentId:history.documentId})
function initialProject(): Project {
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) return parseProject(JSON.parse(saved)) } catch { /* A broken or unavailable store must not prevent opening the editor. */ }
  return createStarterProject('shelf')
}
export function useProject() {
  // Prepare repairs before the first render, so the displayed project and the
  // initial autosave share one version. Retain the saved original for Undo.
  const [history, setHistory] = useState<ProjectHistory>(() => {
    const original = ensureProjectPalette(initialProject())
    const shelf = (original.constraints?.length || original.spaceConstraint?.enabled) ? original : repairLegacyShelf(original)
    const repaired = (original.constraints?.length || original.spaceConstraint?.enabled) ? shelf : repairLegacyExampleInserts(shelf)
    const present = ensureProjectPalette(repaired)
    const repairNotice = repaired === original ? '' : repaired !== shelf
      ? 'Library inserts fitted to their compartments. Undo is available.'
      : 'Middle shelf joints corrected to T connectors. Undo is available.'
    const documentId = crypto.randomUUID()
    return { past: present === original ? [] : [{project:original,documentId}], present, documentId, future: [], repairNotice }
  })
  const [saveStatus, setSaveStatus] = useState('Saved on this device')
  const latest = useRef(history)
  // Serialize commands before React renders: held arrow keys must never solve
  // against an older frame, and rejected geometry must throw to the caller.
  const changeHistory = useCallback((change:(current:ProjectHistory)=>ProjectHistory) => {
    const next=change(latest.current)
    if(next!==latest.current){latest.current=next;setHistory(next)}
  },[])
  const commit = useCallback((next:Project|((current:Project)=>Project), options?:{group?:string;repeat?:boolean;replace?:boolean}) => {
    changeHistory(h=>{
      const proposed = typeof next === 'function' ? next(h.present) : next
      const candidate = options?.replace ? proposed : preserveConstructionObjects(h.present, proposed)
      const present = ensureProjectPalette(options?.replace ? candidate : assertDesignConstraintEdit(h.present, assertOutlineConnectionEdit(h.present, candidate)))
      if (!options?.replace && JSON.stringify(present) === JSON.stringify(h.present)) return h
      return {...h,past:options?.repeat&&h.group===options.group?h.past:[...h.past.slice(-59),snapshot(h)],present,documentId:options?.replace?crypto.randomUUID():h.documentId,future:[],group:options?.group}
    })
  },[changeHistory])
  const undo = useCallback(()=>changeHistory(h=>{const previous=h.past.at(-1);return previous?{...h,past:h.past.slice(0,-1),present:previous.project,documentId:previous.documentId,future:[snapshot(h),...h.future],group:undefined}:h}),[changeHistory])
  const redo = useCallback(()=>changeHistory(h=>{const next=h.future[0];return next?{...h,past:[...h.past,snapshot(h)],present:next.project,documentId:next.documentId,future:h.future.slice(1),group:undefined}:h}),[changeHistory])
  const getSnapshot = useCallback(()=>snapshot(latest.current),[])
  useEffect(()=>{ setSaveStatus('Saving…'); const timer = window.setTimeout(()=>{ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current.present)); setSaveStatus('Saved on this device') } catch { setSaveStatus('Storage unavailable · export to save') } },400); return ()=>window.clearTimeout(timer) },[history.present])
  useEffect(()=>{const save = ()=>{try{localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current.present))}catch{/* status already communicates unavailable storage */}};window.addEventListener('pagehide',save);return()=>window.removeEventListener('pagehide',save)},[])
  return {project:history.present,documentId:history.documentId,getSnapshot,commit,undo,redo,canUndo:!!history.past.length,canRedo:!!history.future.length,saveStatus,repairNotice:history.repairNotice}
}
