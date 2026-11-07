import { describe, expect, it, vi } from 'vitest'
import { createPreviewShortcutHandler, previewShortcuts } from './preview-shortcuts'

function key(key: string, modifiers: Partial<KeyboardEvent> = {}) {
  return { key, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, preventDefault: vi.fn(), ...modifiers }
}

describe('preview shortcuts', () => {
  it('matches exact modifiers and supports both command keys and delete aliases', () => {
    const run = vi.fn(), handle = createPreviewShortcutHandler()
    const actions = [{ shortcut: previewShortcuts.Copy, run }, { shortcut: 'Delete', run }]
    expect(handle(key('c'), actions)).toBe(false)
    expect(handle(key('c', { ctrlKey: true, shiftKey: true }), actions)).toBe(false)
    expect(handle(key('c', { ctrlKey: true }), actions)).toBe(true)
    expect(handle(key('c', { metaKey: true }), actions)).toBe(true)
    expect(handle(key('Backspace'), actions)).toBe(true)
    expect(run).toHaveBeenCalledTimes(3)
  })
  it('does not execute disabled, repeated, or composing input', () => {
    const run = vi.fn(), close = vi.fn(), handle = createPreviewShortcutHandler()
    handle(key('a'), [{ shortcut: 'a', run, disabled: true }], close)
    handle(key('a', { repeat: true }), [{ shortcut: 'a', run }], close)
    handle(key('a', { isComposing: true }), [{ shortcut: 'a', run }], close)
    expect(run).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
  it('addresses every numbered hole without prefix collisions and cancels on Escape', () => {
    const one = vi.fn(), twelve = vi.fn(), handle = createPreviewShortcutHandler()
    const actions = [{ shortcut: 'h 1 Enter', run: one }, { shortcut: 'h 1 2 Enter', run: twelve }]
    for (const value of ['h', '1', '2', 'Enter']) expect(handle(key(value), actions)).toBe(true)
    expect(twelve).toHaveBeenCalledOnce()
    expect(one).not.toHaveBeenCalled()
    for (const value of ['h', 'Escape', '1', 'Enter']) handle(key(value), actions)
    expect(one).not.toHaveBeenCalled()
    for (const value of ['h', '1', 'Enter']) handle(key(value), actions)
    expect(one).toHaveBeenCalledOnce()
  })
})
