import { useMemo, useState } from 'react'
import { groupPasteLocations } from '@/lib/paste-locations'
import { copySelection, getPasteTargets, getInsertionTargets, type CopiedItem } from '@/lib/clipboard'
import { designConstraintPanelIds } from '@/lib/design-constraints'
import type { AssemblyAttachmentTarget } from '@/lib/assemblies'
import type { Project } from '@/lib/types'

interface Options {
  project: Project
  selectedIds: string[]
  selectedConnectorIds: string[]
  commit: (project: Project) => void
  select: (ids: string[]) => void
  prepare: () => void
  notify: (message: string) => void
}

export function useCopyPaste({ project, selectedIds, selectedConnectorIds, commit, select, prepare, notify }: Options) {
  const [clipboard, setClipboard] = useState<CopiedItem | null>(null)
  const [placement, setPlacement] = useState<{ project: Project; selection: string; insertion?: 'panel' | 'assembly'; targets: AssemblyAttachmentTarget[] } | null>(null)
  const [locationPage, setLocationPage] = useState(0)
  const [locationId, setLocationId] = useState<string | null>(null)
  const [locationHover, setLocationHover] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const selection = JSON.stringify([selectedIds, selectedConnectorIds])
  if (placement && (placement.project !== project || placement.selection !== selection)) {
    setPlacement(null); setHoverId(null); setLocationId(null); setLocationHover(null); setLocationPage(0)
  }
  const active = !!placement && placement.project === project && placement.selection === selection
  const targets = active ? placement.targets : []
  const locations = useMemo(() => groupPasteLocations(active ? placement.targets : []), [active, placement])
  const location = locations.find(item => item.id === locationId)
  const hovered = targets.find(target => target.id === hoverId)
  const preview = hovered?.project
  const panelIds = useMemo(() => new Set(project.panels.map(panel => panel.id)), [project.panels])
  const connectionValues = useMemo(() => new Set(project.connections.map(connection => JSON.stringify(connection))), [project.connections])
  const previewConnectionIds = new Set(preview?.connections.map(connection => connection.id))
  const previewPanelIds = new Set(preview?.panels.map(panel => panel.id))
  const addedPanels = (next: Project) => next.panels.filter(panel => !panelIds.has(panel.id))
  const previewPanels = preview ? addedPanels(preview) : []
  const previewConnections = preview?.connections.filter(connection => !connectionValues.has(JSON.stringify(connection))) ?? []
  const cancel = () => { setPlacement(null); setHoverId(null); setLocationId(null); setLocationHover(null); setLocationPage(0) }
  return {
    active, targets, hovered, preview, previewPanels, previewConnections, locations, location, locationHover, locationPage,
    pageLocations: locations.slice(locationPage * 8, (locationPage + 1) * 8),
    changeLocationPage: (page: number) => { setLocationPage(page); setLocationHover(null) },
    hoverLocation: setLocationHover,
    chooseLocation: (id: string) => { setLocationId(id); setLocationHover(id); setHoverId(null) },
    back: () => { setLocationId(null); setHoverId(null) },
    inserting: active && placement.insertion,
    suppressedConnectionIds: preview ? project.connections.filter(connection => !previewConnectionIds.has(connection.id)).map(connection => connection.id) : [],
    suppressedPanelIds: preview ? project.panels.filter(panel => !previewPanelIds.has(panel.id)).map(panel => panel.id) : [],
    boundsPanels: previewPanels,
    cancel, hover: setHoverId,
    insert: (item: Exclude<CopiedItem, { kind: 'selection' }>) => {
      cancel()
      try {
        const candidates = getInsertionTargets(project, selectedIds, item)
        const valid = candidates.filter(target => target.project)
        if (!valid.length) {
          notify(`No compatible attachment points on this selection. Clear the selection to insert the ${item.kind} freely.`)
          return
        }
        prepare(); setPlacement({ project, selection, targets: valid, insertion: item.kind })
        notify('')
      } catch (error) { notify((error as Error).message) }
    },
    copy: () => {
      try {
        const item = copySelection(project, selectedIds, selectedConnectorIds)
        setClipboard(item); cancel()
        const ids=new Set(item.kind === 'selection' ? item.panels.map(panel => panel.id) : item.kind === 'assembly' ? Object.values(item.instance.panelIds) : [item.panel.id])
        const omitted=project.constraints?.filter(rule=>designConstraintPanelIds(rule).some(id=>ids.has(id))&&(rule.kind==='floor'||rule.kind==='position'||designConstraintPanelIds(rule).some(id=>!ids.has(id)))).length??0
        notify(`${item.kind === 'panel' ? 'Panel' : item.kind === 'assembly' ? 'Assembly' : 'Selection'} copied.${omitted?` ${omitted} absolute-position or external ${omitted===1?'constraint stays':'constraints stay'} with the original.`:''} Select a target and press Ctrl/Cmd+V.`)
      } catch (error) { notify((error as Error).message) }
    },
    paste: () => {
      if (!clipboard) { notify('Copy panels, connectors, or an assembly first with Ctrl/Cmd+C.'); return }
      try {
        const candidates = getPasteTargets(project, selectedIds, clipboard)
        const valid = candidates.filter(target => target.project)
        if (!valid.length) { cancel(); notify(candidates.find(target => target.error)?.error ?? 'No compatible attachment points on this target.'); return }
        prepare(); setHoverId(null); setLocationId(null); setLocationHover(null); setLocationPage(0); setPlacement({ project, selection, targets: valid })
        notify('')
      } catch (error) { cancel(); notify((error as Error).message) }
    },
    attach: (id: string) => {
      const candidate = targets.find(target => target.id === id)
      const next = candidate?.project
      if (!next) return
      const ids = candidate.panelIds ?? addedPanels(next).map(panel => panel.id)
      try {
        commit(next); cancel(); select(ids)
        const message = placement?.insertion ? `${placement.insertion === 'panel' ? 'Panel' : 'Assembly'} attached.` : 'Copy attached.'
        notify(`${message}${candidate.warning ? ` ${candidate.warning.replace(/^Requires disassembly:/, 'Disassembled:')}` : ''} Undo is available.`)
      } catch(error) { notify(error instanceof Error?error.message:'This attachment conflicts with a constraint.') }
    },
  }
}
