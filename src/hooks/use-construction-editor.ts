import { useEffect, useRef, useState } from 'react'
import { addConstructionBox, combineConstructionObjects, copyConstructionObjects, duplicateConstructionObjects,
  pasteConstructionObjects, removeConstructionObjects, updateConstructionObject } from '@/lib/construction-objects'
import { moveConstructionSelection, rotateConstructionSelection } from '@/lib/object-geometry'
import { snapObjectDelta } from '@/lib/object-edit'
import { resolvePanels } from '@/lib/model'
import type { SnapSettings } from '@/lib/preview-snap'
import type { ConstructionObject, ConstructionObjects, ObjectBooleanOperation, Project, Vec3 } from '@/lib/types'

interface Props {
  project: Project;
  commit: (next: Project | ((current: Project) => Project), options?: { group?: string; repeat?: boolean }) => void;
  notify: (message: string) => void;
  snapSettings: SnapSettings;
}
const EMPTY: ConstructionObjects = { roots: [], nodes: [] }

export function useConstructionEditor({ project, commit, notify, snapSettings }: Props) {
  const [selection, setSelection] = useState<string[]>([])
  const [draft, setDraft] = useState<{ source: Project; objects: ConstructionObjects }>()
  useEffect(() => { setDraft(current => current?.source === project ? current : undefined) }, [project])
  const clipboard = useRef<ConstructionObjects | null>(null)
  const objects = project.constructionObjects ?? EMPTY
  const selectedIds = selection.filter(id => objects.nodes.some(node => node.id === id))
  const preview = draft?.source === project ? draft.objects : objects
  const editing = draft?.source === project
  const attempt = (action: () => void) => {
    try { action(); return true } catch (error) { notify(error instanceof Error ? error.message : 'This object edit is unavailable.'); return false }
  }
  const cancel = () => setDraft(undefined)
  const select = (id: string | null, additive = false) => {
    // Preview clicks must not implicitly discard an inspector transaction.
    if (editing) return
    setSelection(current => !id ? [] : additive ? current.includes(id) ? current.filter(item => item !== id) : [...current, id] : [id])
  }
  const change = (operation: (source: ConstructionObjects) => ConstructionObjects) => attempt(() => {
    setDraft({ source: project, objects: operation(preview) })
  })
  const apply = () => attempt(() => {
    if (!draft || draft.source !== project) throw new Error('The project changed. Review the object again.')
    commit(current => {
      if (current !== draft.source) throw new Error('The project changed. Review the object again.')
      return { ...current, constructionObjects: draft.objects }
    })
    cancel()
  })
  const move = (delta: Vec3, repeat: boolean) => attempt(() => {
    if (editing) return
    commit(current => {
      const objects = current.constructionObjects ?? EMPTY
      return { ...current, constructionObjects: moveConstructionSelection(objects, selectedIds, snapObjectDelta(objects, selectedIds, resolvePanels(current), delta, snapSettings, true)) }
    }, { group: `object-move:${selectedIds.join('/')}`, repeat })
  })
  return { objects: preview, selectedIds, editing, change, apply, cancel, select,
    selectMany: (ids: string[], additive: boolean) => { if (!editing) setSelection(current => additive ? [...new Set([...current, ...ids])] : ids) },
    selectAll: () => { if (!editing) setSelection(objects.roots) },
    update: (node: ConstructionObject) => change(source => updateConstructionObject({ ...project, constructionObjects: source }, node).constructionObjects!),
    add: () => attempt(() => { const result = addConstructionBox(project); commit(result.project); cancel(); setSelection([result.objectId]) }),
    combine: (operation: ObjectBooleanOperation) => attempt(() => {
      const result = combineConstructionObjects(project, selectedIds, operation); commit(result.project); cancel(); setSelection([result.objectId])
    }),
    remove: () => attempt(() => { commit(current => removeConstructionObjects(current, selectedIds)); cancel(); setSelection([]) }),
    duplicate: () => attempt(() => { const result = duplicateConstructionObjects(project, selectedIds); commit(result.project); cancel(); setSelection(result.objectIds) }),
    copy: () => attempt(() => { clipboard.current = copyConstructionObjects(project, selectedIds); notify('Objects copied. Paste adds independent copies.') }),
    paste: () => attempt(() => {
      if (!clipboard.current) return
      const result = pasteConstructionObjects(project, clipboard.current, [100, 0, 0]); commit(result.project); cancel(); setSelection(result.objectIds)
    }),
    rotate: (axis: 0 | 1 | 2) => attempt(() => {
      if (editing) return
      commit(current => ({ ...current, constructionObjects: rotateConstructionSelection(current.constructionObjects ?? EMPTY, selectedIds, axis) }))
    }), move,
  }
}
