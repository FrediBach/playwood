import { getPanelGroundExtension } from '@/lib/extend-to-ground'
import { preparePreviewResize, type PreviewResizeSelection } from '@/lib/preview-resize'
import type { Project } from '@/lib/types'

const CACHE_LIMIT = 8

function remember<T>(cache: Map<string, T>, key: string, compute: () => T): T {
  if (cache.has(key)) {
    const value = cache.get(key)!
    cache.delete(key)
    cache.set(key, value)
    return value
  }
  const value = compute()
  cache.set(key, value)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  return value
}

/** Owned by an editor hook for one immutable project snapshot. Bound retained
 * candidates and preserve selection order rather than sharing global results. */
export function createSelectionPreparations(project: Project) {
  const resize = new Map<string, ReturnType<typeof preparePreviewResize>>()
  const ground = new Map<string, ReturnType<typeof getPanelGroundExtension>>()
  return {
    resize: (selection: PreviewResizeSelection) => remember(resize,
      JSON.stringify([selection.panelId, selection.panelIds, selection.connectorId]),
      () => preparePreviewResize(project, selection)),
    ground: (panelId: string) => remember(ground, panelId, () => getPanelGroundExtension(project, panelId)),
  }
}
