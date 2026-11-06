import { PanelPaletteProvider } from '@/components/PanelColorField'
import { type ProjectDialog } from '@/components/ProjectDialogs'
import { INITIAL_ATTACHMENT } from '@/editor/editor-defaults'
import { useProject } from '@/hooks/use-project'
import { getAssemblyInstance } from '@/lib/assemblies'
import { getAutoConnectFit } from '@/lib/auto-connect-fit'
import { addCustomColor,getProjectPalette,removeCustomColor,updateCustomColor } from '@/lib/custom-colors'
import { orderedConnectors } from '@/lib/list-groups'
import { createPanel } from '@/lib/model'
import type { AttachmentOptions,CameraView,ListKind,Panel,Project,Side,TrofastInsert } from '@/lib/types'
import { useCallback,useEffect,useMemo,useRef,useState,type SetStateAction } from 'react'

export function useEditorState(project: Project) {
  const [assemblyTab,setAssemblyTab]=useState<ListKind|'objects'>('panels')
  const [selectedConnectorIds,setSelectedConnectorIds]=useState<string[]>([])
  const [connectorTypeError,setConnectorTypeError]=useState<{source:Project;selection:string;message:string}|null>(null)
  const [selectedIds,setPanelSelection]=useState<string[]>(()=>{const first=project.panels[0];const instance=first&&getAssemblyInstance(project,first.id);return instance?Object.values(instance.panelIds):first?[first.id]:[]})
  const setSelectedIds=useCallback((next:SetStateAction<string[]>)=>{setAssemblyTab('panels');setSelectedConnectorIds([]);setPanelSelection(next)},[])
  const setSelectedId=useCallback((id:string|null)=>setSelectedIds(id?[id]:[]),[])
  const [contextMenu,setContextMenu]=useState<{x:number;y:number}|null>(null)
  const [constraintFooter,setConstraintFooter]=useState<HTMLDivElement|null>(null)
  const [projectConstraintsOpen,setProjectConstraintsOpen]=useState(false)
  const constraintPicker=useRef<((id:string)=>boolean)|null>(null)
  const [pickingConstraint,setPickingConstraint]=useState(false)
  const [panelEditError,setPanelEditError]=useState<{selection:string;message:string}|null>(null)
  const closeContextMenu=useCallback(()=>setContextMenu(null),[])
  const [toolRequest,setToolRequest]=useState<{tool:'grid'|'parallel'|'assembly'|'holes';selection:string;token:number;holeId?:string}>()
  const [inspectorTab,setInspectorTab]=useState<'panel'|'attach'>('panel')
  const [trofastPreview,setTrofastPreview]=useState<{source:Project;panelId:string;inserts:TrofastInsert[]}|null>(null)
  const previewTrofast=useCallback((panelId:string,inserts:TrofastInsert[]|null)=>{
    setTrofastPreview(inserts?{source:project,panelId,inserts}:null)
  },[project])
  const [dialog,setDialog]=useState<ProjectDialog>(null)
  const [pendingConnectionFit,setPendingConnectionFit]=useState<{source:Project;fit:NonNullable<ReturnType<typeof getAutoConnectFit>>}|null>(null)
  const [connectorInfill,setConnectorInfill]=useState<{source:Project;ids:string[]}|null>(null)
  const [objectConversion,setObjectConversion]=useState<{source:Project;ids:string[]}|null>(null)
  const modalOpen=!!dialog||!!pendingConnectionFit||!!connectorInfill||!!objectConversion
  useEffect(()=>setPendingConnectionFit(current=>current&&current.source!==project?null:current),[project])
  const [pendingTemplate,setPendingTemplate]=useState<{id:string;project:Project;returnTo:ProjectDialog}|null>(null)
  const [draft,setDraft]=useState(()=>createPanel({name:'My panel',width:600,height:360,thickness:18}))
  const projectPalette=useMemo(()=>getProjectPalette({customColors:project.customColors}),[project.customColors])
  const previousPalette=useRef(projectPalette)
  useEffect(()=>{
    const previous=previousPalette.current
    previousPalette.current=projectPalette
    setDraft(current=>{
      if(projectPalette.some(option=>option.color===current.color.toLowerCase()))return current
      const before=previous.find(option=>option.color===current.color.toLowerCase())
      const replacement=before&&projectPalette.find(option=>option.id===before.id)
      return {...current,color:replacement?.color??projectPalette[0].color}
    })
  },[projectPalette])
  const [attachTarget,setAttachTarget]=useState('new')
  const [attachment,setAttachment]=useState<AttachmentOptions>(INITIAL_ATTACHMENT)
  const [attachmentSideHighlight,setAttachmentSideHighlight]=useState<{panelId:string;side:Side}|null>(null)
  const [view,setView]=useState<CameraView>('perspective')
  const [boxSelectActive,setBoxSelectActive]=useState(false)
  const [realisticPreview,setRealisticPreview]=useState(false)
  const [showGrid,setShowGrid]=useState(true),[showDimensions,setShowDimensions]=useState(false),[exploded,setExploded]=useState(false)
  const [fitSignal,setFitSignal]=useState(0),[zoomSignal,setZoomSignal]=useState({direction:0,key:0})
  const [frameSignal,setFrameSignal]=useState(0)
  const [leftOpen,setLeftOpen]=useState(window.innerWidth>900),[rightOpen,setRightOpen]=useState(window.innerWidth>680)
  useEffect(()=>{
    const closeOverlappingSidebar=()=>{if(window.innerWidth<=900)setLeftOpen(false)}
    window.addEventListener('resize',closeOverlappingSidebar)
    return()=>window.removeEventListener('resize',closeOverlappingSidebar)
  },[])
  const [toast,setToast]=useState(''),[importError,setImportError]=useState('')
  const importRef=useRef<HTMLInputElement>(null)
  const assemblyImportRef=useRef<HTMLInputElement>(null)
  const [assemblyImportError,setAssemblyImportError]=useState('')
  return { assemblyTab, setAssemblyTab, selectedConnectorIds, setSelectedConnectorIds, connectorTypeError, setConnectorTypeError, selectedIds, setPanelSelection, setSelectedIds, setSelectedId, contextMenu, setContextMenu, constraintFooter, setConstraintFooter, projectConstraintsOpen, setProjectConstraintsOpen, constraintPicker, pickingConstraint, setPickingConstraint, panelEditError, setPanelEditError, closeContextMenu, toolRequest, setToolRequest, inspectorTab, setInspectorTab, trofastPreview, previewTrofast, dialog, setDialog, pendingConnectionFit, setPendingConnectionFit, connectorInfill, setConnectorInfill, objectConversion, setObjectConversion, modalOpen, pendingTemplate, setPendingTemplate, draft, setDraft, attachTarget, setAttachTarget, attachment, setAttachment, attachmentSideHighlight, setAttachmentSideHighlight, view, setView, boxSelectActive, setBoxSelectActive, realisticPreview, setRealisticPreview, showGrid, setShowGrid, showDimensions, setShowDimensions, exploded, setExploded, fitSignal, setFitSignal, zoomSignal, setZoomSignal, frameSignal, setFrameSignal, leftOpen, setLeftOpen, rightOpen, setRightOpen, toast, setToast, importError, setImportError, importRef, assemblyImportRef, assemblyImportError, setAssemblyImportError }
}

export function createPaletteActions(commit: ReturnType<typeof useProject>['commit'],project: Project,setDraft: React.Dispatch<React.SetStateAction<Panel>>): Pick<React.ComponentProps<typeof PanelPaletteProvider>, 'onAddColor' | 'onUpdateColor' | 'onRemoveColor'> {
  return {
    onAddColor: color => commit(current => addCustomColor(current,color)),
    onUpdateColor: (id,color) => {
      const previous=project.customColors?.find(option => option.id===id)?.color
      commit(current => updateCustomColor(current,id,color))
      setDraft(current => current.color.toLowerCase()===previous? { ...current,color: color.color.toLowerCase() }:current)
    },
    onRemoveColor: (id,replacement) => {
      const previous=project.customColors?.find(option => option.id===id)?.color
      commit(current => removeCustomColor(current,id,replacement))
      setDraft(current => current.color.toLowerCase()===previous? { ...current,color: replacement??'#d9bb87' }:current)
    }
  }
}

export function useEditorNotifications(repairNotice: string,notify: (message: string) => void,toast: string,setToast: React.Dispatch<React.SetStateAction<string>>) {
  useEffect(() => { if(repairNotice) notify(repairNotice) },[repairNotice,notify])
  useEffect(() => { if(toast) { const t=setTimeout(() => setToast(''),3500); return () => clearTimeout(t)}  },[toast,setToast])
}

export function useSelectionPruning(setPanelSelection: React.Dispatch<React.SetStateAction<string[]>>,project: Project,setSelectedConnectorIds: React.Dispatch<React.SetStateAction<string[]>>,physicalConnectors: ReturnType<typeof orderedConnectors>) {
  useEffect(() => { setPanelSelection(ids => { const remaining=ids.filter(id => project.panels.some(p => p.id===id)); return remaining.length===ids.length? ids:remaining }) },[project.panels,setPanelSelection])
  useEffect(() => {
    setSelectedConnectorIds(ids => {
      const remaining=ids.filter(id => physicalConnectors.some(connector => connector.id===id))
      return remaining.length===ids.length? ids:remaining
    })
  },[physicalConnectors,setSelectedConnectorIds])
}
