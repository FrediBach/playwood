import { useCallback, useRef, useState } from 'react'
import { lockPanelSizes, setDesignConstraint } from '@/lib/design-constraint-commands'
import { designConstraintPanelIds } from '@/lib/design-constraints'
import { resolvePanels } from '@/lib/model'
import type { DesignConstraint, Project } from '@/lib/types'

interface Preview { source: Project; rule: DesignConstraint; project?: Project; error?: string; summary?: string }

export function useDesignConstraints({ project, commit, notify }: {
  project: Project
  commit: (change: Project | ((current: Project) => Project)) => void
  notify: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const source = useRef<Project | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [highlight, setHighlight] = useState<DesignConstraint | null>(null)
  const [openRequest, setOpenRequest] = useState(0)
  const [manageRequest, setManageRequest] = useState(0)
  const [cancelRequest, setCancelRequest] = useState(0)
  const [actionError, setActionError] = useState('')
  const requestSequence = useRef(0)
  const stale = editing && source.current !== null && source.current !== project
  const current = preview?.source === project ? preview : null
  const onEditingChange = useCallback((value: boolean) => {
    setEditing(value)
    if (value) source.current ??= project
    else { source.current = null; setPreview(null); setActionError(''); setOpenRequest(0); setManageRequest(0) }
  }, [project])
  const onPreview = useCallback((rule: DesignConstraint | null, anchorPanelId?: string) => {
    setActionError('')
    if (!rule) { setPreview(null); return }
    source.current ??= project
    const original = source.current
    if (original !== project) return
    try {
      const next = setDesignConstraint(original, rule, anchorPanelId)
      const previous = new Map(resolvePanels(original).map(panel => [panel.id, panel]))
      const changed = resolvePanels(next).filter(panel => {
        const before = previous.get(panel.id)
        return before && (Math.abs(panel.width - before.width) > .01 || Math.abs(panel.height - before.height) > .01
          || panel.position.some((value, axis) => Math.abs(value - before.position[axis]) > .01))
      })
      const names = changed.slice(0, 3).map(panel => panel.name).join(', ')
      setPreview({ source: original, rule, project: next,
        summary: changed.length ? `Adjusts ${names}${changed.length > 3 ? ` and ${changed.length - 3} more panels` : ''}. Apply to keep these changes.` : 'Current geometry already meets this constraint.' })
    } catch (error) {
      setPreview({ source: original, rule, error: error instanceof Error ? error.message : 'These constraints cannot all be met.' })
    }
  }, [project])
  const onApply = (rule: DesignConstraint, anchorPanelId?: string) => {
    try {
      const original = source.current ?? project
      if (original !== project) throw new Error('The project changed. Cancel this preview and reopen the constraint before applying it.')
      const next = setDesignConstraint(original, rule, anchorPanelId)
      commit(current => {
        if (current !== original) throw new Error('The project changed. Reopen the constraint before applying it.')
        return next
      })
      setHighlight(rule)
      notify('Constraint saved. Undo restores the rule and all adjusted panels.')
      return true
    } catch (error) { setActionError(error instanceof Error ? error.message : 'The constraint could not be saved.'); return false }
  }
  const activeRule = current?.rule ?? (highlight && project.constraints?.find(rule => rule.id === highlight.id)) ?? null
  return {
    lockSizes: (panelIds: readonly string[]) => {
      try {
        commit(current => lockPanelSizes(current, panelIds))
        notify('Panel size locked. Disable or remove the width and height rules in Constraints to unlock.')
      } catch (error) { notify(error instanceof Error ? error.message : 'Panel sizes could not be locked.') }
    },
    editing, openRequest, manageRequest, cancelRequest, onEditingChange, onPreview, onApply,
    previewProject: current?.project,
    previewError: stale ? 'The project changed. Cancel this preview and reopen the constraint before applying it.' : actionError || current?.error,
    previewSummary: current?.summary,
    activeRule,
    highlightedPanelIds: activeRule ? designConstraintPanelIds(activeRule) : [],
    onHighlight: setHighlight,
    open: () => { setOpenRequest(++requestSequence.current); setActionError('') },
    manage: () => { setManageRequest(++requestSequence.current); setActionError('') },
    cancel: () => { setCancelRequest(value => value + 1); setEditing(false); source.current = null; setPreview(null); setHighlight(null); setActionError('') },
    onRemove: (id: string) => {
      commit(current => ({ ...current, constraints: current.constraints?.filter(rule => rule.id !== id) ?? [] }))
      if (highlight?.id === id) setHighlight(null)
      notify('Constraint removed. Undo is available.')
    },
    onToggle: (id: string, enabled: boolean) => {
      try {
        commit(current => {
          const rule = current.constraints?.find(item => item.id === id)
          return rule ? setDesignConstraint(current, { ...rule, enabled }) : current
        })
        setActionError('')
        notify(enabled ? 'Constraint enabled. Undo is available.' : 'Constraint disabled. Its settings are saved.')
      } catch (error) { setActionError(error instanceof Error ? error.message : 'This constraint cannot be enabled.'); }
    },
  }
}
