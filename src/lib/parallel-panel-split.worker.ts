import { parallelPanelSplitCounts, parallelPanelSplitDimensions } from './parallel-panels'
import type { Project } from './types'

self.onmessage = (event: MessageEvent<{ project: Project; ids: string[] }>) => {
  const counts: number[] = []
  const dimensions = parallelPanelSplitDimensions(event.data.project, event.data.ids)
  self.postMessage({ counts, dimensions, checking: true })
  parallelPanelSplitCounts(event.data.project, event.data.ids, count => {
    counts.push(count)
    self.postMessage({ counts, dimensions, checking: true })
  })
  self.postMessage({ counts, dimensions, checking: false })
}
