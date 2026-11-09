import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LibraryWorkerRequest, LibraryWorkerResponse } from './example-project-preparation'
import type { Project } from './types'

describe('library worker requests', () => {
  const scope = { onmessage: undefined as ((event: MessageEvent<LibraryWorkerRequest>) => void) | undefined, postMessage: vi.fn() }
  beforeAll(async () => {
    vi.stubGlobal('self', scope)
    await import('./library-preview.worker')
  })
  afterAll(() => vi.unstubAllGlobals())
  const request = (data: LibraryWorkerRequest): LibraryWorkerResponse => {
    scope.postMessage.mockClear()
    scope.onmessage!({ data } as MessageEvent<LibraryWorkerRequest>)
    return scope.postMessage.mock.calls[0][0]
  }

  it('provides a reusable built-in preview candidate and fresh identities on later project requests', () => {
    const preview = request({ kind: 'preview', request: 1, id: 'cube' })
    expect(preview.drawing?.length).toBeGreaterThan(0)
    expect(preview.project?.panels.length).toBe(4)
    const next = request({ kind: 'project', request: 2, id: 'cube' })
    expect(next.drawing).toBeUndefined()
    expect(next.project?.panels.length).toBe(4)
    expect(next.project!.panels.some(panel => preview.project!.panels.some(first => first.id === panel.id))).toBe(false)
  })

  it('keeps synced project contents out of the prepared built-in cache', () => {
    const project: Project = { version: 1, name: 'Folder project', panels: [], connections: [] }
    const result = request({ kind: 'preview', request: 3, id: 'cube', content: JSON.stringify(project) })
    expect(result.drawing).toEqual([])
    expect(result.project).toBeUndefined()
  })

  it('preserves supplied project identities while giving each opening independent data', () => {
    const first = request({ kind: 'project', request: 4, id: 'h-table-monitor-speaker-stand' }).project!
    const second = request({ kind: 'project', request: 5, id: 'h-table-monitor-speaker-stand' }).project!
    expect(second.panels.map(panel => panel.id)).toEqual(first.panels.map(panel => panel.id))
    first.panels[0].name = 'Changed'
    expect(second.panels[0].name).not.toBe('Changed')
  })

  it('reports unknown examples as recoverable preparation failures', () => {
    expect(request({ kind: 'project', request: 6, id: 'missing' })).toEqual({ request: 6, error: expect.stringMatching(/Cancel.*choose/) })
  })
})
