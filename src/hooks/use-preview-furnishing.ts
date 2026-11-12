import { useSyncExternalStore } from 'react'
import type { FurnishingOptions } from '@/lib/preview-furnishings'
import type { FurnishingRoleChoice } from '@/lib/preview-furnishing-roles'
import type { FurnishingDensity, FurnishingTheme } from '@/lib/preview-furnishing-variation'

/**
 * Auto furnish settings for the current browser session. They are workspace
 * state, not project data: the viewport, its context menu and the GLB export
 * read the same values, and nothing here is saved or undoable.
 */
export interface PreviewFurnishingSettings {
  enabled: boolean
  /** 0 is the default arrangement; Shuffle picks another. */
  seed: number
  density: FurnishingDensity
  theme: FurnishingTheme
  /** Per-panel purpose choices from the realistic preview's context menu. */
  roles: Readonly<Record<string, FurnishingRoleChoice>>
}

export const DEFAULT_FURNISHING_SETTINGS: PreviewFurnishingSettings = { enabled: false, seed: 0, density: 'balanced', theme: 'auto', roles: {} }

let settings = DEFAULT_FURNISHING_SETTINGS
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => settings

export function updatePreviewFurnishing(update: Partial<PreviewFurnishingSettings> | ((current: PreviewFurnishingSettings) => Partial<PreviewFurnishingSettings>)) {
  const patch = typeof update === 'function' ? update(settings) : update
  const next = { ...settings, ...patch }
  if (Object.keys(next).every(key => next[key as keyof PreviewFurnishingSettings] === settings[key as keyof PreviewFurnishingSettings])) return
  settings = next
  for (const listener of listeners) listener()
}

/** A different, non-zero arrangement seed. */
export function shufflePreviewFurnishing() {
  updatePreviewFurnishing(current => {
    let seed = current.seed
    while (seed === current.seed || seed === 0) seed = 1 + Math.floor(Math.random() * 0x7ffffffe)
    return { seed }
  })
}

/** Set, or with 'auto' clear, the purpose of each surface panel. */
export function setPreviewFurnishingRole(panelIds: readonly string[], choice: FurnishingRoleChoice | 'auto') {
  updatePreviewFurnishing(current => {
    const roles = { ...current.roles }
    for (const id of panelIds) {
      if (choice === 'auto') delete roles[id]
      else roles[id] = choice
    }
    return { roles }
  })
}

export function resetPreviewFurnishing() {
  updatePreviewFurnishing({ ...DEFAULT_FURNISHING_SETTINGS, enabled: settings.enabled })
}

export function usePreviewFurnishing() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function furnishingOptions(current: PreviewFurnishingSettings, names?: FurnishingOptions['names']): FurnishingOptions {
  return { seed: current.seed, density: current.density, theme: current.theme, roles: current.roles, names }
}
