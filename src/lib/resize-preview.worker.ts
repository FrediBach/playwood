import { finishPreviewResize, movePreviewResize, reviewPreviewResize, startPreviewResize, type PreviewResizeSession } from './preview-resize'
import { ResizeReviewRequired } from './numeric-resize'

let session: PreviewResizeSession
let handleId: string
let local: boolean
self.onmessage = (event: MessageEvent<{ id: number; session?: PreviewResizeSession; handleId?: string; local?: boolean; distance: number; finish?: boolean }>) => {
  const request = event.data
  try {
    if (request.session) {
      session = request.session
      handleId = request.handleId!
      local = request.local ?? false
      startPreviewResize(session, handleId, local)
    }
    let result = movePreviewResize(session, handleId, request.distance, local)
    if (request.finish) {
      const limited = result.limited
      result = finishPreviewResize(session, handleId, result, local)
      if (!result.groundLimited) reviewPreviewResize(session, handleId, result.distance, local, limited ? request.distance : undefined)
    }
    self.postMessage({ id: request.id, result })
  } catch (error) {
    self.postMessage({ id: request.id, ...(error instanceof ResizeReviewRequired ? { review: error.review }
      : { error: error instanceof Error ? error.message : 'This resize could not be solved.' }) })
  }
}
