import { writeFileSync } from 'node:fs'
import { Session, type Profiler } from 'node:inspector'
import { it } from 'vitest'
import { createStarterProject } from './model'
import { synthStorageShelfProject } from './synth-storage-shelf'
import { gridProject } from './example-geometry'
import { getPreviewRescaleValues } from './preview-rescale-values'
import { getRescaleValues, rescaleProject } from './project-rescale'
import { preparePreviewResize, movePreviewResize } from './preview-resize'

/** Opt-in local report. Timings are observations, never CI pass/fail thresholds. */
it.runIf(!!process.env.RESCALE_PERFORMANCE_REPORT)('profiles discovery, first solve, and repeated rescale samples', async () => {
  const profiler = new Session()
  profiler.connect()
  const post = (method: string) => new Promise<{ profile?: Profiler.Profile }>((resolve, reject) => profiler.post(method, (error, result) => error ? reject(error) : resolve((result ?? {}) as { profile?: Profiler.Profile })))
  await post('Profiler.enable')
  await post('Profiler.start')
  const timed = <T>(run: () => T) => {
    const start = performance.now()
    try { const value = run(); return { value, ms: performance.now() - start } }
    catch (error) { return { ms: performance.now() - start, error: error instanceof Error ? error.message : String(error) } }
  }
  const reports = [createStarterProject(), synthStorageShelfProject(), gridProject('Large grid', Array(8).fill(350), Array(10).fill(300))].map(source => {
    const grouping = timed(() => getRescaleValues(source))
    const first = grouping.value!.find(value => value.kind === 'dimension')!
    const solve = timed(() => rescaleProject(source, { [first.id]: first.value + 10 }))
    const discovery = timed(() => getPreviewRescaleValues(source))
    const repeated = timed(() => getPreviewRescaleValues(source))
    const panel = source.panels[0]
    const preparation = timed(() => preparePreviewResize(source, { panelId: panel.id }))
    const handle = preparation.value?.handles.find(item => item.id === 'panel-width-positive')
    const samples = [8, 16, 24].map(distance => {
      const result = timed(() => movePreviewResize(preparation.value!, handle!.id, distance))
      return { distance, ms: result.ms, error: result.error }
    })
    return { name: source.name, panels: source.panels.length, connections: source.connections.length,
      groupingMs: grouping.ms, solveMs: solve.ms, solveError: solve.error,
      discoveryMs: discovery.ms, rediscoveryMs: repeated.ms, ranges: discovery.value,
      handlePreparationMs: preparation.ms, handleError: preparation.error, samples }
  })
  const { profile } = await post('Profiler.stop')
  profiler.disconnect()
  writeFileSync(process.env.RESCALE_PERFORMANCE_REPORT! + '.cpuprofile', JSON.stringify(profile))
  writeFileSync(process.env.RESCALE_PERFORMANCE_REPORT!, JSON.stringify({ runtime: process.version, platform: process.platform, reports }, null, 2))
}, 120000)
