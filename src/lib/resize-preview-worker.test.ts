import { afterEach, expect, it, vi } from 'vitest'
import { createResizePreviewWorker } from './resize-preview-worker'
import { preparePreviewResize } from './preview-resize'
import { resizeIntentCorpus } from '../test/resize-intent-corpus'
import { createResizeIntent } from './resize-intent'

class FakeWorker {
  static latest: FakeWorker
  onmessage?: (event: { data: unknown }) => void
  onerror?: () => void
  messages: { id: number; distance: number; finish: boolean; session?: unknown }[] = []
  terminated = false
  constructor() { FakeWorker.latest = this }
  postMessage(message: typeof this.messages[number]) { this.messages.push(message) }
  terminate() { this.terminated = true }
  respond(data: unknown) { this.onmessage?.({ data }) }
}
afterEach(() => vi.unstubAllGlobals())
const setup = () => {
  vi.stubGlobal('Worker', FakeWorker)
  const source = resizeIntentCorpus.find(item => item.id === 'single-edge')!.source()
  const session = preparePreviewResize(source, { panelId: 'panel' })!
  return { source, client: createResizePreviewWorker(session, 'panel-width-positive', false), worker: FakeWorker.latest }
}
it('coalesces pointer samples and waits for the released target, retaining the latest completed preview', async () => {
  const { source, client, worker } = setup()
  const first = client.request(10), superseded = client.request(20), release = client.request(30, true)
  expect(await superseded).toBeNull()
  expect(worker.messages).toHaveLength(1)
  worker.respond({ id: 1, result: { project: source, distance: 10 } })
  expect((await first)?.result?.distance).toBe(10)
  expect(worker.messages.map(message => message.distance)).toEqual([10, 30])
  expect(worker.messages[1].finish).toBe(true)
  expect(worker.messages[1].session).toBeUndefined()
  worker.respond({ id: 3, result: { project: source, distance: 30 } })
  expect((await release)?.result?.distance).toBe(30)
  client.stop()
})
it('cancellation terminates pending work and late messages cannot return a candidate', async () => {
  const { source, client, worker } = setup()
  const active = client.request(10), pending = client.request(20)
  client.stop()
  expect(worker.terminated).toBe(true)
  worker.respond({ id: 1, result: { project: source, distance: 10 } })
  expect(await active).toBeNull()
  expect(await pending).toBeNull()
  expect(await client.request(40)).toBeNull()
})
it('rebinds cloned review sources to the exact borrowed history snapshot', async () => {
  const { source, client, worker } = setup()
  const request = client.request(100, true)
  const intent = createResizeIntent({ ...source }, { kind: 'panel-edge', local: false, edge: { panelId: 'panel', dimension: 'width', side: 1, distance: 100 } })
  worker.respond({ id: 1, review: { source: { ...source }, intent, requestedDimensions: { width: 500 }, alternatives: [] } })
  const result = await request
  expect(result?.review?.source).toBe(source)
  expect(result?.review?.intent?.source).toBe(source)
  client.stop()
})
