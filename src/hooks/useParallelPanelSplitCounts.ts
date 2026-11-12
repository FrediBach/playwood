import { useEffect, useState } from 'react'
import { parallelPanelCut, type PanelSplitDimension } from '@/lib/parallel-panels'
import { resolvePanels } from '@/lib/model'
import type { Project } from '@/lib/types'

export function useParallelPanelSplitCounts(project: Project, ids: string[]) {
  const [result, setResult] = useState<{ project: Project; ids: string[]; counts: number[]; dimensions: PanelSplitDimension[]; checking: boolean }>()
  useEffect(() => {
    const selectedIds = new Set(ids)
    if (!parallelPanelCut(resolvePanels(project).filter(panel => selectedIds.has(panel.id)))) return
    const worker = new Worker(new URL('../lib/parallel-panel-split.worker.ts', import.meta.url), { type: 'module' })
    let active = true
    worker.onmessage = (event: MessageEvent<{ counts: number[]; dimensions: PanelSplitDimension[]; checking: boolean }>) => {
      if (active) setResult({ project, ids, ...event.data })
    }
    worker.onerror = () => { if (active) setResult({ project, ids, counts: [], dimensions: [], checking: false }) }
    worker.postMessage({ project, ids })
    return () => { active = false; worker.terminate() }
  }, [project, ids])
  return result?.project === project && result.ids === ids ? result : { counts: [] as number[], dimensions: [] as PanelSplitDimension[], checking: true }
}
