import { useEffect, useRef, useState } from 'react'
import { resolvePanels } from '@/lib/model'
import { moveConstructionSelection } from '@/lib/object-geometry'
import { objectResizeHandles, previewObjectResize, snapObjectDelta, type ObjectResizeEdge } from '@/lib/object-edit'
import type { SnapSettings } from '@/lib/preview-snap'
import type { ConstructionObjects, Project, Vec3 } from '@/lib/types'

interface Session {
  source: Project;
  ids: string[];
  settings: SnapSettings;
  edge?: ObjectResizeEdge;
  candidate: ConstructionObjects;
  distance?: number;
  limited: boolean;
}

/** Gesture candidates never enter history/autosave until release; rejection keeps the last valid pose. */
export function useObjectGesture({ project, selectedIds, enabled, snapSettings, commit, notify }: {
  project: Project;
  selectedIds: readonly string[];
  enabled: boolean;
  snapSettings: SnapSettings;
  commit: (next: (current: Project) => Project) => void;
  notify: (message: string) => void;
}) {
  const session = useRef<Session | null>(null)
  const [preview, setPreview] = useState<Session | null>(null)
  const signature = selectedIds.join('/')
  const current = enabled && preview?.source === project && preview.ids.join('/') === signature ? preview : null
  useEffect(() => {
    if (!enabled || session.current?.source !== project || session.current?.ids.join('/') !== signature) {
      session.current = null; setPreview(null)
    }
  }, [enabled, project, signature])
  const start = (handleId?: string) => {
    if (!enabled || session.current || !project.constructionObjects || !selectedIds.length) return false
    const edge = handleId ? objectResizeHandles(project.constructionObjects, selectedIds).find(handle => handle.id === handleId) : undefined
    if (handleId && !edge) return false
    const next = { source: project, ids: [...selectedIds], settings: { ...snapSettings }, edge, candidate: project.constructionObjects, limited: false }
    session.current = next; setPreview(next)
    return true
  }
  const update = (value: Vec3 | number, keyboard = false) => {
    const active = session.current
    if (!active || !enabled || active.source !== project || active.ids.join('/') !== signature) return
    try {
      const objects = active.source.constructionObjects!, panels = resolvePanels(active.source)
      const result = active.edge && typeof value === 'number'
        ? previewObjectResize(objects, active.ids, panels, active.edge, value, active.settings, keyboard)
        : typeof value !== 'number' ? { objects: moveConstructionSelection(objects, active.ids, snapObjectDelta(objects, active.ids, panels, value, active.settings)) } : null
      if (!result) return
      const next = { ...active, candidate: result.objects, distance: 'distance' in result ? result.distance : undefined, limited: false }
      session.current = next; setPreview(next)
    } catch {
      const next = { ...active, limited: true }; session.current = next; setPreview(next)
    }
  }
  const end = (cancel: boolean) => {
    const active = session.current
    session.current = null; setPreview(null)
    if (cancel || !active || !enabled || active.source !== project || active.ids.join('/') !== signature) return
    try {
      commit(current => {
        if (current !== active.source) throw new Error('The project changed during the object gesture. Try again.')
        return { ...current, constructionObjects: active.candidate }
      })
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not apply this object gesture.') }
  }
  return { active: !!current, objects: current?.candidate, distance: current?.distance, limited: current?.limited,
    resizing: !!current?.edge, handles: project.constructionObjects ? objectResizeHandles(current?.candidate ?? project.constructionObjects, selectedIds) : [],
    start, update, end }
}
