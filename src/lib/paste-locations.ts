import type { AssemblyAttachmentTarget } from './assemblies'
import type { Vec3 } from './types'

export interface PasteLocation {
  id: string
  label: string
  position: Vec3
  segment?: Vec3[]
  targets: AssemblyAttachmentTarget[]
}

/** Group alternatives by their destination, never by copied anchor or bend direction. */
export function groupPasteLocations(targets: AssemblyAttachmentTarget[]): PasteLocation[] {
  const groups = new Map<string, PasteLocation>()
  for (const target of targets) {
    const location = target.location ?? { id: target.anchorId ?? JSON.stringify([target.label, target.position.map(value => Math.round(value))]), label: target.label, position: target.position }
    const group = groups.get(location.id)
    if (group) group.targets.push(target)
    else groups.set(location.id, { ...location, targets: [target] })
  }
  return [...groups.values()]
}
