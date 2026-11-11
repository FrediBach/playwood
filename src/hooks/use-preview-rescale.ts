import { createResizePreparationWorker } from '@/lib/resize-preparation-worker'
import { getPreviewRescaleValues } from '@/lib/preview-rescale-values'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  const background = project.panels.length >= 12
  const [ranges, setRanges] = useState<{ source: Project; values: RescaleValue[]; error?: string } | null>(null)
  useEffect(() => {
    if (!background) return
    const job = createResizePreparationWorker({ kind: 'ranges', project })
    let active = true
    void job.result.then(result => {
      if (!active || !result) return
      if (result.kind === 'ranges') setRanges({ source: project, values: result.values })
      else if (result.kind === 'error') setRanges({ source: project, values: [], error: result.message })
    })
    return () => { active = false; job.stop() }
  }, [project, background])
  const pending = background && ranges?.source !== project
  const discovered = useMemo(() => background ? ranges?.values ?? [] : getPreviewRescaleValues(project), [project, background, ranges])
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
    values, pending, disabled: disabled || pending, active: !!session, project: session?.candidate,
    amount: session ? { [session.id]: session.amount } : {}, error: session?.error ?? (ranges?.source === project ? ranges.error : undefined),
    cancel, finish,
    change: (id: string, amount: number) => {
      if (disabled || pending) return
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
