import type { ConnectorType } from './types'

// Measured from the supplied CAD: origin at the slot-centerline intersection,
// +X into the parent panel and +Z toward the first child. Distances are mm.
// The two angled jaws have symmetric panel seats; T/cross use the same 17.5 mm
// seats on each branch. The source slots are modeled for 18 mm panels.
export const CONNECTOR_PROFILES: Record<ConnectorType, { bend: number; seat: number }> = {
  '90': { bend: Math.PI / 2, seat: 17.5 },
  '105': { bend: 75 * Math.PI / 180, seat: 17.5472 },
  '150': { bend: Math.PI / 6, seat: 10.6613 },
  t: { bend: Math.PI / 2, seat: 17.5 },
  cross: { bend: Math.PI / 2, seat: 17.5 },
}
