import { useMemo, useRef, useState } from 'react'
import { movePreviewDrag, preparePreviewDrag, type PreviewDragSession } from '@/lib/preview-drag'
import { resolvePanels } from '@/lib/model'
import type { Project, Vec3 } from '@/lib/types'

export function usePreviewDrag({ project, selectedIds, commit, notify }: {
  project: Project
  selectedIds: string[]
  commit: (project: Project) => void
  notify: (message: string) => void
}) {
  const session = useRef<PreviewDragSession | null>(null)
  const latest = useRef<ReturnType<typeof movePreviewDrag> | null>(null)
  const [preview, setPreview] = useState<ReturnType<typeof movePreviewDrag> | null>(null)
  const current = session.current?.original === project ? preview : null
  const panels = useMemo(() => current ? resolvePanels(current.project) : null, [current])
  return {
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
        latest.current = movePreviewDrag(session.current, delta, snapDistance)
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
        if (latest.current.snap) notify(`Attached to ${latest.current.snap.label}. Undo is available.`)
      }
      session.current = null
      latest.current = null
      setPreview(null)
    },
  }
}
