import { DesignConstraintsInspector } from '@/components/DesignConstraintsInspector'
import { useDesignConstraints } from '@/hooks/use-design-constraints'
import { getAssemblyInstance,isPanelConnectedToAssembly } from '@/lib/assemblies'
import type { Panel,Project } from '@/lib/types'
import { type SetStateAction } from 'react'


interface EditorConstraintsProps {
  panels: Panel[]
  project: Project
  selectedIds: string[]
  constraints: ReturnType<typeof useDesignConstraints>
  constraintPicker: React.RefObject<((id: string) => boolean) | null>
  setPickingConstraint: React.Dispatch<React.SetStateAction<boolean>>
  constraintFooter: HTMLDivElement|null
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedIds: (next: SetStateAction<string[]>) => void
  setFrameSignal: React.Dispatch<React.SetStateAction<number>>
}

export function EditorConstraints({ panels, project, selectedIds, constraints, constraintPicker, setPickingConstraint, constraintFooter, setRightOpen, setSelectedIds, setFrameSignal }: EditorConstraintsProps)  {
  return <DesignConstraintsInspector
    panels={panels}
    constraints={project.constraints??[]}
    selectedIds={selectedIds}
    unavailablePanelIds={panels.filter(panel => getAssemblyInstance(project,panel.id)||isPanelConnectedToAssembly(project,panel.id)).map(panel => panel.id)}
    previewError={constraints.previewError}
    previewSummary={constraints.previewSummary}
    openRequest={constraints.openRequest}
    manageRequest={constraints.manageRequest}
    cancelRequest={constraints.cancelRequest}
    onPreview={constraints.onPreview}
    onApply={constraints.onApply}
    onRemove={constraints.onRemove}
    onToggle={constraints.onToggle}
    onEditingChange={editing => { constraints.onEditingChange(editing); if(!editing) { constraintPicker.current=null; setPickingConstraint(false)}  } }
    onHighlight={constraints.onHighlight}
    footerContainer={constraintFooter}
    onPickPanel={onPicked => { constraintPicker.current=onPicked; setPickingConstraint(true); if(window.innerWidth<=900) setRightOpen(false) } }
    onFindPanels={ids => { setSelectedIds(ids); setRightOpen(true); setFrameSignal(value => value+1) } } />
}
