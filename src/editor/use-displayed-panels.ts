import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useDesignConstraints } from '@/hooks/use-design-constraints'
import { resolvePanels } from '@/lib/model'
import type { Panel,Project,TrofastInsert } from '@/lib/types'
import { useEffect } from 'react'


interface UseDisplayedPanelsOptions {
  trofastPreview: { source: Project; panelId: string; inserts: TrofastInsert[] }|null
  project: Project
  selectedId: string|null
  inspectorTab: string
  modalOpen: boolean
  clipboard: ReturnType<typeof useCopyPaste>
  assembly: ReturnType<typeof useAssemblyEditor>
  exploded: boolean
  constraints: ReturnType<typeof useDesignConstraints>
  setFrameSignal: React.Dispatch<React.SetStateAction<number>>
  panels: Panel[]
}

export function useDisplayedPanels({ trofastPreview, project, selectedId, inspectorTab, modalOpen, clipboard, assembly, exploded, constraints, setFrameSignal, panels }: UseDisplayedPanelsOptions) {
  const trofastPreviewActive=trofastPreview?.source===project&&trofastPreview.panelId===selectedId&&inspectorTab==='panel'&&!modalOpen&&!clipboard.active&&!assembly.placementActive&&!exploded
  const constraintPreviewProject=!modalOpen&&inspectorTab==='panel'&&!clipboard.active&&!assembly.placementActive? constraints.previewProject:undefined
  useEffect(() => { if(constraintPreviewProject) setFrameSignal(value => value+1) },[constraintPreviewProject,setFrameSignal])
  const displayPanels=constraintPreviewProject? resolvePanels(constraintPreviewProject):trofastPreviewActive? panels.map(panel => panel.id===trofastPreview.panelId? { ...panel,trofastInserts: trofastPreview.inserts }:panel):panels
  return { constraintPreviewProject,displayPanels }
}
