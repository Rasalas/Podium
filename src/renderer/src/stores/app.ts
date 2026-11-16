import type { AppInfo, DeckOpenResult, NewDeckOptions, PackageRequest, ProgressEvent, RecentDeck, RuntimeStatus, Settings, TemplateInfo } from '@shared/types'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, errorMessage } from '../api'
import { platform, setLocale, t } from '../i18n'
import { useDeckStore } from './deck'
import { useUiStore } from './ui'

export type View = 'boot' | 'setup' | 'start' | 'editor'

interface PackagePrompt {
  packages: PackageRequest[]
  resolve: (ok: boolean) => void
}

function systemLocale(): 'de' | 'en' {
  return (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('de')) ? 'de' : 'en'
}

export const useAppStore = defineStore('app', () => {
  const ui = useUiStore()
  const view = ref<View>('boot')
  const info = ref<AppInfo>()
  const settings = ref<Settings>()
  const runtime = ref<RuntimeStatus>()
  const runtimeProgress = ref<ProgressEvent>()
  const runtimeError = ref<string>()
  const recents = ref<RecentDeck[]>([])
  const templates = ref<TemplateInfo[]>([])
  /** Set while a deck is being opened or created, for the start screen spinner. */
  const opening = ref(false)
  const packagePrompt = ref<PackagePrompt>()
  /** Packages being installed right now (progress view). */
  const installing = ref<string[]>()
  const packageProgress = ref<ProgressEvent>()

  function applyLocale() {
    const chosen = settings.value?.locale
    setLocale(chosen && chosen !== 'system' ? chosen : (info.value?.locale ?? systemLocale()))
  }

  async function boot() {
    try {
      const [appInfo, appSettings, status] = await Promise.all([api().getAppInfo(), api().getSettings(), api().getRuntimeStatus()])
      info.value = appInfo
      platform.value = appInfo.platform
      settings.value = appSettings
      runtime.value = status
      applyLocale()
      if (status.state === 'ready') {
        await enterStart()
      }
      else {
        view.value = 'setup'
        void setupRuntime()
      }
    }
    catch (err) {
      // Without app info there is nothing to show; fall back to the start screen with an error.
      ui.error(err)
      view.value = 'start'
    }
  }

  async function setupRuntime() {
    runtimeError.value = undefined
    runtimeProgress.value = undefined
    try {
      runtime.value = await api().ensureRuntime()
      if (runtime.value.state === 'ready')
        await enterStart()
      else
        runtimeError.value = runtime.value.error ?? t('setup.failed')
    }
    catch (err) {
      runtimeError.value = errorMessage(err)
    }
  }

  function onProgress(event: ProgressEvent) {
    if (event.scope === 'runtime') {
      runtimeProgress.value = event
      if (event.error)
        runtimeError.value = event.error
    }
    else if (event.scope === 'packages') {
      packageProgress.value = event
    }
  }

  async function enterStart() {
    view.value = 'start'
    await refreshRecents()
  }

  async function refreshRecents() {
    const list = await ui.attempt(() => api().getRecentDecks())
    if (list)
      recents.value = list
  }

  async function loadTemplates() {
    const list = await ui.attempt(() => api().listTemplates())
    if (list)
      templates.value = list
    return templates.value
  }

  async function removeRecent(path: string) {
    const list = await ui.attempt(() => api().removeRecentDeck(path))
    if (list)
      recents.value = list
  }

  async function saveSettings(patch: Partial<Settings>) {
    const next = await ui.attempt(() => api().setSettings(patch))
    if (next) {
      settings.value = next
      applyLocale()
    }
  }

  /** Ask (or not) and install packages. Resolves false when the user declines or installation fails. */
  async function ensurePackages(packages: PackageRequest[]): Promise<boolean> {
    const missing = packages.filter(p => !p.installed)
    if (!missing.length)
      return true
    const silent = missing.every(p => p.trusted) && settings.value?.autoInstallTrusted
    if (!silent) {
      const ok = await new Promise<boolean>((resolve) => {
        packagePrompt.value = { packages: missing, resolve }
      })
      packagePrompt.value = undefined
      if (!ok)
        return false
    }
    installing.value = missing.map(p => p.name)
    packageProgress.value = undefined
    try {
      await api().installPackages(missing.map(p => p.name))
      return true
    }
    catch (err) {
      ui.error(err, t('common.error'))
      return false
    }
    finally {
      installing.value = undefined
    }
  }

  function answerPackagePrompt(ok: boolean) {
    packagePrompt.value?.resolve(ok)
  }

  /** Shared tail of opening and creating: packages, then editor, then server. */
  async function enterDeck(result: DeckOpenResult) {
    const deck = useDeckStore()
    if (!(await ensurePackages(result.missingPackages))) {
      ui.toast({ kind: 'info', message: t('packages.cancelled') })
      await api().closeDeck(result.snapshot.deckId).catch(() => {})
      await refreshRecents()
      return
    }
    deck.load(result.snapshot)
    view.value = 'editor'
    const deckId = result.snapshot.deckId
    deck.server = { deckId, state: 'starting' }
    const status = await ui.attempt(() => api().startServer(deckId))
    if (status)
      deck.acceptServer(status)
    else
      deck.server = { deckId, state: 'error', error: t('canvas.failed') }
  }

  async function withOpening(fn: () => Promise<DeckOpenResult | undefined>) {
    if (opening.value)
      return
    opening.value = true
    try {
      const result = await fn()
      if (result) {
        await closeCurrent(false)
        await enterDeck(result)
      }
    }
    catch (err) {
      ui.error(err, t('common.error'))
      await refreshRecents()
    }
    finally {
      opening.value = false
    }
  }

  const openPath = (path: string) => withOpening(() => api().openDeck(path))
  const openDialog = () => withOpening(() => api().openDeckDialog())
  const createDeck = (options: NewDeckOptions) => withOpening(() => api().newDeck(options))

  async function closeCurrent(goToStart = true) {
    const deck = useDeckStore()
    const id = deck.deckId
    if (id) {
      if (deck.presentation.active && deck.presentation.deckId === id)
        await api().stopPresentation().catch(() => {})
      await ui.attempt(() => api().closeDeck(id))
      deck.reset()
    }
    if (goToStart) {
      view.value = 'start'
      await refreshRecents()
    }
  }

  return {
    view,
    info,
    settings,
    runtime,
    runtimeProgress,
    runtimeError,
    recents,
    templates,
    opening,
    packagePrompt,
    installing,
    packageProgress,
    boot,
    setupRuntime,
    onProgress,
    refreshRecents,
    loadTemplates,
    removeRecent,
    saveSettings,
    ensurePackages,
    answerPackagePrompt,
    openPath,
    openDialog,
    createDeck,
    closeCurrent,
  }
})
