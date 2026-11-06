import type { AttachmentSideGuideState } from '@/components/AttachmentSideGuide'
import { useParallelPanelSplitCounts } from '@/hooks/useParallelPanelSplitCounts'
import { getConnectorPanelFit } from '@/lib/connect-panel'
import { connectorInfillReason } from '@/lib/connector-infill'
import { CONNECTORS } from '@/lib/connector-options'
import { getPanelGroundExtension } from '@/lib/extend-to-ground'
import { gridPanelCut } from '@/lib/grid-split'
import { orderedConnectors } from '@/lib/list-groups'
import { getProjectBounds,validateProject } from '@/lib/model'
import type { AttachmentOptions,Panel,Project,Side } from '@/lib/types'
import { useMemo } from 'react'


interface UsePanelSelectionDetailsOptions {
  selectedIds: string[]
  panels: Panel[]
  project: Project
  attachment: AttachmentOptions
  attachmentSideHighlight: { panelId: string; side: Side } | null
  setAttachmentSideHighlight: React.Dispatch<React.SetStateAction<{ panelId: string; side: Side; } | null>>
  setAttachment: React.Dispatch<React.SetStateAction<AttachmentOptions>>
}

export function usePanelSelectionDetails({ selectedIds, panels, project, attachment, attachmentSideHighlight, setAttachmentSideHighlight, setAttachment }: UsePanelSelectionDetailsOptions) {
  const selectedIdSet=useMemo(()=>new Set(selectedIds),[selectedIds])
  const selectedPanels=panels.filter(p=>selectedIdSet.has(p.id))
  const {counts:splitCounts,checking:checkingSplits}=useParallelPanelSplitCounts(project,selectedIds)
  const gridCut=gridPanelCut(selectedPanels)
  const selectedFinishCoverages=selectedPanels.map(p=>p.material==='painted'?1:p.finishCoverage??0)
  const selected=selectedPanels.length===1?selectedPanels[0]:undefined
  const selectedId=selected?.id??null
  const groundPanelFit=useMemo(()=>selectedId?getPanelGroundExtension(project,selectedId):{result:undefined,reason:'Select one panel to extend.'},[project,selectedId])
  const attachmentSideGuide: AttachmentSideGuideState | undefined=selected?{
    panelId:selected.id,
    side:attachment.side,
    highlightedSide:attachmentSideHighlight?.panelId===selected.id?attachmentSideHighlight.side:null,
    onHighlight:side=>setAttachmentSideHighlight(side?{panelId:selected.id,side}:null),
    onSelect:side=>setAttachment(current=>({...current,side,flip:current.side===side?!current.flip:current.flip})),
  }:undefined
  const connection=project.connections.find(c=>c.childId===selectedId&&c.role!=='support')
  const bounds=useMemo(()=>getProjectBounds(panels),[panels])
  const visibleBounds=useMemo(()=>getProjectBounds(panels.filter(panel=>panel.visible)),[panels])
  const hasVisiblePanels=panels.some(panel=>panel.visible)
  const issues=useMemo(()=>validateProject(project),[project])
  return { selectedIdSet, selectedPanels, splitCounts, checkingSplits, gridCut, selectedFinishCoverages, selected, selectedId, groundPanelFit, attachmentSideGuide, connection, bounds, visibleBounds, hasVisiblePanels, issues }
}

interface UseConnectorSelectionDetailsOptions {
  project: Project
  selectedConnectorIds: string[]
  selectedPanels: Panel[]
  assemblyTab: string
  projectConstraintsOpen: boolean
  setConnectorInfill: React.Dispatch<React.SetStateAction<{ source: Project; ids: string[]; } | null>>
}

export function useConnectorSelectionDetails({ project, selectedConnectorIds, selectedPanels, assemblyTab, projectConstraintsOpen, setConnectorInfill }: UseConnectorSelectionDetailsOptions) {
  const physicalConnectors=useMemo(() => orderedConnectors(project),[project])
  const selectedConnectorIdSet=useMemo(() => new Set(selectedConnectorIds),[selectedConnectorIds])
  const selectedConnectors=physicalConnectors.filter(connector => selectedConnectorIdSet.has(connector.id))
  const inspectingConnectors=selectedConnectors.length>0&&(!selectedPanels.length||assemblyTab==='connectors')
  const managingProjectConstraints=projectConstraintsOpen&&!selectedPanels.length&&!inspectingConnectors
  const selectionKind: 'connectors' | 'panels'=inspectingConnectors? 'connectors':'panels'
  const connectorPanelFit=useMemo(() => getConnectorPanelFit(project,selectedConnectorIds),[project,selectedConnectorIds])
  const infillReason=connectorInfillReason(project,selectedConnectorIds)
  const openConnectorInfill=() => setConnectorInfill({ source: project,ids: [...selectedConnectorIds] })
  const connectorCount=physicalConnectors.length
  const connectorSummary=CONNECTORS.map(type => ({ name: type.name,count: physicalConnectors.filter(c => c.type===type.id).length })).filter(type => type.count>0).map(type => `${type.count} × ${type.name}`).join(' · ')
  return { inspectingConnectors,physicalConnectors,connectorPanelFit,selectedConnectors,infillReason,openConnectorInfill,connectorCount,connectorSummary,selectionKind,managingProjectConstraints }
}
