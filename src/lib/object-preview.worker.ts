import { evaluateConstructionObjects } from './object-geometry'
import type { ConstructionObjects } from './types'

self.onmessage = (event: MessageEvent<ConstructionObjects>) => {
  try {
    const surfaces = evaluateConstructionObjects({ ...event.data, nodes: event.data.nodes.map(node => node.wireframe ? { ...node, visible: true } : node) })
    self.postMessage({ surfaces }, { transfer: surfaces.map(surface => surface.positions.buffer) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not evaluate the object preview.' })
  }
}
