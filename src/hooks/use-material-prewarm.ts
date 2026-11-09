import { useEffect } from 'react'
import { prewarmWoodTextures } from '@/components/wood-texture'

/** App owns prewarming once; extra scene/export canvases reuse the same sources. */
export function useMaterialPrewarm() {
  useEffect(prewarmWoodTextures, [])
}
