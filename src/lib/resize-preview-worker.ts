import type { PreviewResizeSession, movePreviewResize } from './preview-resize'
import type { ResizeReview } from './structure-edit'

export interface ResizeWorkerResult { result?: ReturnType<typeof movePreviewResize>; review?: ResizeReview; error?: string }
/** One worker per gesture. Keep at most one in-flight solve and one latest
 * pointer request; obsolete samples never build an unbounded worker queue. */
export function createResizePreviewWorker(session: PreviewResizeSession, handleId: string, local: boolean) {
  const worker = new Worker(new URL('./resize-preview.worker.ts', import.meta.url), { type: 'module' })
  let nextId = 0, stopped = false
  type Request = { id: number; distance: number; finish: boolean; resolve: (result: ResizeWorkerResult | null) => void }
  let active: Request | undefined, pending: Request | undefined
  const send = (request: Request) => {
    active = request
    worker.postMessage({ id: request.id, distance: request.distance, finish: request.finish,
      ...(request.id === 1 ? { session, handleId, local } : {}) })
  }
  worker.onmessage = (event: MessageEvent<ResizeWorkerResult & { id: number }>) => {
    if (stopped || event.data.id !== active?.id) return
    const response = event.data
    // Structured clone cannot preserve the borrowed history snapshot identity.
    if (response.review) {
      response.review.source = session.original
      if (response.review.intent) response.review.intent = { ...response.review.intent, source: session.original }
    }
    active.resolve(response)
    active = undefined
    if (pending) { const request = pending; pending = undefined; send(request) }
  }
  worker.onerror = () => {
    stopped = true
    worker.terminate()
    active?.resolve({ error: 'The resize worker stopped. Try the drag again.' })
    pending?.resolve({ error: 'The resize worker stopped. Try the drag again.' })
    active = pending = undefined
  }
  return {
    request(distance: number, finish = false): Promise<ResizeWorkerResult | null> {
      if (stopped) return Promise.resolve(null)
      return new Promise(resolve => {
        const request = { id: ++nextId, distance, finish, resolve }
        if (!active) send(request)
        else { pending?.resolve(null); pending = request }
      })
    },
    stop() {
      stopped = true
      worker.terminate()
      active?.resolve(null)
      pending?.resolve(null)
      active = pending = undefined
    },
  }
}
