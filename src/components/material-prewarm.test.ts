import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMaterialPrewarm } from './material-prewarm'
import type { NaturalMaterial } from './material-raster'
import type { PackedMaterialRaster } from './material-raster-packing'

function sample(channels: 3 | 5 = 5): PackedMaterialRaster {
  return { width: 1, height: 1, tileWidth: 0.6, tileHeight: 0.6, channels,
    data: new Uint8Array(channels === 5 ? [31, 47, 59, 71, 83] : [31, 71, 83]) }
}

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn<(material: NaturalMaterial) => void>()
  terminate = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
  reply(material: NaturalMaterial, raster = sample()) { this.onmessage?.({ data: { material, raster } } as MessageEvent) }
}

let documentStub: EventTarget & { hidden: boolean }
let idleCallbacks: Map<number, IdleRequestCallback>
let cleanups: (() => void)[]

function idle() {
  const entry = idleCallbacks.entries().next().value
  expect(entry).toBeDefined()
  const [id, callback] = entry!
  idleCallbacks.delete(id)
  callback({ didTimeout: false, timeRemaining: () => 50 })
}

function start(cached = new Set<NaturalMaterial>()) {
  const accept = vi.fn((material: NaturalMaterial, _raster: PackedMaterialRaster) => { cached.add(material) })
  const stop = startMaterialPrewarm({ has: material => cached.has(material), accept })
  cleanups.push(stop)
  return { cached, accept, stop }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWorker.instances = []
  cleanups = []
  documentStub = Object.assign(new EventTarget(), { hidden: false })
  idleCallbacks = new Map()
  let nextIdle = 0
  vi.stubGlobal('document', documentStub)
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
    const id = ++nextIdle
    idleCallbacks.set(id, callback)
    return id
  }))
  vi.stubGlobal('cancelIdleCallback', vi.fn((id: number) => idleCallbacks.delete(id)))
})

afterEach(() => {
  cleanups.forEach(stop => stop())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('material prewarm lifecycle', () => {
  it('waits for idle and prepares uncached materials sequentially in one worker', () => {
    const { accept } = start(new Set(['birch']))
    expect(FakeWorker.instances).toHaveLength(0)
    const order: NaturalMaterial[] = ['osb', 'nazena', 'oak', 'walnut', 'mdf']
    for (const [index, material] of order.entries()) {
      idle()
      expect(FakeWorker.instances).toHaveLength(1)
      const worker = FakeWorker.instances[0]
      expect(worker.postMessage).toHaveBeenCalledTimes(index + 1)
      expect(worker.postMessage).toHaveBeenLastCalledWith(material)
      worker.reply(material)
      expect(accept).toHaveBeenCalledTimes(index + 1)
      // Finishing one generation never dispatches another job immediately.
      expect(worker.postMessage).toHaveBeenCalledTimes(index + 1)
    }
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
    expect(idleCallbacks.size).toBe(0)
  })

  it('rechecks the cache before dispatch and ignores a result after synchronous generation wins', () => {
    const { cached, accept } = start()
    cached.add('osb')
    idle()
    const worker = FakeWorker.instances[0]
    expect(worker.postMessage).toHaveBeenLastCalledWith('nazena')
    cached.add('nazena')
    worker.reply('nazena')
    expect(accept).not.toHaveBeenCalled()
    idle()
    expect(worker.postMessage).toHaveBeenLastCalledWith('birch')
  })

  it('cancels pending startup and ignores callbacks retained across Strict Mode cleanup', () => {
    const first = start()
    const abandonedIdle = [...idleCallbacks.values()][0]
    first.stop()
    expect(idleCallbacks.size).toBe(0)
    abandonedIdle({ didTimeout: false, timeRemaining: () => 50 })
    expect(FakeWorker.instances).toHaveLength(0)
    const second = start()
    idle()
    const worker = FakeWorker.instances[0]
    const abandonedReply = worker.onmessage!
    second.stop()
    expect(worker.terminate).toHaveBeenCalledOnce()
    abandonedReply({ data: { material: 'osb', raster: sample() } } as MessageEvent)
    expect(second.accept).not.toHaveBeenCalled()
    expect(idleCallbacks.size).toBe(0)
    start()
    idle()
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it('uses a cancellable delayed fallback when idle callbacks are unavailable', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const first = start()
    vi.advanceTimersByTime(249)
    expect(FakeWorker.instances).toHaveLength(0)
    first.stop()
    vi.runAllTimers()
    expect(FakeWorker.instances).toHaveLength(0)
    const second = start()
    vi.advanceTimersByTime(250)
    expect(FakeWorker.instances).toHaveLength(1)
    FakeWorker.instances[0].reply('osb')
    second.stop()
    vi.runAllTimers()
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledOnce()
  })

  it('waits while hidden and resumes without creating a second worker', () => {
    documentStub.hidden = true
    start()
    expect(idleCallbacks.size).toBe(0)
    documentStub.hidden = false
    documentStub.dispatchEvent(new Event('visibilitychange'))
    expect(idleCallbacks.size).toBe(1)
    documentStub.hidden = true
    documentStub.dispatchEvent(new Event('visibilitychange'))
    expect(idleCallbacks.size).toBe(0)
    documentStub.hidden = false
    documentStub.dispatchEvent(new Event('visibilitychange'))
    idle()
    const worker = FakeWorker.instances[0]
    documentStub.hidden = true
    documentStub.dispatchEvent(new Event('visibilitychange'))
    worker.reply('osb')
    expect(idleCallbacks.size).toBe(0)
    documentStub.hidden = false
    documentStub.dispatchEvent(new Event('visibilitychange'))
    idle()
    expect(FakeWorker.instances).toHaveLength(1)
    expect(worker.postMessage).toHaveBeenLastCalledWith('nazena')
  })

  it.each(['error', 'messageerror', 'reported failure'] as const)('terminates on %s without accepting or restarting work', failure => {
    const { accept } = start()
    idle()
    const worker = FakeWorker.instances[0]
    if (failure === 'error') worker.onerror!({ preventDefault: vi.fn() } as unknown as ErrorEvent)
    else if (failure === 'messageerror') worker.onmessageerror!()
    else worker.onmessage!({ data: { material: 'osb', error: true } } as MessageEvent)
    expect(accept).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledOnce()
    documentStub.dispatchEvent(new Event('visibilitychange'))
    expect(idleCallbacks.size).toBe(0)
  })

  it('leaves rendering available when workers cannot start', () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker unavailable') } })
    const { accept } = start()
    expect(idle).not.toThrow()
    expect(accept).not.toHaveBeenCalled()
    expect(idleCallbacks.size).toBe(0)
  })
})

describe('shared texture cache integration', () => {
  it('expands prepared pixels once into stable sources and keeps wrappers independently disposable', async () => {
    vi.resetModules()
    const { prewarmWoodTextures, createWoodTextures } = await import('./wood-texture')
    const stop = prewarmWoodTextures()
    cleanups.push(stop)
    idle()
    const packed = sample()
    FakeWorker.instances[0].reply('osb', packed)
    const first = createWoodTextures('osb')
    expect([...first.color.image.data]).toEqual([31, 47, 59, 255])
    expect([...first.surface.image.data]).toEqual([71, 83, 0, 255])
    packed.data.fill(0)
    const second = createWoodTextures('osb')
    expect(second.color.source).toBe(first.color.source)
    expect(second.surface.source).toBe(first.surface.source)
    expect([...second.color.image.data]).toEqual([31, 47, 59, 255])
    const disposed = vi.fn()
    second.color.addEventListener('dispose', disposed)
    first.color.dispose(); first.surface.dispose()
    expect(disposed).not.toHaveBeenCalled()
    second.color.dispose(); second.surface.dispose()
    stop()
    cleanups.push(prewarmWoodTextures())
    idle()
    expect(FakeWorker.instances[1].postMessage).toHaveBeenLastCalledWith('nazena')
  })

  it('never replaces a source created before its prewarm result arrives', async () => {
    vi.resetModules()
    const { prewarmWoodTextures, createWoodTextures } = await import('./wood-texture')
    cleanups.push(prewarmWoodTextures())
    idle()
    const worker = FakeWorker.instances[0]
    worker.reply('osb')
    idle()
    worker.reply('nazena')
    idle()
    expect(worker.postMessage).toHaveBeenLastCalledWith('birch')
    const first = createWoodTextures('birch')
    worker.reply('birch', sample(3))
    const second = createWoodTextures('birch')
    expect(second.color.source).toBe(first.color.source)
    expect(second.surface.source).toBe(first.surface.source)
    expect(second.color.image.width).toBe(512)
    expect(second.color.image.height).toBe(1024)
    first.color.dispose(); first.surface.dispose()
    second.color.dispose(); second.surface.dispose()
  })
})
