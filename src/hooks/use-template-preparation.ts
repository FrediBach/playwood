import { useEffect, useState } from 'react'
import type { ProjectDialog } from '@/components/ProjectDialogs'
import { prepareExampleProject, type ExampleProjectResult } from '@/lib/example-project-preparation'
import type { Project } from '@/lib/types'

export interface PendingTemplate {
  id: string
  name: string
  source: Project
  returnTo: ProjectDialog
  project?: Project
}

export function useTemplatePreparation(request: PendingTemplate | null, source: Project, enabled: boolean) {
  const [result, setResult] = useState<{ request: PendingTemplate; result: ExampleProjectResult }>()
  if (result && (!enabled || result.request !== request)) setResult(undefined)
  useEffect(() => {
    if (!enabled || !request || request.source !== source || request.project) return
    return prepareExampleProject(request.id, result => setResult({ request, result }))
  }, [request, source, enabled])

  if (!enabled || !request) return { project: undefined, error: undefined, loading: false }
  if (request.source !== source) return { project: undefined, error: 'The current project changed. Cancel and choose the example again.', loading: false }
  if (request.project) return { project: request.project, error: undefined, loading: false }
  if (result?.request === request) return { ...result.result, loading: false }
  return { project: undefined, error: undefined, loading: true }
}
