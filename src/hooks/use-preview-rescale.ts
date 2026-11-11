import { getPreviewRescaleValues } from '@/lib/preview-rescale-values'
import { useMemo, useRef, useState } from 'react'
import { rescaleProject, type RescaleValue } from '@/lib/project-rescale'
import type { Project } from '@/lib/types'

interface Session {
  source: Project
  values: RescaleValue[]
  id: string
  candidate: Project
  amount: number
  error?: string
}

export function usePreviewRescale(project: Project, disabled: boolean, commit: (change: (current: Project) => Project) => boolean) {
  const [draft, setDraft] = useState<Session | null>(null)
  const latest = useRef<Session | null>(null)
  const session = !disabled && draft?.source === project ? draft : null
  const discovered = useMemo(() => getPreviewRescaleValues(project), [project])
  const values = session?.values ?? discovered
  const update = (next: Session | null) => { latest.current = next; setDraft(next) }
  const cancel = () => update(null)
  const finish = () => {
    const current = latest.current
    cancel()
    if (!disabled && current?.source === project && current.candidate !== project) {
      commit(source => {
        if (source !== current.source) throw new Error('The construction changed. Try the slider again.')
        return current.candidate
      })
    }
  }
  return {
    values, disabled, active: !!session, project: session?.candidate,
    amount: session ? { [session.id]: session.amount } : {}, error: session?.error,
    cancel, finish,
    change: (id: string, amount: number) => {
      if (disabled) return
      const value = values.find(value => value.id === id)
      if (!value) return
      const previous = latest.current
      const current = previous?.source === project && previous.id === id ? previous : {
        source: project, values, id, candidate: project, amount: value.value,
      }
      try {
        const candidate = rescaleProject(current.source, { [id]: amount })
        update({ ...current, candidate, amount, error: undefined })
      } catch (error) {
        update({ ...current, error: error instanceof Error ? error.message : 'This size does not fit the construction.' })
      }
    },
  }
}
