import { copyConstructionObjects } from './construction-objects'
import { constructionBounds, evaluateConstructionObjects, type ObjectBounds, type ObjectSurface } from './object-geometry'
import type { ConstructionObjects, Project, Vec3 } from './types'

export interface ConversionRegion { id: string; name: string; bounds: ObjectBounds }
export interface ConversionFailurePreview {
  objects: ConstructionObjects;
  surfaces?: ObjectSurface[];
  regions: ConversionRegion[];
  bounds: ObjectBounds;
}
export class ObjectConversionError extends Error {
  constructor(message: string, readonly regions: ConversionRegion[]) { super(message); this.name = 'ObjectConversionError' }
}
export function withConversionRegions<T>(regions: ConversionRegion[], solve: () => T): T {
  try { return solve() }
  catch (error) {
    if (error instanceof ObjectConversionError) throw error
    throw new ObjectConversionError(error instanceof Error ? error.message : 'Conversion failed.', regions)
  }
}

/** Diagnostic-only data. Never return or commit a partially solved construction. */
export function conversionFailurePreview(source: Project, ids: readonly string[], error: unknown): ConversionFailurePreview | undefined {
  try {
    const selected = copyConstructionObjects(source, ids), roots = new Set(selected.roots)
    const objects = { ...selected, nodes: selected.nodes.map(node => roots.has(node.id) ? { ...node, visible: true } : node) }
    let surfaces: ObjectSurface[] | undefined
    try { surfaces = evaluateConstructionObjects(objects) } catch { /* Complexity failures still get source-bound outlines. */ }
    const names = new Map(objects.nodes.map(node => [node.id, node.name]))
    const regions = error instanceof ObjectConversionError ? error.regions : objects.roots.flatMap(id => {
      const bounds = surfaces?.find(surface => surface.id === id)?.bounds ?? constructionBounds(objects, [id])
      return bounds ? [{ id, name: names.get(id)!, bounds }] : []
    })
    const bounds = [...regions.map(region => region.bounds), ...(surfaces ?? []).flatMap(surface => surface.bounds ? [surface.bounds] : [])]
    if (!bounds.length) return
    return { objects, surfaces, regions, bounds: {
      min: [0, 1, 2].map(axis => Math.min(...bounds.map(b => b.min[axis]))) as Vec3,
      max: [0, 1, 2].map(axis => Math.max(...bounds.map(b => b.max[axis]))) as Vec3,
    } }
  } catch { return undefined }
}
