import { createExampleProject } from './example-library'
import { parseDirectoryProjectContent } from './directory-sync'
import { createLibraryDrawing } from './library-preview'
import type { LibraryWorkerRequest, LibraryWorkerResponse } from './example-project-preparation'

self.onmessage = (event: MessageEvent<LibraryWorkerRequest>) => {
  const { request, id, kind } = event.data
  try {
    if (kind === 'project') {
      self.postMessage({ request, project: createExampleProject(id) } satisfies LibraryWorkerResponse)
      return
    }
    const { content } = event.data
    const project = content === undefined ? createExampleProject(id) : parseDirectoryProjectContent(content)
    self.postMessage({ request, drawing: createLibraryDrawing(project), ...(content === undefined ? { project } : {}) } satisfies LibraryWorkerResponse)
  } catch {
    self.postMessage({ request, error: kind === 'project' ? 'This example could not be prepared. Cancel and choose it again.' : 'Preview unavailable. Try Sync → Resync for folder files.' } satisfies LibraryWorkerResponse)
  }
}
