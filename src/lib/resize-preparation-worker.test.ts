import { afterEach, expect, it, vi } from 'vitest'
import { createPanel } from './model'
import { preparePreviewResize } from './preview-resize'
import { createResizePreparationWorker } from './resize-preparation-worker'
import type { Project } from './types'

class FakeWorker {
  static latest: FakeWorker
  onmessage?: (event: { data: unknown }) => void
  onerror?: () => void
  terminated = false
  messages: unknown[] = []
  constructor() { FakeWorker.latest = this }
  postMessage(message: unknown) { this.messages.push(message) }
  terminate() { this.terminated = true }
}
afterEach(() => vi.unstubAllGlobals())
const source = (): Project => ({ version: 1, name: 'Source', panels: [createPanel({ id: 'a' })], connections: [] })

it('restores the borrowed source identity before a prepared handle can start a gesture', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  const project = source(), selection = { panelId: 'a' }
  const job = createResizePreparationWorker({ kind: 'handles', project, selection }), worker = FakeWorker.latest
  const session = preparePreviewResize(structuredClone(project), selection)!
  worker.onmessage!({ data: { kind: 'handles', session } })
  const result = await job.result
  expect(result?.kind).toBe('handles')
  if (result?.kind === 'handles') {
    expect(result.session!.original).toBe(project)
    expect(result.session!.drivers).toBeInstanceOf(Map)
  }
  expect(worker.terminated).toBe(true)
})

it('terminates superseded preparation and ignores late replies after cancellation', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  const job = createResizePreparationWorker({ kind: 'ranges', project: source() }), worker = FakeWorker.latest
  job.stop()
  worker.onmessage!({ data: { kind: 'ranges', values: [{ id: 'stale' }] } })
  expect(await job.result).toBeNull()
  expect(worker.terminated).toBe(true)
})

it('settles worker failure once and does not replace it with a late successful result', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  const job = createResizePreparationWorker({ kind: 'ranges', project: source() }), worker = FakeWorker.latest
  worker.onerror!()
  worker.onmessage!({ data: { kind: 'ranges', values: [] } })
  expect(await job.result).toMatchObject({ kind: 'error' })
  expect(worker.terminated).toBe(true)
})
