import { useEffect, useState } from 'react'
import type { ConstructionObjects } from '@/lib/types'
import type { ObjectSurface } from '@/lib/object-geometry'

export function useObjectPreview(objects: ConstructionObjects | undefined, enabled: boolean) {
  const [result, setResult] = useState<{ source: ConstructionObjects; surfaces?: ObjectSurface[]; error?: string }>()
  useEffect(() => {
    if (!enabled || !objects?.roots.length) return
    let active = true
    const worker = new Worker(new URL('../lib/object-preview.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ surfaces?: ObjectSurface[]; error?: string }>) => {
      if (active) setResult({ source: objects, ...event.data })
    }
    worker.onerror = () => { if (active) setResult({ source: objects, error: 'Object preview could not start. Try editing the shape again.' }) }
    worker.postMessage(objects)
    return () => { active = false; worker.terminate() }
  }, [objects, enabled])
  return enabled && result && result.source === objects ? { surfaces: result.surfaces, error: result.error, pending: false }
    : { surfaces: undefined, error: undefined, pending: enabled && !!objects?.roots.length }
}
