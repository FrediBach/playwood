/** Shared shortcut metadata for menu hints and keyboard dispatch. */
export const previewShortcuts = {
  'Inspect selection': 'i', 'Inspect connectors': 'i', 'Inspect assembly parts': 'i',
  'Copy': 'Mod+c', 'Duplicate': 'Mod+d', 'Delete selection': 'Delete', 'Remove connectors': 'Delete',
  'Attach a panel': 'a', 'Add panel': 'n', 'Connect with a panel': 'a',
  'Add connectors between': 'Shift+a', 'Separate overlapping connectors': 'Shift+s',
  'Make sizes equal': 'e', 'Add constraint': 'Shift+c', 'Lock panel size': 'l',
  'Extend to ground': 'Shift+e', 'Disconnect panels': 'Shift+d',
  'Distribute evenly': 'Shift+r', 'Merge panels': 'm', 'Split in the middle': 'p',
  'Divide into a grid': 'Shift+g', 'Split x times': 'Shift+p', 'Auto-connect': 'c',
  'Create assembly': 'Shift+n', 'Edit assembly': 'e', 'Done editing assembly': 'Shift+e',
  'Attach a copy': 'Shift+a', 'Disconnect from neighbors': 'Shift+d',
  'Make independent': 'Shift+i', 'Disassemble': 'Shift+u', 'Select assembly': 'u',
  'Group selected': 'Shift+o', 'Select all panels': 'Mod+a', 'All constraints': 'Shift+l',
  'Fit view': 'f', 'Cycle panel visibility': 'v',
} as const

export type PreviewCommandLabel = keyof typeof previewShortcuts

export function previewShortcut(label: string): string | undefined {
  return Object.hasOwn(previewShortcuts, label) ? previewShortcuts[label as PreviewCommandLabel] : undefined
}

type Key = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing' | 'preventDefault'>
type Action = { shortcut?: string; disabled?: boolean; run: () => void }

function matches(event: Key, shortcut: string) {
  const parts = shortcut.split('+')
  const key = parts.at(-1)!.toLowerCase()
  return !event.altKey && (event.ctrlKey || event.metaKey) === parts.includes('Mod')
    && event.shiftKey === parts.includes('Shift')
    && (event.key.toLowerCase() === key || (key === 'delete' && event.key === 'Backspace'))
}

/** Multi-key hole shortcuts end in Enter so every numbered opening is addressable. */
export function createPreviewShortcutHandler() {
  let pending = ''
  let lastKeyTime = 0
  return (event: Key, actions: Action[], beforeRun: () => void = () => {}) => {
    if (event.isComposing) return false
    if (Date.now() - lastKeyTime > 2000) pending = ''
    const candidates = actions.filter(action => action.shortcut)
    const sequence = candidates.find(action => {
      const keys = action.shortcut!.split(' ')
      return keys.slice(0, -1).join(' ') === pending && matches(event, keys.at(-1)!)
    })
    if (sequence) {
      event.preventDefault()
      if (!event.repeat) { pending = ''; if (!sequence.disabled) { beforeRun(); sequence.run() } }
      return true
    }
    const prefix = candidates.map(action => action.shortcut!.split(' ')).find(keys => {
      const position = pending ? pending.split(' ').length : 0
      return keys.slice(0, position).join(' ') === pending && position < keys.length - 1 && matches(event, keys[position])
    })
    if (prefix) {
      event.preventDefault()
      if (!event.repeat) { pending = prefix.slice(0, pending ? pending.split(' ').length + 1 : 1).join(' '); lastKeyTime = Date.now() }
      return true
    }
    pending = ''
    return false
  }
}

export function shortcutLabel(shortcut: string) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return shortcut.split(' ').map(chord => chord.split('+').map(key => key === 'Mod' ? (mac ? '⌘' : 'Ctrl') : key.length === 1 ? key.toUpperCase() : key).join('+')).join(' › ')
}

export function shortcutAria(shortcut: string) {
  // ARIA represents chords, but has no syntax for a sequence.
  if (shortcut.includes(' ')) return undefined
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return shortcut.replace('Mod', mac ? 'Meta' : 'Control')
}
