import { createResizePreparationWorker } from '@/lib/resize-preparation-worker'
import { createResizePreviewWorker } from '@/lib/resize-preview-worker'
import { ResizeReviewRequired } from '@/lib/numeric-resize'
import type { ResizeReview } from '@/lib/structure-edit'
import type { Notify } from '@/editor/editor-notifications'
import { snapDistanceReference, snapTargets, type SnapSettings } from '@/lib/preview-snap'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { finishPreviewResize, movePreviewResize, startPreviewResize, reviewPreviewResize, type PreviewResizeMode, type RepeatPreview } from '@/lib/preview-resize'
import { moveStructureRepeat, prepareStructureRepeat, type StructureRepeatSession } from '@/lib/structure-repeat'
import { resolvePanels } from '@/lib/model'
import type { Project } from '@/lib/types'
import { createSelectionPreparations } from './selection-preparations'

/** Keep transient geometry out of autosave and commit each gesture once. */
export function usePreviewResize({ project, selectedIds, selectedConnectorIds, enabled, commit, notify, snapSettings, select, onReview }: {
  onReview: (review: ResizeReview) => void
  snapSettings: SnapSettings
  project: Project
  selectedIds: readonly string[]
  selectedConnectorIds: readonly string[]
  enabled: boolean
  commit: (project: Project | ((current: Project) => Project)) => void
  notify: Notify
  select: (panelId: string) => void
}) {
  const panelId = selectedIds.length === 1 && !selectedConnectorIds.length ? selectedIds[0] : undefined
  const connectorId = selectedConnectorIds.length === 1 && !selectedIds.length ? selectedConnectorIds[0] : undefined
  const panelIds = selectedIds.length > 1 && !selectedConnectorIds.length ? selectedIds : undefined
  const preparations = useMemo(() => createSelectionPreparations(project), [project])
  const selection = useMemo(() => ({ panelId, panelIds, connectorId }), [panelId, panelIds, connectorId])
  const background = project.panels.length >= 12
  const [loaded, setLoaded] = useState<{ preparations: typeof preparations; selection: typeof selection } | null>(null)
  const preparationError = useEffectEvent((message: string) => notify(message, 'error'))
  useEffect(() => {
    if (!background || !enabled || (!panelId && !connectorId && !panelIds) || preparations.hasResize(selection)) return
    const job = createResizePreparationWorker({ kind: 'handles', project, selection })
    let active = true
    void job.result.then(result => {
      if (!active || !result) return
      if (result.kind === 'error') { preparationError(result.message); return }
      if (result.kind !== 'handles') return
      preparations.storeResize(selection, result.session)
      setLoaded({ preparations, selection })
    })
    return () => { active = false; job.stop() }
  }, [background, enabled, panelId, connectorId, panelIds, preparations, project, selection])
  const prepared = useMemo(() => {
    if (!enabled || (!panelId && !connectorId && !panelIds)) return null
    if (background && !preparations.hasResize(selection)) return null
    const cached = preparations.resize(selection)
    // A new activation must not revive a gesture from before a mode change.
    return cached ? { ...cached } : null
  }, [preparations, selection, panelId, panelIds, connectorId, enabled, background, loaded])
  type Session = NonNullable<typeof prepared>
  type Result = ReturnType<typeof movePreviewResize> & { snap?: ReturnType<typeof snapDistanceReference>['reference']; count?: number; reason?: string; selectedPanelId?: string; reusedPanelIds?: string[] }
  const session = useRef<{ source: Session; handleId: string; mode: PreviewResizeMode; snapSettings: SnapSettings; worker?: ReturnType<typeof createResizePreviewWorker>; requestedDistance?: number; finishing?: boolean; repeat?: StructureRepeatSession; targets?: ReturnType<typeof snapTargets> } | null>(null)
  const latest = useRef<Result | null>(null)
  const [preview, setPreview] = useState<Result | null>(null)
  useEffect(() => {
    const cancelPending = (event: KeyboardEvent | FocusEvent) => {
      if (!session.current?.finishing || (event instanceof KeyboardEvent && event.key !== 'Escape')) return
      event.preventDefault()
      session.current.worker?.stop()
      session.current = null
      latest.current = null
      setPreview(null)
    }
    window.addEventListener('keydown', cancelPending)
    window.addEventListener('blur', cancelPending)
    return () => {
      window.removeEventListener('keydown', cancelPending)
      window.removeEventListener('blur', cancelPending)
      if (session.current?.source === prepared) { session.current.worker?.stop(); session.current = null }
    }
  }, [prepared])
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
    return { ...handle, sizes, position, limitReason: current.reason, interpretation: current.interpretation }
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
        if (handle.sizeLocked && mode !== 'repeat') throw new Error(handle.blocked?.reason ?? 'Panel size is locked.')
        if (handle.blocked && mode !== 'repeat' && !(mode === 'panel' && handle.panelEdge)) throw new Error(handle.affectedPanelIds ? handle.blocked.reason : handle.panelEdge
          ? 'Connected resizing is fixed in this direction. Hold Shift to resize only this panel edge, or Control to repeat its compartment.'
          : 'This direction is fixed. Hold Control while pulling to repeat its compartment.')
        let repeat: StructureRepeatSession | undefined
        if (mode === 'repeat') {
          if (!panelId) throw new Error('Control-pull repeats a compartment from a panel arrow. Select a panel first.')
          repeat = prepareStructureRepeat(project, panelId, handle.direction)
        }
        session.current?.worker?.stop()
        const worker = mode === 'connected' && handle.panelEdge && project.panels.length >= 12
          ? createResizePreviewWorker(prepared, handleId, false) : undefined
        const interpretation = mode !== 'repeat' && !worker ? startPreviewResize(prepared, handleId, mode === 'panel')?.label : undefined
        session.current = { source: prepared, handleId, mode, repeat, worker, snapSettings: { ...snapSettings } }
        if (worker) void worker.request(0).then(response => {
          if (session.current?.worker === worker && response?.error) notify(response.error, 'error')
        })
        latest.current = null
        setPreview({ project, distance: 0, limited: false, interpretation, ...(repeat ? { count: 0 } : {}) })
        return true
      } catch (error) {
        notify(error instanceof Error ? error.message : 'This panel arrow cannot repeat a compartment.','error')
        return false
      }
    },
    move: (distance: number, keyboard = false) => {
      if (!session.current || session.current.source !== prepared || session.current.finishing) return
      try {
        if (session.current.repeat) {
          const result = moveStructureRepeat(session.current.repeat, keyboard ? Math.sign(distance) * session.current.repeat.pitch : distance)
          latest.current = result
          setPreview(previous => previous?.project === result.project && previous.count === result.count && previous.limited === result.limited && previous.reason === result.reason ? previous : result)
          return
        }
        const source = session.current.source
        const handle = source.handles.find(item => item.id === session.current!.handleId)!
        const settings = session.current.snapSettings
        const targets = settings.geometry
          ? session.current.targets ??= snapTargets(source.original, [...selectedIds, ...handle.affectedPanelIds ?? []], selectedConnectorIds, !!connectorId)
          : []
        const snapped = snapDistanceReference(handle.position, handle.direction, Math.round(distance), targets, keyboard ? { ...settings, tolerance: Math.min(settings.tolerance, Math.abs(distance) * 0.45) } : settings)
        const active = session.current
        active.requestedDistance = snapped.distance
        const publish = (result: Result) => {
          if (session.current !== active || active.finishing) return
          const snappedResult = { ...result, snap: Math.abs(result.distance - snapped.distance) < 1e-4 ? snapped.reference : undefined }
          latest.current = snappedResult
          setPreview(snappedResult)
        }
        if (active.worker) {
          void active.worker.request(snapped.distance).then(response => {
            if (!response || session.current !== active || active.finishing) return
            if (response.error) notify(response.error, 'error')
            else if (response.result) publish(response.result)
          })
        } else publish(movePreviewResize(source, active.handleId, snapped.distance, active.mode === 'panel'))
      } catch (error) {
        notify(error instanceof Error ? error.message : 'This direction cannot preserve the connected panels.','error')
      }
    },
    end: async (cancel: boolean) => {
      const active = session.current
      if (!active || active.source !== prepared) return
      if (active.worker && !cancel) {
        if (active.finishing) return
        active.finishing = true
        const response = await active.worker.request(active.requestedDistance ?? 0, true)
        if (session.current !== active) return
        if (response?.review) onReview(response.review)
        else if (response?.error) notify(response.error, 'error')
        else if (response?.result && Math.abs(response.result.distance) > 1e-6) {
          try {
            commit(current => {
              if (current !== active.source.original) throw new Error('The project changed during this drag. Try again.')
              return response.result!.project
            })
            if (response.result.reason) notify(response.result.reason, 'error')
          } catch (error) { notify(error instanceof Error ? error.message : 'This resize could not be applied.', 'error') }
        }
        active.worker.stop()
        session.current = null
        latest.current = null
        setPreview(null)
        return
      }
      active.worker?.stop()
      if (!cancel && latest.current && session.current?.source === prepared && (Math.abs(latest.current.distance) > 1e-6 || latest.current.limited)) {
        try {
          const source = session.current.source
          const finished = session.current.repeat ? latest.current
            : finishPreviewResize(source, session.current.handleId, latest.current, session.current.mode === 'panel')
          if (!session.current.repeat) reviewPreviewResize(source, session.current.handleId, finished.distance, session.current.mode === 'panel', latest.current.limited ? active.requestedDistance : undefined)
          const candidate = finished.project
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
        catch (error) {
          if (error instanceof ResizeReviewRequired) onReview(error.review)
          else notify(error instanceof Error ? error.message : 'This resize conflicts with a constraint.','error')
        }
      }
      if (!cancel && latest.current?.reason && session.current?.source === prepared) notify(latest.current.reason,'error')
      session.current = null
      latest.current = null
      setPreview(null)
    },
  }
}
