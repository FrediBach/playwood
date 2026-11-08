import { useEffect, useMemo, useState } from 'react'
import type { ConstructionObjects } from '@/lib/types'
import { reuseObjectPreview } from '@/lib/object-preview'
import type { ObjectSurface } from '@/lib/object-geometry'

export function useObjectPreview(objects: ConstructionObjects | undefined, enabled: boolean) {
  const [result, setResult] = useState<{ source: ConstructionObjects; surfaces?: ObjectSurface[]; error?: string }>()
  const reused = useMemo(() => enabled && objects && result?.surfaces && result.source !== objects
    ? reuseObjectPreview(result.source, objects, result.surfaces) : undefined, [enabled, objects, result])
  const complete = !!reused && reused.length === objects?.roots.filter(id => objects.nodes.some(node => node.id === id && (node.visible || node.wireframe))).length
  const evaluated = result?.source === objects
  const warningsPending = !!reused?.some(surface => surface.warningsPending)
  useEffect(() => {
    if (!enabled || !objects?.roots.length || evaluated || (complete && !warningsPending)) return
    let active = true
    const worker = new Worker(new URL('../lib/object-preview.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ surfaces?: ObjectSurface[]; error?: string }>) => {
      if (active) setResult({ source: objects, ...event.data })
    }
    worker.onerror = () => { if (active) setResult({ source: objects, error: 'Object preview could not start. Try editing the shape again.' }) }
    worker.postMessage(objects)
    return () => { active = false; worker.terminate() }
  }, [objects, enabled, complete, warningsPending, evaluated])
  return enabled && result && result.source === objects ? { surfaces: result.surfaces, error: result.error, pending: false }
    : { surfaces: reused, error: undefined, pending: !complete && enabled && !!objects?.roots.length }
}
