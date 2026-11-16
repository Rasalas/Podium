// App-level actions shared by the toolbar, menus, keyboard shortcuts and the canvas.
import type { MenuCommand } from '@shared/ipc'
import type { BlockKind, ExportFormat, ProgressEvent } from '@shared/types'
import type { BridgeHost } from './lib/bridgeHost'
import type { KeyInfo } from './lib/keys'
import { redo as cmRedo, undo as cmUndo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { api } from './api'
import { t } from './i18n'
import { commandForKey, createDeduper, isTextTarget } from './lib/keys'
import { useAppStore } from './stores/app'
import { useDeckStore } from './stores/deck'
import { useUiStore } from './stores/ui'

/** The canvas registers its bridge host here so shortcuts can end an edit in the frame. */
export const canvas: { host: BridgeHost | null, focusFrame?: () => void } = { host: null }

const fresh = createDeduper(60)

function textUndo(which: 'undo' | 'redo'): boolean {
  const el = document.activeElement
  if (!isTextTarget(el))
    return false
  const cm = el?.closest('.cm-editor')
  if (cm) {
    const view = EditorView.findFromDOM(cm as HTMLElement)
    if (view) {
      ;(which === 'undo' ? cmUndo : cmRedo)(view)
      return true
    }
  }
  // Inputs and textareas keep their own history; execCommand reaches it when the menu ate the key.
  document.execCommand(which)
  return true
}

export function deckUndo(which: 'undo' | 'redo') {
  const deck = useDeckStore()
  if (deck.canvasEditing) {
    // Typing in the slide: drop the unfinished edit, the file is unchanged until commit.
    canvas.host?.send({ type: 'endEdit', commit: false })
    return
  }
  void (which === 'undo' ? deck.undo() : deck.redo())
}

export async function present(fromCurrent: boolean, audienceDisplayId?: number, windowed = false) {
  const deck = useDeckStore()
  const ui = useUiStore()
  const app = useAppStore()
  const id = deck.deckId
  if (!id)
    return
  if (!deck.serverReady) {
    ui.toast({ kind: 'info', message: t('present.notReady') })
    return
  }
  const state = await ui.attempt(() => api().startPresentation(id, {
    from: fromCurrent ? deck.currentNo : 1,
    audienceDisplayId: audienceDisplayId ?? app.settings?.audienceDisplayId,
    ...(windowed ? { windowed: true } : {}),
  }))
  if (state)
    deck.presentation = state
}

let exportToast: number | undefined

export async function exportAs(format: ExportFormat) {
  const deck = useDeckStore()
  const ui = useUiStore()
  const id = deck.deckId
  if (!id || exportToast)
    return
  exportToast = ui.toast({ kind: 'progress', message: t('editor.exporting') })
  try {
    const result = await api().exportDeck(id, format)
    if (exportToast)
      ui.dismiss(exportToast)
    if (result.path) {
      const path = result.path
      ui.toast({
        kind: 'success',
        message: t('editor.exported'),
        detail: path,
        action: { label: t('common.showInFolder'), run: () => void ui.attempt(() => api().showInFolder(path)) },
        timeout: 8000,
      })
    }
  }
  catch (err) {
    if (exportToast)
      ui.dismiss(exportToast)
    ui.error(err)
  }
  finally {
    exportToast = undefined
  }
}

export function onExportProgress(event: ProgressEvent) {
  if (!exportToast)
    return
  const ui = useUiStore()
  const pct = event.fraction !== undefined ? ` ${Math.round(event.fraction * 100)} %` : ''
  ui.update(exportToast, { message: `${t('editor.exporting')}${pct}`, detail: event.message })
}

export function openCheck() {
  const ui = useUiStore()
  const deck = useDeckStore()
  ui.checkOpen = true
  void deck.runCheck()
}

export function runCommand(command: MenuCommand) {
  if (!fresh(command))
    return
  const app = useAppStore()
  const deck = useDeckStore()
  const ui = useUiStore()
  const inEditor = app.view === 'editor' && Boolean(deck.deckId)
  switch (command) {
    case 'new-deck':
      if (app.view === 'start' || app.view === 'editor')
        ui.newDeckOpen = true
      return
    case 'open-deck':
      if (app.view === 'start' || app.view === 'editor')
        void app.openDialog()
      return
    case 'settings':
      ui.settingsOpen = true
      return
    case 'undo':
    case 'redo':
      if (!textUndo(command) && inEditor)
        deckUndo(command)
      return
  }
  if (!inEditor)
    return
  switch (command) {
    case 'close-deck': void app.closeCurrent(); break
    case 'new-slide': void deck.newSlide(); break
    case 'duplicate-slide': void deck.duplicate(); break
    case 'delete-slide': void deck.removeSelected(); break
    case 'present': void present(false); break
    case 'present-from-current': void present(true); break
    case 'toggle-source': ui.sourceOpen = !ui.sourceOpen; break
    case 'toggle-notes': ui.notesOpen = !ui.notesOpen; break
    case 'toggle-agent': ui.toggleAgent(); break
    case 'export-pdf': void exportAs('pdf'); break
    case 'export-bundle': void exportAs('bundle'); break
    case 'check-deck': openCheck(); break
  }
}

/** Keys in the window. Returns true when handled (caller prevents the default). */
export function handleKey(k: KeyInfo, target: Element | null): boolean {
  const command = commandForKey(k)
  if (!command)
    return false
  // Text fields handle their own undo/redo natively.
  if ((command === 'undo' || command === 'redo') && isTextTarget(target)) {
    // Mark it as handled so a menu echo of the same key does not undo a second time.
    fresh(command)
    return false
  }
  runCommand(command)
  return true
}

/** Keys forwarded from the canvas frame while no block is being edited. */
export function handleFrameShortcut(k: KeyInfo) {
  const deck = useDeckStore()
  if (!k.ctrl && !k.alt) {
    const delta = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[k.key]
    if (delta) {
      deck.select(Math.min(Math.max(deck.currentNo + delta, 1), deck.slides.length))
      return
    }
    if (k.key === 'Home' || k.key === 'End') {
      deck.select(k.key === 'Home' ? 1 : deck.slides.length)
      return
    }
  }
  const command = commandForKey(k)
  if (command)
    runCommand(command)
}

/** Insert a block on the current slide; text blocks get the caret with the placeholder selected. */
export async function insertBlock(kind: BlockKind) {
  const deck = useDeckStore()
  const ui = useUiStore()
  const id = deck.deckId
  if (!id || !deck.current)
    return
  let src: string | undefined
  if (kind === 'image') {
    src = await ui.attempt(() => api().importImage(id))
    if (!src)
      return
  }
  const result = await deck.insertBlock(kind, src)
  if (result?.focusBlock)
    canvas.host?.focusBlock(result.focusBlock, true)
}

export function format(command: 'bold' | 'italic' | 'code' | 'link' | 'clear', value?: string) {
  canvas.host?.send({ type: 'format', command, value })
  canvas.focusFrame?.()
}

let templateChange = false

/** Switch the deck's template; installs it first (with the usual consent) when needed. */
export async function changeTemplate(id: string) {
  const deck = useDeckStore()
  const app = useAppStore()
  const ui = useUiStore()
  const deckId = deck.deckId
  if (!deckId || templateChange || deck.snapshot?.theme === id)
    return
  templateChange = true
  try {
    const pkg = await ui.attempt(() => api().resolvePackage(id, 'theme'))
    if (!pkg)
      return
    const needsInstall = !pkg.installed
    if (needsInstall && !(await app.ensurePackages([pkg])))
      return
    const result = await deck.apply({ type: 'setHeadmatter', patch: { theme: id } })
    if (result && needsInstall) {
      const status = await ui.attempt(() => api().restartServer(deckId))
      if (status)
        deck.acceptServer(status)
      void app.loadTemplates()
    }
  }
  finally {
    templateChange = false
  }
}
