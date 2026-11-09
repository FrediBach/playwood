import { createMaterialRaster, type NaturalMaterial } from './material-raster'
import { packMaterialRaster } from './material-raster-packing'

self.onmessage = (event: MessageEvent<NaturalMaterial>) => {
  const material = event.data
  try {
    const raster = packMaterialRaster(material, createMaterialRaster(material))
    self.postMessage({ material, raster }, { transfer: [raster.data.buffer] })
  } catch {
    // Prewarming is optional; rendering retains the synchronous generation path.
    self.postMessage({ material, error: true })
  }
}
