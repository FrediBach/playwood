import { useEffect, useState } from 'react'
import { copySelection, getPasteTargets, getAssemblyInsertionTargets, type CopiedItem } from '@/lib/clipboard'
import type { AssemblyAttachmentTarget } from '@/lib/assemblies'
import type { Project } from '@/lib/types'

interface Options {
  project: Project
  selectedIds: string[]
  commit: (project: Project) => void
  select: (ids: string[]) => void
  prepare: () => void
  notify: (message: string) => void
}

export function useCopyPaste({ project, selectedIds, commit, select, prepare, notify }: Options) {
  const [clipboard, setClipboard] = useState<CopiedItem | null>(null)
  const [placement, setPlacement] = useState<{ project: Project; selection: string; insertion?: boolean; targets: AssemblyAttachmentTarget[] } | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const selection = selectedIds.join('/')
  useEffect(() => {
    if (placement && (placement.project !== project || placement.selection !== selection)) { setPlacement(null); setHoverId(null) }
  }, [project, selection, placement])
  const active = !!placement && placement.project === project && placement.selection === selection
  const targets = active ? placement.targets : []
  const hovered = targets.find(target => target.id === hoverId)
  const preview = hovered?.project
  const addedPanels = (next: Project) => next.panels.filter(panel => !project.panels.some(old => old.id === panel.id))
  const previewPanels = preview ? addedPanels(preview) : []
  const previewConnections = preview?.connections.filter(connection => !project.connections.some(old => JSON.stringify(old) === JSON.stringify(connection))) ?? []
  const cancel = () => { setPlacement(null); setHoverId(null) }
  return {
    active, targets, hovered, preview, previewPanels, previewConnections,
    inserting: active && placement.insertion,
    suppressedConnectionIds: preview ? project.connections.filter(connection => !preview.connections.some(item => item.id === connection.id)).map(connection => connection.id) : [],
    boundsPanels: targets.flatMap(target => target.project ? addedPanels(target.project) : []),
    cancel, hover: setHoverId,
    insertAssembly: (item: Extract<CopiedItem, { kind: 'assembly' }>) => {
      cancel()
      try {
        const candidates = getAssemblyInsertionTargets(project, selectedIds, item)
        const valid = candidates.filter(target => target.project)
        if (!valid.length) {
          notify('No compatible attachment points on this selection. Clear the selection to insert the assembly freely.')
          return
        }
        prepare(); setPlacement({ project, selection, targets: valid, insertion: true })
        notify('Choose a + in the preview to attach the assembly. Escape cancels.')
      } catch (error) { notify((error as Error).message) }
    },
    copy: () => {
      try {
        const item = copySelection(project, selectedIds)
        setClipboard(item); cancel()
        notify(`${item.kind === 'panel' ? 'Panel' : 'Assembly'} copied. Select a target and press Ctrl/Cmd+V.`)
      } catch (error) { notify((error as Error).message) }
    },
    paste: () => {
      if (!clipboard) { notify('Copy a panel or assembly first with Ctrl/Cmd+C.'); return }
      try {
        const candidates = getPasteTargets(project, selectedIds, clipboard)
        const valid = candidates.filter(target => target.project)
        if (!valid.length) { cancel(); notify(candidates.find(target => target.error)?.error ?? 'No compatible attachment points on this target.'); return }
        prepare(); setHoverId(null); setPlacement({ project, selection, targets: valid })
        notify('Choose a + in the preview to attach the copy. Escape cancels.')
      } catch (error) { cancel(); notify((error as Error).message) }
    },
    attach: (id: string) => {
      const next = targets.find(target => target.id === id)?.project
      if (!next) return
      const ids = addedPanels(next).map(panel => panel.id)
      commit(next); cancel(); select(ids)
      notify(placement?.insertion ? 'Assembly attached. Undo is available.' : 'Copy attached. Undo is available.')
    },
  }
}
