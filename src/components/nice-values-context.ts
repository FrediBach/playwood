import { createContext, useContext } from 'react'
import { getNiceValueStep } from '@/lib/nice-values'
import type { NiceValuesSettings } from '@/lib/types'

export const NiceValuesContext = createContext<NiceValuesSettings | undefined>(undefined)

export function useNiceValueStep() {
  return getNiceValueStep(useContext(NiceValuesContext))
}
