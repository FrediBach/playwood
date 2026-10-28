import { useMemo } from 'react'
import { attachPanel, attachExistingPanel, resolvePanels, validateProject } from '@/lib/model'
import type { AttachmentOptions, Panel, Project } from '@/lib/types'

interface Options {
  project: Project
  selected?: Panel
  panels: Panel[]
  draft: Panel
  attachment: AttachmentOptions
  inspectorTab: 'panel' | 'attach'
  attachTarget: string
}

export function useAttachmentPreview({project,selected,panels,draft,attachment,inspectorTab,attachTarget}: Options) {
  const previewResult=useMemo(()=>{
    if(inspectorTab!=='attach'||!selected)return {project:null,error:''}
    try {
      const base=attachTarget==='new'?project:{...project,panels:project.panels.map(p=>p.id===attachTarget?{...p,...draft,id:attachTarget}:p)}
      return {project:attachTarget==='new'?attachPanel(base,selected.id,draft,attachment):attachExistingPanel(base,selected.id,attachTarget,attachment),error:''}
    }catch(error){return {project:null,error:error instanceof Error?error.message:'This panel cannot be attached here.'}}
  },[project,selected,draft,attachment,inspectorTab,attachTarget])
  const previewProject=previewResult.project
  const previewPanels=useMemo(()=>previewProject?resolvePanels(previewProject).filter(p=>{const old=panels.find(old=>old.id===p.id);return !old||p.id===attachTarget||JSON.stringify(old.position)!==JSON.stringify(p.position)||JSON.stringify(old.rotation)!==JSON.stringify(p.rotation)}):[],[previewProject,panels,attachTarget])
  const previewIds=new Set(previewPanels.map(p=>p.id))
  const previewConnections=previewProject?.connections.filter(c=>!project.connections.some(old=>old.id===c.id)||previewIds.has(c.childId)||previewIds.has(c.parentId))??[]
  const previewIssues=previewProject?validateProject(previewProject).filter(i=>i.panelIds.some(id=>previewPanels.some(p=>p.id===id))):[]
  const attachmentErrors=previewIssues.filter(i=>i.severity==='error')
  return { previewResult, previewProject, previewPanels, previewConnections, previewIssues, attachmentErrors }
}
