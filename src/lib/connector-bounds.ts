import type { ConnectorType, Vec3 } from './types'

/** Per-part bounds measured from the bundled CAD after connector-geometry.ts's
 * normalization, in millimeters. Keep domain geometry usable outside Vite:
 * importing raw OBJ bytes here would break workers and Node-based project tools.
 * connector-bounds.test.ts verifies these against the rendering geometry.
 */
export const CONNECTOR_LOCAL_BOUNDS: Record<ConnectorType, { min: Vec3; max: Vec3 }[]> = {
  '90': [
    { min: [-15.999882, -20, -15.999882], max: [53.408626, 20, 53.408626] },
    { min: [8.999876, -20, 8.999876], max: [52.840494, 20, 52.840494] },
  ],
  '105': [
    { min: [-26.398547, -20, -15.999999], max: [51.405936, 20, 47.324959] },
    { min: [-5.200575, -20, 8.999995], max: [53.681944, 20, 54.182142] },
  ],
  '150': [
    { min: [-43.821149, -20, -15.978219], max: [45.402803, 20, 14.905147] },
    { min: [-34.376241, -20, 8.999721], max: [46.765901, 20, 37.239112] },
  ],
  t: [
    { min: [-53.204957, -20, -17.320029], max: [53.204957, 20, 24.56598] },
    { min: [-52.840576, -20, 9.00003], max: [-9, 20, 52.84059] },
    { min: [9, -20, 9.00003], max: [52.840576, 20, 52.84059] },
  ],
  cross: [
    { min: [-53.383119, -20, -53.383116], max: [53.383119, 20, 53.383116] },
    { min: [-53.537354, -20, 8.989498], max: [-8.989441, 20, 53.532343] },
    { min: [8.989502, -20, -53.53735], max: [53.532347, 20, -8.989491] },
  ],
}
