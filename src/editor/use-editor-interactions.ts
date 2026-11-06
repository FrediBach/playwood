import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useConstructionEditor } from '@/hooks/use-construction-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useDesignConstraints } from '@/hooks/use-design-constraints'
import { useObjectGesture } from '@/hooks/use-object-gesture'
import { useObjectPreview } from '@/hooks/use-object-preview'
import { usePreviewDrag } from '@/hooks/use-preview-drag'
import { usePreviewResize } from '@/hooks/use-preview-resize'
import { useProject } from '@/hooks/use-project'
import { SnapSettings } from '@/lib/preview-snap'
import type { Panel,Project } from '@/lib/types'


interface PanelAttachmentAvailableOptions {
  selectedPanels: Panel[]
  inspectingConnectors: boolean
  assembly: ReturnType<typeof useAssemblyEditor>
  clipboard: ReturnType<typeof useCopyPaste>
  constraints: ReturnType<typeof useDesignConstraints>
  modalOpen: boolean
  drag: ReturnType<typeof usePreviewDrag>
  resize: ReturnType<typeof usePreviewResize>
  boxSelectActive: boolean
  inspectorTab: string
}

export function panelAttachmentAvailable({ selectedPanels, inspectingConnectors, assembly, clipboard, constraints, modalOpen, drag, resize, boxSelectActive, inspectorTab }: PanelAttachmentAvailableOptions) {
  return selectedPanels.length===1&&!inspectingConnectors&&!assembly.hasMembers&&!assembly.editingInstance&&!assembly.placementActive&&!clipboard.active&&!constraints.editing&&!modalOpen&&!drag.active&&!resize.active&&!boxSelectActive&&inspectorTab!=='attach'
}

interface BoxSelectionAvailableOptions {
  constraints: ReturnType<typeof useDesignConstraints>
  modalOpen: boolean
  clipboard: ReturnType<typeof useCopyPaste>
  drag: ReturnType<typeof usePreviewDrag>
  resize: ReturnType<typeof usePreviewResize>
  assembly: ReturnType<typeof useAssemblyEditor>
  inspectorTab: string
  objectMode: boolean
  objectInteractionDisabled: boolean
  objects: ReturnType<typeof useConstructionEditor>
  objectGesture: ReturnType<typeof useObjectGesture>
  hasVisiblePanels: boolean
}

function boxSelectionAvailable({ constraints, modalOpen, clipboard, drag, resize, assembly, inspectorTab, objectMode, objectInteractionDisabled, objects, objectGesture, hasVisiblePanels }: BoxSelectionAvailableOptions) {
  return !constraints.editing&&!modalOpen&&!clipboard.active&&!drag.active&&!resize.active&&!assembly.placementActive&&inspectorTab!=='attach'
    &&(objectMode? !objectInteractionDisabled&&!objects.editing&&!objectGesture.active&&objects.objects.roots.some(id => objects.objects.nodes.find(node => node.id===id)?.visible):hasVisiblePanels)
}

interface SelectionMovementAvailableOptions {
  objectMode: boolean
  constraints: ReturnType<typeof useDesignConstraints>
  clipboard: ReturnType<typeof useCopyPaste>
  modalOpen: boolean
  assembly: ReturnType<typeof useAssemblyEditor>
  inspectingConnectors: boolean
  realisticPreview: boolean
  exploded: boolean
  inspectorTab: string
}

export function selectionMovementAvailable({ objectMode, constraints, clipboard, modalOpen, assembly, inspectingConnectors, realisticPreview, exploded, inspectorTab }: SelectionMovementAvailableOptions) {
  return !objectMode&&!constraints.editing&&!clipboard.active&&!modalOpen&&!assembly.editingInstance&&(inspectingConnectors||!(assembly.memberInstance&&!assembly.selectedInstance))&&!assembly.placementActive&&(realisticPreview||(!exploded&&inspectorTab!=='attach'))
}

interface ObjectInteractionBlockedOptions {
  modalOpen: boolean
  drag: ReturnType<typeof usePreviewDrag>
  resize: ReturnType<typeof usePreviewResize>
  constraints: ReturnType<typeof useDesignConstraints>
  assembly: ReturnType<typeof useAssemblyEditor>
  clipboard: ReturnType<typeof useCopyPaste>
  realisticPreview: boolean
  exploded: boolean
}

function objectInteractionBlocked({ modalOpen, drag, resize, constraints, assembly, clipboard, realisticPreview, exploded }: ObjectInteractionBlockedOptions) {
  return modalOpen||drag.active||resize.active||constraints.editing||!!assembly.editingInstance||clipboard.active||assembly.placementActive||realisticPreview||exploded
}

interface UseObjectInteractionsOptions {
  modalOpen: boolean
  drag: ReturnType<typeof usePreviewDrag>
  resize: ReturnType<typeof usePreviewResize>
  constraints: ReturnType<typeof useDesignConstraints>
  assembly: ReturnType<typeof useAssemblyEditor>
  clipboard: ReturnType<typeof useCopyPaste>
  realisticPreview: boolean
  exploded: boolean
  project: Project
  objects: ReturnType<typeof useConstructionEditor>
  objectMode: boolean
  boxSelectActive: boolean
  snapSettings: SnapSettings
  commit: ReturnType<typeof useProject>['commit']
  notify: (message: string) => void
  inspectorTab: string
  hasVisiblePanels: boolean
}

export function useObjectInteractions({
  modalOpen, drag, resize, constraints,
  assembly, clipboard, realisticPreview, exploded,
  project, objects, objectMode, boxSelectActive,
  snapSettings, commit, notify, inspectorTab,
  hasVisiblePanels
}: UseObjectInteractionsOptions) {
  const objectInteractionDisabled=objectInteractionBlocked({ modalOpen, drag, resize, constraints, assembly, clipboard, realisticPreview, exploded })
  const objectGesture=useObjectGesture({ project,selectedIds: objects.selectedIds,enabled: objectMode&&!objectInteractionDisabled&&!objects.editing&&!boxSelectActive,snapSettings,commit,notify })
  const displayedObjects=objectGesture.objects??objects.objects
  const objectPreview=useObjectPreview(displayedObjects,!realisticPreview&&!exploded)
  const boxSelectAvailable=boxSelectionAvailable({ constraints, modalOpen, clipboard, drag, resize, assembly, inspectorTab, objectMode, objectInteractionDisabled, objects, objectGesture, hasVisiblePanels })
  return { boxSelectAvailable,objectInteractionDisabled,objectGesture,displayedObjects,objectPreview }
}

export function canShowBuildTools({ assembly, clipboard, inspectorTab, selectedPanels }: {
  assembly: ReturnType<typeof useAssemblyEditor>
  clipboard: ReturnType<typeof useCopyPaste>
  inspectorTab: string
  selectedPanels: readonly Panel[]
}) {
  return !assembly.editingInstance && !clipboard.active && !assembly.placementActive && inspectorTab === 'panel' && selectedPanels.length > 0
}
