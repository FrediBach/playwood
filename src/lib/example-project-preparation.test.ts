import { describe, expect, it, vi } from 'vitest'
import { PreparedExampleProjects, prepareExampleProject, type LibraryWorkerResponse } from './example-project-preparation'
import type { Project } from './types'

const project = (name: string): Project => ({ version: 1, name, panels: [], connections: [] })
function workerStub() {
  const worker = {
    onmessage: null as ((event: MessageEvent<LibraryWorkerResponse>) => void) | null,
    onerror: null as (() => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  }
  return { worker, create: () => worker as unknown as Worker,
    respond: (data: LibraryWorkerResponse) => worker.onmessage?.({ data } as MessageEvent<LibraryWorkerResponse>) }
}

describe('prepared example projects', () => {
  it('hands out a generated candidate only once without cloning or rewriting its identities', () => {
    const cache = new PreparedExampleProjects(), first = project('First opening'), second = project('Second opening')
    cache.remember('cube', first)
    expect(cache.take('cube')).toBe(first)
    expect(cache.take('cube')).toBeUndefined()
    cache.remember('cube', second)
    expect(cache.take('cube')).toBe(second)
    expect(cache.take('cube')).toBeUndefined()
  })

  it('retains only the eight most recently prepared candidates', () => {
    const cache = new PreparedExampleProjects()
    for (let index = 0; index < 8; index++) cache.remember(String(index), project(String(index)))
    cache.remember('0', project('Refreshed'))
    cache.remember('8', project('Newest'))
    expect(cache.take('1')).toBeUndefined()
    expect(cache.take('0')?.name).toBe('Refreshed')
    for (let index = 2; index <= 8; index++) expect(cache.take(String(index))?.name).toBe(String(index === 8 ? 'Newest' : index))
  })
})

describe('example project worker preparation', () => {
  it('returns the complete project once and releases the worker after completion', () => {
    const stub = workerStub(), onResult = vi.fn(), ready = project('Ready')
    const cancel = prepareExampleProject('cube', onResult, stub.create)
    expect(stub.worker.postMessage).toHaveBeenCalledWith({ kind: 'project', request: 1, id: 'cube' })
    stub.respond({ request: 99, project: ready })
    expect(onResult).not.toHaveBeenCalled()
    stub.respond({ request: 1, project: ready })
    stub.respond({ request: 1, project: project('Duplicate response') })
    cancel()
    expect(onResult).toHaveBeenCalledExactlyOnceWith({ project: ready })
    expect(stub.worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('ignores a canceled response even when the same example is reopened', () => {
    const previous = workerStub(), current = workerStub(), oldResult = vi.fn(), newResult = vi.fn()
    const cancel = prepareExampleProject('cube', oldResult, previous.create)
    cancel()
    prepareExampleProject('cube', newResult, current.create)
    previous.respond({ request: 1, project: project('Old') })
    expect(oldResult).not.toHaveBeenCalled()
    expect(newResult).not.toHaveBeenCalled()
    current.respond({ request: 1, project: project('New') })
    expect(newResult).toHaveBeenCalledExactlyOnceWith({ project: project('New') })
    expect(previous.worker.terminate).toHaveBeenCalledTimes(1)
  })

  it.each(['onerror', 'onmessageerror'] as const)('reports %s and releases the worker', event => {
    const stub = workerStub(), onResult = vi.fn()
    prepareExampleProject('cube', onResult, stub.create)
    stub.worker[event]?.()
    expect(onResult).toHaveBeenCalledWith({ error: expect.stringMatching(/Cancel.*choose/) })
    expect(stub.worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('preserves a readable construction failure', () => {
    const stub = workerStub(), onResult = vi.fn()
    prepareExampleProject('cube', onResult, stub.create)
    stub.respond({ request: 1, error: 'Construction unavailable. Choose another example.' })
    expect(onResult).toHaveBeenCalledExactlyOnceWith({ error: 'Construction unavailable. Choose another example.' })
    expect(stub.worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('reports worker startup and message failures without leaving a live worker', () => {
    const onResult = vi.fn()
    prepareExampleProject('cube', onResult, () => { throw new Error('Unavailable') })()
    expect(onResult).toHaveBeenCalledOnce()
    const stub = workerStub()
    stub.worker.postMessage.mockImplementation(() => { throw new Error('Unavailable') })
    prepareExampleProject('cube', onResult, stub.create)()
    expect(onResult).toHaveBeenCalledTimes(2)
    expect(stub.worker.terminate).toHaveBeenCalledTimes(1)
  })
})
