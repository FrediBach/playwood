import { assertProjectSaveBounds } from '@/lib/project-limits'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createStarterProject, parseProject } from '@/lib/model'
import { repairLegacyShelf } from '@/lib/legacy-shelf'
import { repairLegacyExampleInserts } from '@/lib/legacy-example-inserts'
import { ensureProjectPalette } from '@/lib/custom-colors'
import { assertDesignConstraintEdit } from '@/lib/design-constraint-edits'
import { assertOutlineConnectionEdit } from '@/lib/outline-connection-edits'
import { preserveConstructionObjects } from '@/lib/construction-objects'
import type { Project } from '@/lib/types'
import { PROJECT_STORAGE_KEY as STORAGE_KEY, PROJECT_DRAFT_KEY, readBrowserDraft, preserveBrowserDraft, writeBrowserProject } from '@/lib/browser-save'
export interface ProjectSnapshot {project:Project;documentId:string}
interface ProjectHistory {past:ProjectSnapshot[];present:Project;documentId:string;future:ProjectSnapshot[];repairNotice:string;group?:string}
const snapshot = (history:ProjectHistory):ProjectSnapshot => ({project:history.present,documentId:history.documentId})
function initialProject(): {project:Project;recovery:string|null;base:string|null;conflict:boolean} {
  let saved:string|null=null
  try {
    saved=localStorage.getItem(STORAGE_KEY)
    const draft=readBrowserDraft()
    if(draft) {
      try { return {project:parseProject(JSON.parse(draft.content)),recovery:null,base:draft.base,conflict:draft.base!==saved} }
      catch { /* A failed draft must not hide the primary recovery save. */ }
    }
    if(saved!==null) return {project:parseProject(JSON.parse(saved)),recovery:null,base:saved,conflict:false}
  } catch { /* Preserve unreadable bytes until the user explicitly resets the save. */ }
  return {project:createStarterProject('shelf'),recovery:saved,base:saved,conflict:false}
}
export function useProject() {
  const [initial] = useState(initialProject)
  const [recovery, setRecovery] = useState(initial.recovery)
  const recoveryRef = useRef(recovery)
  const base = useRef(initial.base)
  const [saveConflict,setSaveConflict] = useState(initial.conflict)
  const conflictRef = useRef(initial.conflict)
  const lastSaved = useRef(initial.base)
  const saving = useRef(false)
  const [conflictBackupKey] = useState(()=>`${STORAGE_KEY}-recovery-${crypto.randomUUID()}`)
  // Prepare repairs before the first render, so the displayed project and the
  // initial autosave share one version. Retain the saved original for Undo.
  const [history, setHistory] = useState<ProjectHistory>(() => {
    const original = ensureProjectPalette(initial.project)
    const shelf = (original.constraints?.length || original.spaceConstraint?.enabled) ? original : repairLegacyShelf(original)
    const repaired = (original.constraints?.length || original.spaceConstraint?.enabled) ? shelf : repairLegacyExampleInserts(shelf)
    const present = ensureProjectPalette(repaired)
    const repairNotice = repaired === original ? '' : repaired !== shelf
      ? 'Library inserts fitted to their compartments. Undo is available.'
      : 'Middle shelf joints corrected to T connectors. Undo is available.'
    const documentId = crypto.randomUUID()
    return { past: present === original ? [] : [{project:original,documentId}], present, documentId, future: [], repairNotice }
  })
  const [saveStatus, setSaveStatus] = useState(initial.recovery!==null?'Unreadable save preserved · autosave paused':initial.conflict?'Another tab changed the browser save · autosave paused':'Saved on this device')
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
      assertProjectSaveBounds(present)
      if (!options?.replace && JSON.stringify(present) === JSON.stringify(h.present)) return h
      return {...h,past:options?.repeat&&h.group===options.group?h.past:[...h.past.slice(-59),snapshot(h)],present,documentId:options?.replace?crypto.randomUUID():h.documentId,future:[],group:options?.group}
    })
  },[changeHistory])
  const undo = useCallback(()=>changeHistory(h=>{const previous=h.past.at(-1);return previous?{...h,past:h.past.slice(0,-1),present:previous.project,documentId:previous.documentId,future:[snapshot(h),...h.future],group:undefined}:h}),[changeHistory])
  const redo = useCallback(()=>changeHistory(h=>{const next=h.future[0];return next?{...h,past:[...h.past,snapshot(h)],present:next.project,documentId:next.documentId,future:h.future.slice(1),group:undefined}:h}),[changeHistory])
  const getSnapshot = useCallback(()=>snapshot(latest.current),[])
  const reportConflict = useCallback(()=>{
    conflictRef.current=true
    setSaveConflict(true)
    setSaveStatus('Another tab changed the browser save · autosave paused')
  },[])
  const save = useCallback(async()=>{
    if(recoveryRef.current!==null||saving.current)return
    saving.current=true
    try {
      while(!conflictRef.current) {
        const content=JSON.stringify(latest.current.present)
        if(content===lastSaved.current) {sessionStorage.removeItem(PROJECT_DRAFT_KEY);break}
        preserveBrowserDraft(base.current,latest.current.present)
        if(!await writeBrowserProject(base.current,content)) {reportConflict();return}
        base.current=content
        lastSaved.current=content
        // Finish any edit that arrived while waiting for the writer lock.
        if(JSON.stringify(latest.current.present)===content)sessionStorage.removeItem(PROJECT_DRAFT_KEY)
        else preserveBrowserDraft(content,latest.current.present)
      }
      if(!conflictRef.current)setSaveStatus('Saved on this device')
    } catch { setSaveStatus('Storage unavailable · export to save') }
    finally {saving.current=false}
  },[reportConflict])
  useEffect(()=>{
    if(recovery!==null)return
    if(saveConflict) {
      try {
        preserveBrowserDraft(base.current,history.present)
        localStorage.setItem(conflictBackupKey,JSON.stringify(history.present))
      } catch {setSaveStatus('Storage unavailable · export this workspace to keep it')}
      return
    }
    setSaveStatus('Saving…')
    const timer=window.setTimeout(()=>{void save()},400)
    return ()=>window.clearTimeout(timer)
  },[history.present,recovery,saveConflict,save,conflictBackupKey])
  useEffect(()=>{
    const preserve=()=>{
      if(recoveryRef.current!==null)return
      try {
        if(conflictRef.current||JSON.stringify(latest.current.present)!==lastSaved.current)preserveBrowserDraft(base.current,latest.current.present)
        else sessionStorage.removeItem(PROJECT_DRAFT_KEY)
        if(conflictRef.current)localStorage.setItem(conflictBackupKey,JSON.stringify(latest.current.present))
      } catch { /* Export remains available when storage is full. */ }
    }
    const changed=(event:StorageEvent)=>{
      if((event.key===STORAGE_KEY||event.key===null)&&localStorage.getItem(STORAGE_KEY)!==base.current) {
        preserve()
        reportConflict()
      }
    }
    window.addEventListener('pagehide',preserve)
    window.addEventListener('storage',changed)
    return ()=>{window.removeEventListener('pagehide',preserve);window.removeEventListener('storage',changed)}
  },[reportConflict,conflictBackupKey])
  const loadBrowserSave = useCallback(()=>{
    try {
      const bytes=localStorage.getItem(STORAGE_KEY)
      if(bytes===null)throw new Error('No browser save is available · export this workspace to keep it')
      const project=parseProject(JSON.parse(bytes))
      // Preserve this tab's version durably before explicitly switching.
      localStorage.setItem(`${STORAGE_KEY}-recovery-${crypto.randomUUID()}`,JSON.stringify(latest.current.present))
      commit(project,{replace:true})
      base.current=bytes
      lastSaved.current=JSON.stringify(project)
      sessionStorage.removeItem(PROJECT_DRAFT_KEY)
      conflictRef.current=false
      setSaveConflict(false)
      setSaveStatus('Saved on this device')
    } catch(error) {setSaveStatus(error instanceof Error?error.message:'Could not open browser save')}
  },[commit])
  const resetRecovery = useCallback(async()=>{
    try {
      const bytes=recoveryRef.current
      if(bytes===null)return
      // Keep a durable backup before allowing any replacement, even after download.
      localStorage.setItem(`${STORAGE_KEY}-recovery-${crypto.randomUUID()}`,bytes)
      if(localStorage.getItem(STORAGE_KEY)!==bytes) throw new Error('Browser save changed in another tab · export to save')
      const content=JSON.stringify(latest.current.present)
      if(!await writeBrowserProject(bytes,content))throw new Error('Browser save changed in another tab · export to save')
      base.current=content
      lastSaved.current=content
      recoveryRef.current=null
      setRecovery(null)
      setSaveStatus('Saved on this device')
    } catch(error) { setSaveStatus(error instanceof Error?error.message:'Storage unavailable · export to save') }
  },[])
  return {saveConflict,loadBrowserSave,recovery,resetRecovery,project:history.present,documentId:history.documentId,getSnapshot,commit,undo,redo,canUndo:!!history.past.length,canRedo:!!history.future.length,saveStatus,repairNotice:history.repairNotice}
}
