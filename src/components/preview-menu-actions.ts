import { ArrowDownToLine, Box, Check, Clipboard, Copy, FolderPlus, Grid2X2, Link2, Maximize, Pencil, Plus, Rows3, Scan, Scissors, SlidersHorizontal, Square, Unlink, Ungroup, Trash2, type LucideIcon } from 'lucide-react'
import type { PreviewMenuAction } from './PreviewContextMenu'
import type { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { assemblySelectionError } from '@/lib/assemblies'
import { panelDistribution } from '@/lib/panel-distribution'
import { parallelPanelCut } from '@/lib/parallel-panels'
import type { findPanelHoles } from '@/lib/close-holes'
import type { Panel, Project, ListKind } from '@/lib/types'

interface MenuContext {
  project: Project
  panels: Panel[]
  selectedPanels: Panel[]
  selectedIds: string[]
  selectedConnectorIds: string[]
  selectedIdSet: Set<string>
  inspectingConnectors: boolean
  modalOpen: boolean
  assembly: Pick<ReturnType<typeof useAssemblyEditor>, 'editingInstance' | 'selectedInstance' | 'memberInstance' | 'hasMembers' | 'done' | 'edit' | 'select' | 'disconnect' | 'independent' | 'disassemble'>
  canAddConnectorsBetween?: boolean
  canConnectWithPanel: boolean
  canAttachPanel?: boolean
  canExtendToGround: boolean
  canAttachCopy: boolean
  splitCounts: number[]
  checkingSplits: boolean
  canDivideGrid: boolean
  holes: ReturnType<typeof findPanelHoles>
  canMenuAutoConnect: boolean
  hasVisiblePanels: boolean
  actions: {
    inspectConnectors: () => void
    inspectPanels: () => void
    attachCopy: () => void
    fitView: () => void
    openTool: (tool: 'assembly' | 'grid' | 'parallel') => void
    copy: () => void
    addConnectorsBetween?: () => void
    connectWithPanel: () => void
    groupSelected: (kind: ListKind, ids: string[]) => void
    removeSelectedConnectors: () => void
    openConstraints: (add?: boolean) => void
    startAttach: () => void
    extendToGround: () => void
    detachSelection: () => void
    splitSelection: () => void
    distributeSelection: () => void
    closeHole: (id: string) => void
    duplicateSelected: () => void
    deleteSelected: () => void
    addPanel: () => void
    addAutoConnectors: () => void
    selectAll: () => void
  }
}
type AddAction = (label: string, icon: LucideIcon, run: () => void, danger?: boolean, disabled?: boolean) => void

function addConnectorActions(context: MenuContext, menuAction: AddAction) {
  const {selectedConnectorIds, modalOpen, assembly, canConnectWithPanel, actions}=context
  const {connectWithPanel, groupSelected, removeSelectedConnectors}=actions
  if(!assembly.editingInstance&&!modalOpen)menuAction('Connect with a panel',Link2,connectWithPanel,false,!canConnectWithPanel)
  if(context.canAddConnectorsBetween && actions.addConnectorsBetween && !modalOpen)menuAction('Add connectors between',Plus,actions.addConnectorsBetween)
  menuAction('Group selected',FolderPlus,()=>groupSelected('connectors',selectedConnectorIds),false,selectedConnectorIds.length<2)
  menuAction('Inspect connectors',SlidersHorizontal,actions.inspectConnectors)
  menuAction('Copy',Clipboard,context.actions.copy)
  menuAction('Remove connectors',Trash2,removeSelectedConnectors,true)
}

function addEditingActions(context: MenuContext, menuAction: AddAction) {
  const {assembly, actions}=context
  menuAction('Inspect assembly parts',SlidersHorizontal,actions.inspectConnectors)
  menuAction('Done editing assembly',Check,assembly.done)
}

function addLoosePanelActions(context: MenuContext, menuAction: AddAction) {
  const {project, selectedPanels, selectedIds, selectedIdSet, canExtendToGround, splitCounts, checkingSplits, canDivideGrid, actions}=context
  const {groupSelected, openConstraints, startAttach, extendToGround, detachSelection, splitSelection}=actions
  menuAction('Add constraint',SlidersHorizontal,()=>openConstraints(true))
  menuAction('Group selected',FolderPlus,()=>groupSelected('panels',selectedIds),false,selectedPanels.length<2)
  if (selectedPanels.length===1) menuAction('Attach a panel (A)',Link2,startAttach,false,context.canAttachPanel===false)
  menuAction('Extend to ground',ArrowDownToLine,extendToGround,false,!canExtendToGround)
  if (selectedPanels.length>1) menuAction('Create assembly',Box,()=>actions.openTool('assembly'),false,!!assemblySelectionError(project,selectedIds))
  if (project.connections.some(c=>selectedIdSet.has(c.parentId)||selectedIdSet.has(c.childId))) menuAction('Disconnect panels',Unlink,detachSelection)
  if (panelDistribution(selectedPanels)) menuAction('Distribute evenly',Rows3,actions.distributeSelection)
  if (splitCounts.includes(1)) menuAction('Split in the middle',Scissors,()=>splitSelection())
  if (canDivideGrid) menuAction('Divide into a grid',Grid2X2,()=>actions.openTool('grid'))
  if (parallelPanelCut(selectedPanels)) menuAction('Split x times',Rows3,()=>actions.openTool('parallel'),false,checkingSplits||!splitCounts.length)
}

function addPanelActions(context: MenuContext, menuAction: AddAction) {
  const {project, panels, selectedPanels, assembly, canAttachCopy, holes, canMenuAutoConnect, actions}=context
  const {closeHole, duplicateSelected, deleteSelected, addPanel, addAutoConnectors}=actions
  const instance=assembly.selectedInstance
  if (selectedPanels.length) {
    menuAction('Inspect selection',SlidersHorizontal,actions.inspectPanels)
    if (instance) {
      menuAction('Edit assembly',Pencil,()=>assembly.edit(instance.id))
      if (canAttachCopy) menuAction('Attach a copy',Copy,actions.attachCopy)
      if (project.assemblies?.links.some(link=>link.a.instanceId===instance.id||link.b.instanceId===instance.id)) menuAction('Disconnect from neighbors',Unlink,()=>assembly.disconnect(instance.id))
      menuAction('Make independent',Unlink,()=>assembly.independent(instance.id))
      menuAction('Disassemble',Ungroup,()=>assembly.disassemble(instance.id))
    } else if (assembly.memberInstance) {
      const memberInstance = assembly.memberInstance
      menuAction('Select assembly',Box,()=>assembly.select(memberInstance.id))
      menuAction('Edit assembly',Pencil,()=>assembly.edit(memberInstance.id))
    } else if (!assembly.hasMembers) {
      addLoosePanelActions(context, menuAction)
    }
    if (instance || !assembly.hasMembers) for (const hole of holes) menuAction(`${hole.alignment ? 'Review hole fit' : 'Fill hole'} · ${hole.label}`,Square,()=>closeHole(hole.id))
    menuAction('Copy',Clipboard,actions.copy)
    if (!assembly.memberInstance || instance) {
      menuAction('Duplicate',Copy,duplicateSelected)
      menuAction('Delete selection',Trash2,deleteSelected,true)
    }
  } else menuAction('Add panel',Plus,addPanel)
  if (panels.length>1) menuAction('Auto-connect',Link2,addAutoConnectors,false,!canMenuAutoConnect)
}

export function buildPreviewMenuActions(context: MenuContext): PreviewMenuAction[] {
  const {panels, assembly, selectedIdSet, inspectingConnectors, hasVisiblePanels, actions}=context
  const {selectAll, openConstraints}=actions
  const menuActions: PreviewMenuAction[]=[]
  const menuAction: AddAction = (label: string, icon: LucideIcon, run: () => void, danger = false, disabled = false) => menuActions.push({ label, icon, run, danger, disabled })
  if (inspectingConnectors) addConnectorActions(context, menuAction)
  else if (assembly.editingInstance) addEditingActions(context, menuAction)
  else addPanelActions(context, menuAction)
  if (panels.length) menuAction('Select all panels',Scan,()=>selectAll(),false,!inspectingConnectors&&(assembly.editingInstance?Object.values(assembly.editingInstance.panelIds):panels.map(panel=>panel.id)).every(id=>selectedIdSet.has(id)))
  if(!assembly.editingInstance)menuAction('All constraints',SlidersHorizontal,()=>openConstraints())
  menuAction('Fit view',Maximize,actions.fitView,false,!hasVisiblePanels)
  return menuActions
}
