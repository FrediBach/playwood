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
  const lastDelta = useRef<Vec3>([0, 0, 0])
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
        lastDelta.current = [0, 0, 0]
        return !!session.current
      } catch (error) { notify(error instanceof Error ? error.message : 'This selection cannot be moved.'); return false }
    },
    move: (delta: Vec3, snapDistance: number) => {
      if (!session.current || session.current.original !== project) return
      try {
        const snapped = snapPanelDelta(resolvePanels(session.current.project), session.current.movingIds, delta, snapSettings)
        latest.current = movePreviewDrag(session.current, snapped, snapDistance)
        lastDelta.current = snapped
        setPreview(latest.current)
      } catch (error) {
        if (session.current.original.constraints?.some(rule => rule.enabled)) {
          // Constraints outrank snapping. If the pointer itself is unavailable,
          // approach its limit from the last feasible candidate, never from an
          // already modified preview or a partially committed construction.
          try {
            latest.current = movePreviewDrag(session.current, delta, 0)
            lastDelta.current = delta
          } catch {
            const from = lastDelta.current
            let low = 0, high = 1
            for (let iteration = 0; iteration < 12; iteration++) {
              const fraction = (low + high) / 2
              const trial = from.map((value, axis) => value + (delta[axis] - value) * fraction) as Vec3
              try {
                const candidate = movePreviewDrag(session.current, trial, 0)
                low = fraction; latest.current = candidate; lastDelta.current = trial
              } catch { high = fraction }
            }
          }
          setPreview(latest.current ?? { project: session.current.original, snap: null })
        } else { latest.current = null; setPreview(null) }
        notify(error instanceof Error ? error.message : 'This position is unavailable.')
      }
    },
    end: (cancel: boolean) => {
      if (!cancel && latest.current && session.current?.original === project) {
        try {
          commit(latest.current.project)
          const snap = latest.current.snap
          if (snap) {
            if (snap.warning) select?.(snap.panelIds)
            notify(`Attached to ${snap.label}.${snap.warning ? ` ${snap.warning.replace(/^Requires disassembly:/, 'Disassembled:')}` : ''} Undo is available.`)
          }
        } catch (error) { notify(error instanceof Error ? error.message : 'This position is unavailable.') }
      }
      session.current = null
      latest.current = null
      setPreview(null)
    },
  }
}
