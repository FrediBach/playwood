import type { LibraryDrawing } from './library-preview'
import type { Project } from './types'

export type LibraryWorkerRequest = { request: number; id: string } & (
  | { kind: 'preview'; content?: string }
  | { kind: 'project' }
)
export interface LibraryWorkerResponse {
  request: number
  drawing?: LibraryDrawing
  project?: Project
  error?: string
}

/** Open each thumbnail candidate once, preserving its factory's identity behavior. */
export class PreparedExampleProjects {
  private projects = new Map<string, Project>()

  remember(id: string, project: Project) {
    this.projects.delete(id)
    this.projects.set(id, project)
    if (this.projects.size > 8) this.projects.delete(this.projects.keys().next().value!)
  }

  take(id: string): Project | undefined {
    const project = this.projects.get(id)
    this.projects.delete(id)
    return project
  }
}

export const preparedExampleProjects = new PreparedExampleProjects()
export type ExampleProjectResult = { project: Project; error?: never } | { project?: never; error: string }
const preparationError = 'This example could not be prepared. Cancel and choose it again.'

/** Dedicated requests stay responsive even while another worker renders library cards. */
export function prepareExampleProject(
  id: string,
  onResult: (result: ExampleProjectResult) => void,
  createWorker = () => new Worker(new URL('./library-preview.worker.ts', import.meta.url), { type: 'module' }),
): () => void {
  let active = true
  let worker: Worker | undefined
  const finish = (result: ExampleProjectResult) => {
    if (!active) return
    active = false
    worker?.terminate()
    onResult(result)
  }
  try {
    worker = createWorker()
    worker.onmessage = (event: MessageEvent<LibraryWorkerResponse>) => {
      if (event.data.request !== 1) return
      finish(event.data.project ? { project: event.data.project } : { error: event.data.error || preparationError })
    }
    worker.onerror = () => finish({ error: preparationError })
    worker.onmessageerror = () => finish({ error: preparationError })
    worker.postMessage({ kind: 'project', request: 1, id } satisfies LibraryWorkerRequest)
  } catch {
    finish({ error: preparationError })
  }
  return () => {
    if (!active) return
    active = false
    worker?.terminate()
  }
}
