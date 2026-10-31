import { useMemo, useRef, useState } from 'react'
import { movePreviewResize, preparePreviewResize } from '@/lib/preview-resize'
import { resolvePanels } from '@/lib/model'
import type { Project } from '@/lib/types'

/** Keep transient geometry out of autosave and commit each gesture once. */
export function usePreviewResize({ project, selectedIds, selectedConnectorIds, enabled, commit, notify }: {
  project: Project
  selectedIds: readonly string[]
  selectedConnectorIds: readonly string[]
  enabled: boolean
  commit: (project: Project) => void
  notify: (message: string) => void
}) {
  const panelId = selectedIds.length === 1 && !selectedConnectorIds.length ? selectedIds[0] : undefined
  const connectorId = selectedConnectorIds.length === 1 && !selectedIds.length ? selectedConnectorIds[0] : undefined
  const prepared = useMemo(() => {
    if (!enabled || (!panelId && !connectorId)) return null
    return preparePreviewResize(project, { panelId, connectorId })
  }, [project, panelId, connectorId, enabled])
  type Session = NonNullable<typeof prepared>
  type Result = ReturnType<typeof movePreviewResize>
  const session = useRef<{ source: Session; handleId: string } | null>(null)
  const latest = useRef<Result | null>(null)
  const [preview, setPreview] = useState<Result | null>(null)
  const current = session.current?.source === prepared ? preview : null
  const panels = useMemo(() => current ? resolvePanels(current.project) : null, [current])
  const handles = useMemo(() => (prepared?.handles ?? []).map(handle => current && handle.id === session.current?.handleId
    ? { ...handle, position: handle.position.map((value, axis) => value + handle.direction[axis] * current.distance) as typeof handle.position }
    : handle), [prepared, current])

  return {
    handles,
    active: !!current,
    project: current?.project,
    panels,
    distance: current?.distance,
    limited: current?.limited,
    start: (handleId: string) => {
      if (!prepared?.handles.some(handle => handle.id === handleId)) return false
      session.current = { source: prepared, handleId }
      latest.current = null
      setPreview({ project, distance: 0, limited: false })
      return true
    },
    move: (distance: number) => {
      if (!session.current || session.current.source !== prepared) return
      try {
        const result = movePreviewResize(session.current.source, session.current.handleId, Math.round(distance))
        latest.current = result
        setPreview(result)
      } catch (error) {
        notify(error instanceof Error ? error.message : 'This direction cannot preserve the connected panels.')
      }
    },
    end: (cancel: boolean) => {
      if (!cancel && latest.current && session.current?.source === prepared && Math.abs(latest.current.distance) > 1e-6) {
        commit(latest.current.project)
      }
      session.current = null
      latest.current = null
      setPreview(null)
    },
  }
}
