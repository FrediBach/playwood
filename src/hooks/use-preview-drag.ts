import { snapPanelDelta, type SnapSettings } from '@/lib/preview-snap'
import { useMemo, useRef, useState } from 'react'
import { movePreviewDrag, preparePreviewDrag, type PreviewDragSession } from '@/lib/preview-drag'
import { resolvePanels } from '@/lib/model'
import type { Project, Vec3 } from '@/lib/types'

export function usePreviewDrag({ project, selectedIds, commit, notify, select, snapSettings }: {
  snapSettings: SnapSettings
  project: Project
  selectedIds: string[]
  commit: (project: Project) => void
  notify: (message: string) => void
  select?: (ids: string[]) => void
}) {
  const session = useRef<PreviewDragSession | null>(null)
  const latest = useRef<ReturnType<typeof movePreviewDrag> | null>(null)
  const [preview, setPreview] = useState<ReturnType<typeof movePreviewDrag> | null>(null)
  const current = session.current?.original === project ? preview : null
  const panels = useMemo(() => current ? resolvePanels(current.project) : null, [current])
  return {
    snapDirection: current && panels && session.current ? panels.find(panel => panel.id === session.current!.movingIds[0])?.position.map((value, axis) =>
      value - session.current!.project.panels.find(panel => panel.id === session.current!.movingIds[0])!.position[axis]) as Vec3 : undefined,
    active: !!current,
    project: current?.project,
    panels,
    snap: current?.snap ?? null,
    start: () => {
      try {
        session.current = preparePreviewDrag(project, selectedIds)
        latest.current = null
        return !!session.current
      } catch (error) { notify(error instanceof Error ? error.message : 'This selection cannot be moved.'); return false }
    },
    move: (delta: Vec3, snapDistance: number) => {
      if (!session.current || session.current.original !== project) return
      try {
        latest.current = movePreviewDrag(session.current, snapPanelDelta(resolvePanels(session.current.project), session.current.movingIds, delta, snapSettings), snapDistance)
        setPreview(latest.current)
      } catch (error) {
        latest.current = null
        setPreview(null)
        notify(error instanceof Error ? error.message : 'This position is unavailable.')
      }
    },
    end: (cancel: boolean) => {
      if (!cancel && latest.current && session.current?.original === project) {
        commit(latest.current.project)
        const snap = latest.current.snap
        if (snap) {
          if (snap.warning) select?.(snap.panelIds)
          notify(`Attached to ${snap.label}.${snap.warning ? ` ${snap.warning.replace(/^Requires disassembly:/, 'Disassembled:')}` : ''} Undo is available.`)
        }
      }
      session.current = null
      latest.current = null
      setPreview(null)
    },
  }
}
