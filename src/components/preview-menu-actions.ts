import { previewShortcut, type PreviewCommandLabel } from '@/lib/preview-shortcuts'
import { Eye, ArrowDownToLine, Box, Check, Clipboard, Copy, FolderPlus, Grid2X2, Link2, LockKeyhole, Maximize, Pencil, Plus, Rows3, Scan, Scissors, SlidersHorizontal, Square, Unlink, Ungroup, Trash2, type LucideIcon } from 'lucide-react'
import { differingPanelDimension } from '@/lib/equal-panel-sizes'
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
    cyclePanelVisibility: () => void
    equalizeSizes?: () => void
    inspectConnectors: () => void
    inspectPanels: () => void
    attachCopy: () => void
    fitView: () => void
    openTool: (tool: 'assembly' | 'grid' | 'parallel') => void
    copy: () => void
    separateSelectedConnectors?: () => void
    addConnectorsBetween?: () => void
    connectWithPanel: () => void
    groupSelected: (kind: ListKind, ids: string[]) => void
    removeSelectedConnectors: () => void
    lockPanelSizes: () => void
    openConstraints: (add?: boolean) => void
    startAttach: () => void
    extendToGround: () => void
    detachSelection: () => void
    splitSelection: () => void
    mergeSelection: () => void
    distributeSelection: () => void
    closeHole: (id: string) => void
    duplicateSelected: () => void
    deleteSelected: () => void
    addPanel: () => void
    addAutoConnectors: () => void
    selectAll: () => void
  }
}
const MENU_GROUPS = ['Selection', 'Build', 'Assembly', 'Organize', 'Remove', 'Preview'] as const
type MenuGroup = typeof MENU_GROUPS[number]
type AddAction = (group: MenuGroup, label: PreviewCommandLabel | `Fill hole · ${string}` | `Review hole fit · ${string}`, icon: LucideIcon, run: () => void, danger?: boolean, disabled?: boolean, shortcut?: string) => void

function addConnectorActions(context: MenuContext, menuAction: AddAction) {
  const {selectedConnectorIds, modalOpen, assembly, canConnectWithPanel, actions}=context
  const {connectWithPanel, groupSelected, removeSelectedConnectors}=actions
  if(!assembly.editingInstance&&!modalOpen)menuAction('Build', 'Connect with a panel',Link2,connectWithPanel,false,!canConnectWithPanel)
  if(context.canAddConnectorsBetween && actions.addConnectorsBetween && !modalOpen)menuAction('Build', 'Add connectors between',Plus,actions.addConnectorsBetween)
  menuAction('Organize', 'Group selected',FolderPlus,()=>groupSelected('connectors',selectedConnectorIds),false,selectedConnectorIds.length<2)
  menuAction('Selection', 'Inspect connectors',SlidersHorizontal,actions.inspectConnectors)
  menuAction('Selection', 'Copy',Clipboard,context.actions.copy)
  menuAction('Remove', 'Remove connectors',Trash2,removeSelectedConnectors,true)
}

function addEditingActions(context: MenuContext, menuAction: AddAction) {
  const {assembly, actions}=context
  menuAction('Selection', 'Inspect assembly parts',SlidersHorizontal,actions.inspectConnectors)
  menuAction('Assembly', 'Done editing assembly',Check,assembly.done)
}

function addLoosePanelActions(context: MenuContext, menuAction: AddAction) {
  const {project, selectedPanels, selectedIds, selectedIdSet, canExtendToGround, splitCounts, checkingSplits, canDivideGrid, actions}=context
  const {groupSelected, openConstraints, startAttach, extendToGround, detachSelection, splitSelection}=actions
  if (actions.equalizeSizes) menuAction('Build', 'Make sizes equal',Rows3,actions.equalizeSizes,false,context.modalOpen||!differingPanelDimension(selectedPanels))
  menuAction('Build', 'Add constraint',SlidersHorizontal,()=>openConstraints(true))
  menuAction('Build', 'Lock panel size',LockKeyhole,actions.lockPanelSizes,false,context.modalOpen)
  menuAction('Organize', 'Group selected',FolderPlus,()=>groupSelected('panels',selectedIds),false,selectedPanels.length<2)
  if (selectedPanels.length===1) menuAction('Build', 'Attach a panel',Link2,startAttach,false,context.canAttachPanel===false)
  menuAction('Build', 'Extend to ground',ArrowDownToLine,extendToGround,false,!canExtendToGround)
  if (selectedPanels.length>1) menuAction('Assembly', 'Create assembly',Box,()=>actions.openTool('assembly'),false,!!assemblySelectionError(project,selectedIds))
  if (project.connections.some(c=>selectedIdSet.has(c.parentId)||selectedIdSet.has(c.childId))) menuAction('Remove', 'Disconnect panels',Unlink,detachSelection)
  if (panelDistribution(selectedPanels)) menuAction('Build', 'Distribute evenly',Rows3,actions.distributeSelection)
  if (selectedPanels.length===2) menuAction('Build', 'Merge panels',Square,actions.mergeSelection,false,context.modalOpen)
  if (splitCounts.includes(1)) menuAction('Build', 'Split in the middle',Scissors,()=>splitSelection())
  if (canDivideGrid) menuAction('Build', 'Divide into a grid',Grid2X2,()=>actions.openTool('grid'))
  if (parallelPanelCut(selectedPanels)) menuAction('Build', 'Split x times',Rows3,()=>actions.openTool('parallel'),false,checkingSplits||!splitCounts.length)
}

function addPanelActions(context: MenuContext, menuAction: AddAction) {
  const {project, panels, selectedPanels, assembly, canAttachCopy, holes, canMenuAutoConnect, actions}=context
  const {closeHole, duplicateSelected, deleteSelected, addPanel, addAutoConnectors}=actions
  const instance=assembly.selectedInstance
  if (selectedPanels.length) {
    menuAction('Selection', 'Inspect selection',SlidersHorizontal,actions.inspectPanels)
    if (instance) {
      menuAction('Assembly', 'Edit assembly',Pencil,()=>assembly.edit(instance.id))
      if (canAttachCopy) menuAction('Assembly', 'Attach a copy',Copy,actions.attachCopy)
      if (project.assemblies?.links.some(link=>link.a.instanceId===instance.id||link.b.instanceId===instance.id)) menuAction('Assembly', 'Disconnect from neighbors',Unlink,()=>assembly.disconnect(instance.id))
      menuAction('Assembly', 'Make independent',Unlink,()=>assembly.independent(instance.id))
      menuAction('Assembly', 'Disassemble',Ungroup,()=>assembly.disassemble(instance.id))
    } else if (assembly.memberInstance) {
      const memberInstance = assembly.memberInstance
      menuAction('Assembly', 'Select assembly',Box,()=>assembly.select(memberInstance.id))
      menuAction('Assembly', 'Edit assembly',Pencil,()=>assembly.edit(memberInstance.id))
    } else if (!assembly.hasMembers) {
      addLoosePanelActions(context, menuAction)
    }
    if (instance || !assembly.hasMembers) for (const [index, hole] of holes.entries()) menuAction('Build', `${hole.alignment ? 'Review hole fit' : 'Fill hole'} · ${hole.label}`,Square,()=>closeHole(hole.id),false,false,`h ${String(index + 1).split('').join(' ')} Enter`)
    menuAction('Selection', 'Copy',Clipboard,actions.copy)
    if (!assembly.memberInstance || instance) {
      menuAction('Selection', 'Duplicate',Copy,duplicateSelected)
      menuAction('Remove', 'Delete selection',Trash2,deleteSelected,true)
    }
  } else menuAction('Build', 'Add panel',Plus,addPanel)
  if (panels.length>1) menuAction('Build', 'Auto-connect',Link2,addAutoConnectors,false,!canMenuAutoConnect)
}

export function buildPreviewMenuActions(context: MenuContext): PreviewMenuAction[] {
  const {panels, assembly, selectedIdSet, inspectingConnectors, hasVisiblePanels, actions}=context
  const {selectAll, openConstraints}=actions
  const menuActions: PreviewMenuAction[]=[]
  const menuAction: AddAction = (group, label, icon, run, danger = false, disabled = false, shortcut = previewShortcut(label)) => menuActions.push({ group, label, icon, run, danger, disabled, shortcut })
  if (inspectingConnectors) addConnectorActions(context, menuAction)
  else if (assembly.editingInstance) addEditingActions(context, menuAction)
  else addPanelActions(context, menuAction)
  if (!inspectingConnectors && context.selectedPanels.length) menuAction('Preview', 'Cycle panel visibility',Eye,actions.cyclePanelVisibility)
  if(context.selectedConnectorIds.length&&actions.separateSelectedConnectors&&!assembly.editingInstance&&!context.modalOpen)menuAction('Build', 'Separate overlapping connectors',Rows3,actions.separateSelectedConnectors)
  if (panels.length) menuAction('Preview', 'Select all panels',Scan,()=>selectAll(),false,!inspectingConnectors&&(assembly.editingInstance?Object.values(assembly.editingInstance.panelIds):panels.map(panel=>panel.id)).every(id=>selectedIdSet.has(id)))
  if(!assembly.editingInstance)menuAction('Preview', 'All constraints',SlidersHorizontal,()=>openConstraints())
  menuAction('Preview', 'Fit view',Maximize,actions.fitView,false,!hasVisiblePanels)
  return MENU_GROUPS.flatMap(group => menuActions.filter(action => action.group === group))
}
