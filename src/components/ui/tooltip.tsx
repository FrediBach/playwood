import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
export const TooltipProvider = TooltipPrimitive.Provider
export function Tooltip({label, children, side}: {label:string; children:ReactNode; side?:'top'|'right'|'bottom'|'left'}) {
  return <TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="tooltip" side={side} sideOffset={7}>{label}<TooltipPrimitive.Arrow className="tooltip-arrow"/></TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root>
}
