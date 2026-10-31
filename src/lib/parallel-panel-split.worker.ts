import { parallelPanelSplitCounts } from './parallel-panels'
import type { Project } from './types'

self.onmessage = (event: MessageEvent<{ project: Project; ids: string[] }>) => {
  const counts: number[] = []
  parallelPanelSplitCounts(event.data.project, event.data.ids, count => {
    counts.push(count)
    self.postMessage({ counts, checking: true })
  })
  self.postMessage({ counts, checking: false })
}
