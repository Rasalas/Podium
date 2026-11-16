// Where the app's own renderer lives. Shared by the main window (index.ts) and the
// presenter view window (present/), kept apart from both to avoid an import cycle.
import type { BrowserWindow } from 'electron'
import { join } from 'node:path'

/** Preload script that exposes `window.podium`. */
export const PRELOAD_PATH = join(import.meta.dirname, '../preload/index.cjs')

/** Load the renderer into a window. `hash` selects a view, e.g. "presenter?deckId=abc". */
export function loadRenderer(window: BrowserWindow, hash = ''): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL)
    return window.loadURL(hash ? `${process.env.ELECTRON_RENDERER_URL}#${hash}` : process.env.ELECTRON_RENDERER_URL)
  return window.loadFile(join(import.meta.dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}
