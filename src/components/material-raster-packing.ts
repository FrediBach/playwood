import type { MaterialRaster, NaturalMaterial } from './material-raster'

export interface PackedMaterialRaster {
  width: number
  height: number
  tileWidth: number
  tileHeight: number
  channels: 3 | 5
  data: Uint8Array
}

/** Omit constant alpha/blue channels and the repeated gray channels in wood. */
export function packMaterialRaster(material: NaturalMaterial, raster: MaterialRaster): PackedMaterialRaster {
  const channels = material === 'osb' || material === 'nazena' ? 5 : 3
  const { color, surface, width, height, tileWidth, tileHeight } = raster
  const data = new Uint8Array(width * height * channels)
  for (let i = 0, p = 0; i < color.length; i += 4) {
    data[p++] = color[i]
    if (channels === 5) { data[p++] = color[i + 1]; data[p++] = color[i + 2] }
    data[p++] = surface[i]
    data[p++] = surface[i + 1]
  }
  return { width, height, tileWidth, tileHeight, channels, data }
}

/** Restore the exact RGBA buffers expected by the existing texture/export code. */
export function unpackMaterialRaster(packed: PackedMaterialRaster): MaterialRaster {
  const { width, height, tileWidth, tileHeight, channels, data } = packed
  if ((channels !== 3 && channels !== 5) || data.length !== width * height * channels) throw new Error('Invalid packed material raster.')
  const color = new Uint8Array(width * height * 4), surface = new Uint8Array(color.length)
  for (let i = 0, p = 0; i < color.length; i += 4) {
    color[i] = data[p++]
    color[i + 1] = channels === 5 ? data[p++] : color[i]
    color[i + 2] = channels === 5 ? data[p++] : color[i]
    color[i + 3] = 255
    surface[i] = data[p++]
    surface[i + 1] = data[p++]
    surface[i + 3] = 255
  }
  return { color, surface, width, height, tileWidth, tileHeight }
}
