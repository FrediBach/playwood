import { orderedConnectors } from '@/lib/list-groups'
import type { AssemblyInstance,Panel } from '@/lib/types'


export function contextMenuTitle(inspectingConnectors: boolean,selectedConnectors: ReturnType<typeof orderedConnectors>,instance: AssemblyInstance|undefined,selectedPanels: Panel[]): string {
  return inspectingConnectors? `${selectedConnectors.length} connectors`:instance?.name??(selectedPanels.length===1? selectedPanels[0].name:selectedPanels.length? `${selectedPanels.length} panels`:'Preview')
}
