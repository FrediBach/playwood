import { createContext, useContext, useEffect, useMemo, useRef, useState, Fragment, type ReactNode } from 'react'
import type { LibraryDrawing } from '@/lib/library-preview'
import { preparedExampleProjects, type LibraryWorkerRequest, type LibraryWorkerResponse } from '@/lib/example-project-preparation'

// Keep built-in drawings across visits; unused projects have a separate bounded cache.
const examples = new Map<string, LibraryDrawing>()
class PreviewRenderer {
  private worker: Worker | null = null
  private next = 0
  private pending = new Map<number, { exampleId?: string; resolve: (drawing: LibraryDrawing) => void; reject: (error: Error) => void }>()

  render(id: string, content?: string): Promise<LibraryDrawing> {
    const cached = content === undefined ? examples.get(id) : undefined
    if (cached) return Promise.resolve(cached)
    if (!this.worker) {
      this.worker = new Worker(new URL('../lib/library-preview.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<LibraryWorkerResponse>) => {
        const job = this.pending.get(event.data.request)
        this.pending.delete(event.data.request)
        if (event.data.drawing) {
          if (job?.exampleId && event.data.project) preparedExampleProjects.remember(job.exampleId, event.data.project)
          job?.resolve(event.data.drawing)
        }
        else job?.reject(new Error(event.data.error || 'Preview unavailable.'))
      }
      this.worker.onerror = () => this.dispose()
    }
    const request = ++this.next
    return new Promise<LibraryDrawing>((resolve, reject) => {
      this.pending.set(request, { exampleId: content === undefined ? id : undefined, resolve, reject })
      this.worker!.postMessage({ kind: 'preview', request, id, content } satisfies LibraryWorkerRequest)
    }).then(drawing => {
      if (content === undefined) examples.set(id, drawing)
      return drawing
    })
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    for (const job of this.pending.values()) job.reject(new Error('Preview unavailable.'))
    this.pending.clear()
  }
}
const PreviewContext = createContext<PreviewRenderer | null>(null)

export function LibraryPreviewProvider({ children }: { children: ReactNode }) {
  const renderer = useMemo(() => new PreviewRenderer(), [])
  useEffect(() => () => renderer.dispose(), [renderer])
  return <PreviewContext.Provider value={renderer}>{children}</PreviewContext.Provider>
}

export function LibraryPreview({ id, read, revision }: { id: string; read?: (name: string) => Promise<string>; revision?: object }) {
  const renderer = useContext(PreviewContext)!
  const container = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<{ id: string; read: typeof read; revision?: object; drawing?: LibraryDrawing; error?: string } | null>(null)
  useEffect(() => {
    let canceled = false
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void (async () => {
        try {
          const content = read ? await read(id) : undefined
          if (canceled) return
          const drawing = await renderer.render(id, content)
          if (!canceled) setResult({ id, read, revision, drawing })
        } catch (error) {
          if (!canceled) setResult({ id, read, revision, error: error instanceof Error ? error.message : 'Preview unavailable.' })
        }
      })()
    }, { rootMargin: '150px' })
    if (container.current) observer.observe(container.current)
    return () => { canceled = true; observer.disconnect() }
  }, [id, read, revision, renderer])
  const current = result?.id === id && result.read === read && result.revision === revision ? result : null
  return <div ref={container} className="template-art example-art" aria-busy={!current}>
    {current?.drawing ? <svg viewBox="0 0 240 155" aria-hidden="true">
      {current.drawing.map((face, index) => <Fragment key={index}><polygon points={face.points} fill={face.color}/><path d={face.outline} fill="none" stroke="#5f503c" strokeOpacity=".45" strokeWidth=".65" strokeLinejoin="round"/></Fragment>)}
      {!current.drawing.length && <text x="120" y="80" textAnchor="middle" className="library-preview-empty">No panels to preview</text>}
    </svg> : <span className="library-preview-status" role="status">{current?.error || (read ? 'Loading synced project preview…' : 'Loading preview…')}</span>}
  </div>
}
