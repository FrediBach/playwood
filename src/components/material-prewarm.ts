import type { NaturalMaterial } from './material-raster'
import type { PackedMaterialRaster } from './material-raster-packing'

interface MaterialWarmCache {
  has: (material: NaturalMaterial) => boolean
  accept: (material: NaturalMaterial, raster: PackedMaterialRaster) => void
}
interface MaterialWarmResult { material: NaturalMaterial; raster?: PackedMaterialRaster; error?: boolean }

// Prepare the most expensive materials first; already rendered sources are skipped.
const MATERIALS: NaturalMaterial[] = ['osb', 'nazena', 'birch', 'oak', 'walnut', 'mdf']

/** One effect-owned worker, yielding between jobs and never holding up rendering. */
export function startMaterialPrewarm(cache: MaterialWarmCache) {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') return () => {}
  const queue = [...MATERIALS]
  let worker: Worker | undefined
  let current: NaturalMaterial | undefined
  let idle: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  function cancelSchedule() {
    if (idle !== undefined) cancelIdleCallback(idle)
    if (timer !== undefined) clearTimeout(timer)
    idle = undefined
    timer = undefined
  }
  function stop() {
    if (stopped) return
    stopped = true
    cancelSchedule()
    document.removeEventListener('visibilitychange', visibility)
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      worker = undefined
    }
  }
  function nextMaterial() {
    while (queue.length && cache.has(queue[0])) queue.shift()
    return queue[0]
  }
  function schedule() {
    if (stopped || current || idle !== undefined || timer !== undefined) return
    if (!nextMaterial()) { stop(); return }
    if (document.hidden) return
    if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') idle = requestIdleCallback(run)
    else timer = setTimeout(run, 250)
  }
  function run() {
    idle = undefined
    timer = undefined
    if (stopped || document.hidden) return
    if (!nextMaterial()) { stop(); return }
    current = queue.shift()!
    try {
      if (!worker) {
        worker = new Worker(new URL('./material-raster.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<MaterialWarmResult>) => {
          if (stopped || event.data.material !== current) return
          if (event.data.error || !event.data.raster) { stop(); return }
          if (!cache.has(current)) cache.accept(current, event.data.raster)
          current = undefined
          schedule()
        }
        worker.onerror = event => { event.preventDefault(); stop() }
        worker.onmessageerror = stop
      }
      worker.postMessage(current)
    } catch {
      stop()
    }
  }
  function visibility() {
    if (document.hidden) cancelSchedule()
    else schedule()
  }
  document.addEventListener('visibilitychange', visibility)
  schedule()
  return stop
}
