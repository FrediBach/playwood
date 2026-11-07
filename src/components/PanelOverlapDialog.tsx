import { useMemo } from 'react'
import { resolvePanels, validateProject } from '@/lib/model'
import { repairPanelOverlaps } from '@/lib/panel-overlap-repair'
import type { Project } from '@/lib/types'
import { PanelChangeTable } from './PanelChangeTable'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

export function PanelOverlapDialog({ source, panelId, onApply, onCancel }: {
  source: Project; panelId: string; onApply: (candidate: Project) => void; onCancel: () => void
}) {
  const result = useMemo(() => {
    try {
      const candidate = repairPanelOverlaps(source, panelId)
      const before = new Map(resolvePanels(source).map(panel => [panel.id, panel]))
      const changes = resolvePanels(candidate).flatMap(after => {
        const original = before.get(after.id)!
        return JSON.stringify(original) === JSON.stringify(after) ? [] : [{ before: original, after }]
      })
      return { candidate, changes, error: null }
    } catch (error) { return { candidate: null, changes: [], error: error instanceof Error ? error.message : 'Could not repair these overlaps.' } }
  }, [source, panelId])
  const issues = validateProject(source).filter(issue => issue.id.startsWith('collision-') && issue.panelIds.includes(panelId))
  return <Dialog open onOpenChange={open => { if (!open) onCancel() }}>
    <DialogContent onCloseAutoFocus={event => {
      event.preventDefault()
      requestAnimationFrame(() => {
        const target = [...document.querySelectorAll<HTMLElement>(`[data-panel-id="${CSS.escape(panelId)}"] .panel-overlap-indicator`)].find(element => {
          const bounds = element.getBoundingClientRect()
          return bounds.width > 0 && bounds.right > 0 && bounds.left < innerWidth
        })
        const focusTarget = target ?? document.querySelector<HTMLCanvasElement>('canvas')
        focusTarget?.focus()
      })
    }}>
      <DialogTitle>Fix panel overlaps</DialogTitle>
      <DialogDescription>Review the automatic repair for {source.panels.find(panel => panel.id === panelId)?.name}. Nothing changes until you apply. The repair moves panels or trims edges while preserving joints and design rules.</DialogDescription>
      <ul>{issues.map(issue => <li key={issue.id}>{issue.message}</li>)}</ul>
      {result.error ? <p role="alert">{result.error}</p> : <>
        <PanelChangeTable changes={result.changes} label="Proposed panel changes"/>
        <p>All affected panels are listed above. Apply saves these changes together; Undo restores the original construction.</p>
      </>}
      <div className="dialog-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button disabled={!result.candidate || !result.changes.length} onClick={() => { if (result.candidate) onApply(result.candidate) }}>Apply automatic fix</Button></div>
    </DialogContent>
  </Dialog>
}
