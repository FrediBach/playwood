import type { Project } from './types'
import type { PreviewResizeSelection, PreviewResizeSession } from './preview-resize'
import type { RescaleValue } from './project-rescale'

export type ResizePreparationRequest = { kind: 'handles'; project: Project; selection: PreviewResizeSelection } | { kind: 'ranges'; project: Project }
export type ResizePreparationResult = { kind: 'handles'; session: PreviewResizeSession | null } | { kind: 'ranges'; values: RescaleValue[] } | { kind: 'error'; message: string }

/** One source-bound preparation. Termination cancels obsolete CPU work, not just
 * its result. Keep the borrowed history identity when crossing structured clone. */
export function createResizePreparationWorker(request: ResizePreparationRequest) {
  const worker = new Worker(new URL('./resize-preparation.worker.ts', import.meta.url), { type: 'module' })
  let settled = false
  let resolve: (value: ResizePreparationResult | null) => void
  const result = new Promise<ResizePreparationResult | null>(done => { resolve = done })
  const finish = (value: ResizePreparationResult | null) => {
    if (settled) return
    settled = true
    worker.terminate()
    resolve(value)
  }
  worker.onmessage = (event: MessageEvent<ResizePreparationResult>) => {
    if (settled) return
    const value = event.data
    if (value.kind === 'handles' && value.session) value.session.original = request.project
    finish(value)
  }
  worker.onerror = () => finish({ kind: 'error', message: 'Resize controls could not be prepared. Select the panel or reopen the project to try again.' })
  worker.postMessage(request)
  return { result, stop: () => finish(null) }
}
