import { preparePreviewResize } from './preview-resize'
import { getPreviewRescaleValues } from './preview-rescale-values'
import type { ResizePreparationRequest, ResizePreparationResult } from './resize-preparation-worker'

self.onmessage = (event: MessageEvent<ResizePreparationRequest>) => {
  const request = event.data
  let result: ResizePreparationResult
  try {
    result = request.kind === 'handles'
      ? { kind: 'handles', session: preparePreviewResize(request.project, request.selection) }
      : { kind: 'ranges', values: getPreviewRescaleValues(request.project) }
  } catch (error) {
    result = { kind: 'error', message: error instanceof Error ? error.message : 'Resize controls could not be prepared.' }
  }
  self.postMessage(result)
}
