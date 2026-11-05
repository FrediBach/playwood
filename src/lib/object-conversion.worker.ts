import { conversionFailurePreview } from './object-conversion-diagnostics'
import { convertConstructionObject, type ObjectConversionOptions } from './object-conversion'
import type { Project } from './types'
self.onmessage = (event: MessageEvent<{ source: Project; ids: string[]; options: ObjectConversionOptions }>) => {
  try { self.postMessage({ result: convertConstructionObject(event.data.source, event.data.ids, event.data.options) }) }
  catch (error) {
    const failure = conversionFailurePreview(event.data.source, event.data.ids, error)
    self.postMessage({ error: error instanceof Error ? error.message : 'Conversion failed.', failure }, { transfer: failure?.surfaces?.map(surface => surface.positions.buffer) ?? [] })
  }
}
