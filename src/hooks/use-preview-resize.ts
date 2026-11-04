import { snapDistance, snapTargets, type SnapSettings } from '@/lib/preview-snap'
import { useMemo, useRef, useState } from 'react'
import { finishPreviewResize, movePreviewResize, preparePreviewResize, type PreviewResizeMode, type RepeatPreview } from '@/lib/preview-resize'
import { moveStructureRepeat, prepareStructureRepeat, type StructureRepeatSession } from '@/lib/structure-repeat'
import { resolvePanels } from '@/lib/model'
import type { Project } from '@/lib/types'

/** Keep transient geometry out of autosave and commit each gesture once. */
export function usePreviewResize({ project, selectedIds, selectedConnectorIds, enabled, commit, notify, snapSettings, select }: {
  snapSettings: SnapSettings
  project: Project
  selectedIds: readonly string[]
  selectedConnectorIds: readonly string[]
  enabled: boolean
  commit: (project: Project | ((current: Project) => Project)) => void
  notify: (message: string) => void
  select: (panelId: string) => void
}) {
  const panelId = selectedIds.length === 1 && !selectedConnectorIds.length ? selectedIds[0] : undefined
  const connectorId = selectedConnectorIds.length === 1 && !selectedIds.length ? selectedConnectorIds[0] : undefined
  const prepared = useMemo(() => {
    if (!enabled || (!panelId && !connectorId)) return null
    return preparePreviewResize(project, { panelId, connectorId })
  }, [project, panelId, connectorId, enabled])
  type Session = NonNullable<typeof prepared>
  type Result = ReturnType<typeof movePreviewResize> & { count?: number; reason?: string; selectedPanelId?: string; reusedPanelIds?: string[] }
  const session = useRef<{ source: Session; handleId: string; mode: PreviewResizeMode; repeat?: StructureRepeatSession } | null>(null)
  const latest = useRef<Result | null>(null)
  const [preview, setPreview] = useState<Result | null>(null)
  const current = session.current?.source === prepared ? preview : null
  const panels = useMemo(() => current ? resolvePanels(current.project) : null, [current])
  const repeatPreview = useMemo<RepeatPreview | undefined>(() => {
    if (!current || !session.current?.repeat) return undefined
    const source = session.current.source.original
    const originalPanelIds = new Set(source.panels.map(panel => panel.id))
    const originalConnections = new Map(source.connections.map(connection => [connection.id, JSON.stringify(connection)]))
    return {
      count: current.count ?? 0, sourcePanelIds: session.current.repeat.panelIds,
      addedPanelIds: current.project.panels.filter(panel => !originalPanelIds.has(panel.id)).map(panel => panel.id),
      reusedPanelIds: current.reusedPanelIds ?? [],
      connectionIds: current.project.connections.filter(connection => originalConnections.get(connection.id) !== JSON.stringify(connection)).map(connection => connection.id),
      reason: current.reason,
    }
  }, [current])
  const handles = useMemo(() => (prepared?.handles ?? []).map(handle => {
    if (!current || !panels || handle.id !== session.current?.handleId) return handle
    const position = handle.position.map((value, axis) => value + handle.direction[axis] * current.distance) as typeof handle.position
    if (session.current.repeat) return { ...handle, position, repeat: { count: current.count ?? 0, pitch: session.current.repeat.pitch, reused: current.reusedPanelIds?.length ?? 0, reason: current.reason } }
    const operation = prepared!.drivers.get(handle.id)!.operation
    const sizes = operation.kind === 'edge'
      ? panels.filter(panel => panel.id === operation.panelId).map(panel => ({
        label: operation.dimension === 'width' ? 'Width' : 'Height', value: panel[operation.dimension],
      }))
      : panels.flatMap(panel => {
        const before = prepared!.original.panels.find(item => item.id === panel.id)
        return (['width', 'height'] as const).filter(dimension => before && Math.abs(panel[dimension] - before[dimension]) > 1e-6)
          .map(dimension => ({ label: `${panel.name} · ${dimension === 'width' ? 'Width' : 'Height'}`, value: panel[dimension] }))
      })
    return { ...handle, sizes, position }
  }), [prepared, current, panels])

  return {
    handles,
    repeatPreview,
    snapProbe: current && session.current && !session.current.repeat ? handles.find(handle => handle.id === session.current!.handleId) : undefined,
    active: !!current,
    project: current?.project,
    panels,
    distance: current?.distance,
    limited: current?.limited,
    start: (handleId: string, mode: PreviewResizeMode = 'connected') => {
      const handle = prepared?.handles.find(handle => handle.id === handleId)
      if (!prepared || !handle) return false
      try {
        if (handle.repeatOnly && mode !== 'repeat' && !(mode === 'panel' && handle.panelEdge)) throw new Error(handle.panelEdge
          ? 'Connected resizing is fixed in this direction. Hold Shift to resize only this panel edge, or Control to repeat its compartment.'
          : 'This direction is fixed. Hold Control while pulling to repeat its compartment.')
        let repeat: StructureRepeatSession | undefined
        if (mode === 'repeat') {
          if (!panelId) throw new Error('Control-pull repeats a compartment from a panel arrow. Select a panel first.')
          repeat = prepareStructureRepeat(project, panelId, handle.direction)
        }
        session.current = { source: prepared, handleId, mode, repeat }
        latest.current = null
        setPreview({ project, distance: 0, limited: false, ...(repeat ? { count: 0 } : {}) })
        return true
      } catch (error) {
        notify(error instanceof Error ? error.message : 'This panel arrow cannot repeat a compartment.')
        return false
      }
    },
    move: (distance: number, keyboard = false) => {
      if (!session.current || session.current.source !== prepared) return
      try {
        if (session.current.repeat) {
          const result = moveStructureRepeat(session.current.repeat, keyboard ? Math.sign(distance) * session.current.repeat.pitch : distance)
          latest.current = result
          setPreview(previous => previous?.project === result.project && previous.count === result.count && previous.limited === result.limited && previous.reason === result.reason ? previous : result)
          return
        }
        const source = session.current.source
        const handle = source.handles.find(item => item.id === session.current!.handleId)!
        const targets = snapTargets(project, selectedIds, selectedConnectorIds, !!connectorId)
        const snapped = snapDistance(handle.position, handle.direction, Math.round(distance), targets, keyboard ? { ...snapSettings, tolerance: Math.min(snapSettings.tolerance, Math.abs(distance) * 0.45) } : snapSettings)
        const result = movePreviewResize(source, session.current.handleId, snapped, session.current.mode === 'panel')
        latest.current = result
        setPreview(result)
      } catch (error) {
        notify(error instanceof Error ? error.message : 'This direction cannot preserve the connected panels.')
      }
    },
    end: (cancel: boolean) => {
      if (!cancel && latest.current && session.current?.source === prepared && Math.abs(latest.current.distance) > 1e-6) {
        try {
          const source = session.current.source
          const candidate = session.current.repeat ? latest.current.project
            : finishPreviewResize(source, session.current.handleId, latest.current, session.current.mode === 'panel').project
          const changed = JSON.stringify(candidate) !== JSON.stringify(source.original)
          commit(current => {
            if (current !== source.original) throw new Error('The project changed during this drag. Try again.')
            return candidate
          })
          if (session.current.repeat) {
            if (latest.current.selectedPanelId) select(latest.current.selectedPanelId)
            const reused = latest.current.reusedPanelIds?.length ?? 0
            notify(!changed ? 'These bays already exist; no changes were needed.'
              : reused ? `Completed ${latest.current.count} ${latest.current.count === 1 ? 'bay' : 'bays'}, reusing ${reused} existing ${reused === 1 ? 'panel' : 'panels'}. Undo is available.`
                : `Added ${latest.current.count} ${latest.current.count === 1 ? 'bay' : 'bays'}. Undo is available.`)
          }
        }
        catch (error) { notify(error instanceof Error ? error.message : 'This resize conflicts with a constraint.') }
      }
      if (!cancel && latest.current?.reason && session.current?.source === prepared) notify(latest.current.reason)
      session.current = null
      latest.current = null
      setPreview(null)
    },
  }
}
