import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
export const TooltipProvider = TooltipPrimitive.Provider
export function Tooltip({label, children}: {label:string; children:ReactNode}) {
  return <TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="tooltip" sideOffset={7}>{label}<TooltipPrimitive.Arrow className="tooltip-arrow"/></TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root>
}
