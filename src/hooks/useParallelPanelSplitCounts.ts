import { useEffect, useState } from 'react'
import { parallelPanelCut } from '@/lib/parallel-panels'
import { resolvePanels } from '@/lib/model'
import type { Project } from '@/lib/types'

export function useParallelPanelSplitCounts(project: Project, ids: string[]) {
  const [result, setResult] = useState<{ project: Project; ids: string[]; counts: number[]; checking: boolean }>()
  useEffect(() => {
    if (!parallelPanelCut(resolvePanels(project).filter(panel => ids.includes(panel.id)))) return
    const worker = new Worker(new URL('../lib/parallel-panel-split.worker.ts', import.meta.url), { type: 'module' })
    setResult({ project, ids, counts: [], checking: true })
    worker.onmessage = (event: MessageEvent<{ counts: number[]; checking: boolean }>) => {
      setResult({ project, ids, ...event.data })
    }
    worker.onerror = () => setResult({ project, ids, counts: [], checking: false })
    worker.postMessage({ project, ids })
    return () => worker.terminate()
  }, [project, ids])
  return result?.project === project && result.ids === ids ? result : { counts: [] as number[], checking: true }
}
