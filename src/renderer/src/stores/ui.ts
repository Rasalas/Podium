import type { RemoteInfo } from '@shared/types'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { errorMessage } from '../api'
import { t } from '../i18n'

export interface Toast {
  id: number
  kind: 'error' | 'info' | 'success' | 'progress'
  /** A new toast with the same key replaces the old one instead of stacking. */
  key?: string
  message: string
  detail?: string
  action?: { label: string, run: () => void }
  /** ms until it hides by itself; 0 = stays until closed. */
  timeout: number
}

export type RightPanel = 'inspector' | 'agent'

let toastId = 0

const NOTES_HEIGHT_KEY = 'podium.notesHeight'
function storedNotesHeight(): number | undefined {
  try {
    const value = Number(localStorage.getItem(NOTES_HEIGHT_KEY))
    return Number.isFinite(value) && value >= 60 ? value : undefined
  }
  catch {
    return undefined
  }
}

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const rightPanel = ref<RightPanel>('inspector')
  /** User closed the right column (also the default on small windows). */
  const rightCollapsed = ref(false)
  const sourceOpen = ref(false)
  const notesOpen = ref(true)
  /** Height of the notes panel as the user dragged it, in px. Undefined = the default. Kept across sessions. */
  const notesHeight = ref<number | undefined>(storedNotesHeight())
  function setNotesHeight(height: number | undefined) {
    notesHeight.value = height === undefined ? undefined : Math.round(height)
    try {
      if (height === undefined)
        localStorage.removeItem(NOTES_HEIGHT_KEY)
      else
        localStorage.setItem(NOTES_HEIGHT_KEY, String(Math.round(height)))
    }
    catch {
      // Storage can be unavailable; the height then lasts for this session.
    }
  }
  const settingsOpen = ref(false)
  const addTemplateOpen = ref(false)
  /** Package name of the template added last, so the new-deck dialog can select it. */
  const lastAddedTemplate = ref<string>()
  const newDeckOpen = ref(false)
  const checkOpen = ref(false)
  const remoteOpen = ref(false)
  /** Phone remote of the open deck, for the toolbar indicator. Loaded with the editor. */
  const remote = ref<RemoteInfo>()
  /** Layout picker: 'new' inserts a slide, 'change' sets the current slide's layout. */
  const layoutPicker = ref<null | 'new' | 'change'>(null)
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  function dismiss(id: number) {
    toasts.value = toasts.value.filter(toast => toast.id !== id)
    clearTimeout(timers.get(id))
    timers.delete(id)
  }

  function toast(input: Omit<Toast, 'id' | 'timeout'> & { timeout?: number }): number {
    const id = ++toastId
    const timeout = input.timeout ?? (input.kind === 'error' ? 9000 : input.kind === 'progress' ? 0 : 4500)
    if (input.key) {
      for (const old of toasts.value.filter(item => item.key === input.key)) dismiss(old.id)
    }
    toasts.value = [...toasts.value.slice(-3), { ...input, id, timeout }]
    if (timeout > 0)
      timers.set(id, setTimeout(() => dismiss(id), timeout))
    return id
  }

  function update(id: number, patch: Partial<Omit<Toast, 'id'>>) {
    const existing = toasts.value.find(item => item.id === id)
    if (!existing)
      return
    Object.assign(existing, patch)
    if (patch.timeout) {
      clearTimeout(timers.get(id))
      timers.set(id, setTimeout(() => dismiss(id), patch.timeout))
    }
  }

  function error(err: unknown, context?: string) {
    const message = errorMessage(err)
    console.error(context ?? 'Podium', err)
    return toast({ kind: 'error', message: context ?? t('common.error'), detail: message })
  }

  /** Run an API call; failures become a toast and resolve to undefined. */
  async function attempt<T>(fn: () => Promise<T>, context?: string): Promise<T | undefined> {
    try {
      return await fn()
    }
    catch (err) {
      error(err, context)
      return undefined
    }
  }

  function showRight(panel: RightPanel) {
    rightPanel.value = panel
    rightCollapsed.value = false
  }

  function toggleAgent() {
    if (rightPanel.value === 'agent' && !rightCollapsed.value)
      rightPanel.value = 'inspector'
    else
      showRight('agent')
  }

  return {
    toasts,
    rightPanel,
    rightCollapsed,
    sourceOpen,
    notesOpen,
    notesHeight,
    setNotesHeight,
    settingsOpen,
    addTemplateOpen,
    lastAddedTemplate,
    newDeckOpen,
    checkOpen,
    remoteOpen,
    remote,
    layoutPicker,
    toast,
    update,
    dismiss,
    error,
    attempt,
    showRight,
    toggleAgent,
  }
})
