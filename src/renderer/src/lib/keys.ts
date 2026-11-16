import type { MenuCommand } from '@shared/ipc'

export interface KeyInfo {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

/** Keyboard equivalents of the application menu (see src/main/menu.ts). */
export function commandForKey(k: KeyInfo): MenuCommand | undefined {
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key
  if (key === 'F5')
    return k.shift ? 'present-from-current' : 'present'
  if (!k.ctrl || k.alt)
    return undefined
  if (k.shift) {
    switch (key) {
      case 'z': return 'redo'
      case 'e': return 'export-pdf'
      default: return undefined
    }
  }
  switch (key) {
    case 'z': return 'undo'
    case 'y': return 'redo'
    case 'n': return 'new-deck'
    case 'o': return 'open-deck'
    case 'w': return 'close-deck'
    case ',': return 'settings'
    case 'm': return 'new-slide'
    case 'd': return 'duplicate-slide'
    case 'e': return 'toggle-source'
    case 'j': return 'toggle-agent'
    default: return undefined
  }
}

/**
 * The same command can arrive twice: once as a keydown in the window and once as a menu
 * event from the accelerator. Remember the last one briefly and drop the echo.
 */
export function createDeduper(windowMs = 150, now: () => number = () => Date.now()) {
  let last: { command: string, at: number } | undefined
  return (command: string): boolean => {
    const at = now()
    if (last && last.command === command && at - last.at < windowMs)
      return false
    last = { command, at }
    return true
  }
}

/** Is focus somewhere that has its own undo history (input, textarea, contenteditable, CodeMirror)? */
export function isTextTarget(el: Element | null): boolean {
  if (!el)
    return false
  const tag = el.tagName
  if (tag === 'TEXTAREA')
    return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return ['text', 'search', 'url', 'email', 'number', 'password', ''].includes(type)
  }
  return (el as HTMLElement).isContentEditable || Boolean(el.closest?.('.cm-editor'))
}
