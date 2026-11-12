import { useMemo } from 'react'
import { furnishingOptions, setPreviewFurnishingRole, usePreviewFurnishing } from '@/hooks/use-preview-furnishing'
import { furnishingNameHints, planPreviewFurnishings } from '@/lib/preview-furnishings'
import type { FurnishingRole, FurnishingRoleChoice } from '@/lib/preview-furnishing-roles'
import type { Panel, Project } from '@/lib/types'

export interface FurnishingMenuState {
  /** The shared choice of the selected surfaces, 'auto' when none, undefined when mixed. */
  current: FurnishingRoleChoice | 'auto' | undefined
  /** The automatic reading, when the selected surfaces agree. */
  detected: FurnishingRole | null
  choose: (choice: FurnishingRoleChoice | 'auto') => void
}

/**
 * The "Furnish as" choices for the selected level surfaces. Detection only runs
 * while the context menu is open in Realistic preview with Auto furnish enabled.
 */
export function useFurnishingMenu({ open, realisticPreview, inspectingConnectors, project, panels, selectedIds }: {
  open: boolean; realisticPreview: boolean; inspectingConnectors: boolean; project: Project; panels: Panel[]; selectedIds: readonly string[]
}): FurnishingMenuState | undefined {
  const furnishing = usePreviewFurnishing()
  return useMemo(() => {
    if (!open || !realisticPreview || !furnishing.enabled || inspectingConnectors || !selectedIds.length) return undefined
    const selected = new Set(selectedIds)
    const plan = planPreviewFurnishings(panels, furnishingOptions(furnishing, furnishingNameHints(project)))
    const surfaces = plan.surfaces.filter(surface => surface.memberIds.some(id => selected.has(id)))
    if (!surfaces.length) return undefined
    const choiceOf = (memberIds: string[]) => memberIds.map(id => furnishing.roles[id]).find(Boolean) ?? 'auto'
    const choices = new Set(surfaces.map(surface => choiceOf(surface.memberIds)))
    const detected = new Set(surfaces.map(surface => surface.detected))
    const memberIds = surfaces.flatMap(surface => surface.memberIds)
    return {
      current: choices.size === 1 ? [...choices][0] : undefined,
      detected: detected.size === 1 ? [...detected][0] : null,
      choose: (choice: FurnishingRoleChoice | 'auto') => setPreviewFurnishingRole(memberIds, choice),
    }
  }, [open, realisticPreview, furnishing, inspectingConnectors, selectedIds, panels, project])
}
