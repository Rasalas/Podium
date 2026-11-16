import { describe, expect, it } from 'vitest'
import { commandForKey, createDeduper } from '../../../src/renderer/src/lib/keys'

const k = (key: string, mods: Partial<{ ctrl: boolean, shift: boolean, alt: boolean }> = {}) =>
  ({ key, ctrl: false, shift: false, alt: false, ...mods })

describe('commandForKey', () => {
  it('maps the menu accelerators', () => {
    expect(commandForKey(k('z', { ctrl: true }))).toBe('undo')
    expect(commandForKey(k('Z', { ctrl: true, shift: true }))).toBe('redo')
    expect(commandForKey(k('y', { ctrl: true }))).toBe('redo')
    expect(commandForKey(k('d', { ctrl: true }))).toBe('duplicate-slide')
    expect(commandForKey(k('m', { ctrl: true }))).toBe('new-slide')
    expect(commandForKey(k('e', { ctrl: true }))).toBe('toggle-source')
    expect(commandForKey(k('E', { ctrl: true, shift: true }))).toBe('export-pdf')
    expect(commandForKey(k('F5'))).toBe('present')
    expect(commandForKey(k('F5', { shift: true }))).toBe('present-from-current')
  })
  it('leaves plain typing alone', () => {
    expect(commandForKey(k('z'))).toBeUndefined()
    expect(commandForKey(k('d', { ctrl: true, alt: true }))).toBeUndefined()
  })
})

describe('createDeduper', () => {
  it('drops the echo of the same command within the window', () => {
    let now = 0
    const fresh = createDeduper(60, () => now)
    expect(fresh('undo')).toBe(true)
    now = 10
    expect(fresh('undo')).toBe(false)
    expect(fresh('redo')).toBe(true)
    now = 200
    expect(fresh('redo')).toBe(true)
  })
})
