import { splitPanelGrid } from './grid-split'
import type { Project } from './types'

self.onmessage = (event: MessageEvent<{ project: Project; ids: string[]; x: number; y: number }>) => {
  const { project, ids, x, y } = event.data
  try { self.postMessage({ result: splitPanelGrid(project, ids, x, y) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'These divisions do not fit.' }) }
}
