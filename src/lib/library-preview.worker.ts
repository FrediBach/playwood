import { EXAMPLE_LIBRARY } from './example-library'
import { ASSEMBLY_LIBRARY } from './assembly-library'
import { parseDirectoryProjectContent } from './directory-sync'
import { createLibraryDrawing } from './library-preview'

self.onmessage = (event: MessageEvent<{ request: number; id: string; content?: string }>) => {
  const { request, id, content } = event.data
  try {
    const example = content === undefined ? [...EXAMPLE_LIBRARY, ...ASSEMBLY_LIBRARY].find(entry => entry.id === id) : undefined
    const project = content === undefined ? example?.create() : parseDirectoryProjectContent(content)
    if (!project) throw new Error('Project preview unavailable.')
    self.postMessage({ request, drawing: createLibraryDrawing(project) })
  } catch {
    self.postMessage({ request, error: 'Preview unavailable. Try Sync → Resync for folder files.' })
  }
}
