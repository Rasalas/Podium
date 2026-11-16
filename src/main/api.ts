import type { PodiumApi, PodiumEvents } from '../shared/ipc'
import type { AddedTemplate, DeckSnapshot, Locale, RemoteInfo, RemoteMode, ServerStatus } from '../shared/types'
import type { DeckSession, SlidevServer } from './contracts'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { app, BrowserWindow, dialog, screen, shell } from 'electron'
import { createAgentService } from './agent'
import { createDeck, openDeck } from './deck'
import { createExporter } from './export'
import { createPresentationController } from './present'
import { newRemotePassword, remoteAddresses, remoteQrSvg, remoteUrl } from './remote'
import { createRuntimeManager } from './runtime'
import { createSlidevServer } from './server'
import { createRecentStore, createSettingsStore } from './stores'
import type { TemplateSource, UserTemplate } from './templates/import'
import { BUILTIN_TEMPLATE_PACKAGES, createTemplateRegistry } from './templates'
import { createTemplateStore, parseTemplateSource } from './templates/import'
import { createThumbnailer } from './thumbs'
import { createUpdater } from './update'

export type Emit = <K extends keyof PodiumEvents>(event: K, payload: PodiumEvents[K]) => void

interface OpenDeck {
  session: DeckSession
  server?: SlidevServer
  /** Path the user opened (folder or bundle), used for the recent list. */
  openedPath: string
}

const EXPORT_FILTERS: Record<'pdf' | 'pptx' | 'bundle', { name: string, extensions: string[] }> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  pptx: { name: 'PowerPoint', extensions: ['pptx'] },
  bundle: { name: 'Podium', extensions: ['podium'] },
}

export function createApi(options: { userDataDir: string, resourcesDir: string, emit: Emit }) {
  const { userDataDir, resourcesDir, emit } = options
  const settings = createSettingsStore(userDataDir)
  const recents = createRecentStore(userDataDir)
  const decks = new Map<string, OpenDeck>()

  const locale = (): Locale => {
    const chosen = settings.get().locale
    if (chosen !== 'system')
      return chosen
    return app.getLocale().toLowerCase().startsWith('de') ? 'de' : 'en'
  }

  const runtime = createRuntimeManager({
    runtimeDir: process.env.PODIUM_RUNTIME_DIR || join(userDataDir, 'runtime'),
    resourcesDir,
    seedDir: join(resourcesDir, 'runtime-seed'),
    userTemplatesDir: join(userDataDir, 'templates'),
    onProgress: event => emit('progress', event),
  })
  const templates = createTemplateRegistry({ runtime, resourcesDir, locale })
  const templateStore = createTemplateStore(join(userDataDir, 'templates'), name => BUILTIN_TEMPLATE_PACKAGES.has(name))

  const sourceLabel = (source: TemplateSource) => `${source.url.replace(/\.git$/, '')}${source.subdir ? ` (${source.subdir})` : ''}`
  async function addedTemplates(): Promise<AddedTemplate[]> {
    const known = await templates.list().catch(() => [])
    return templateStore.list().map(entry => ({
      name: entry.name,
      label: known.find(t => t.packageName === entry.name)?.label ?? entry.name,
      version: entry.version,
      source: sourceLabel(entry.source),
      fetchedAt: entry.fetchedAt,
    }))
  }
  /** Put a fetched template into the runtime. A template that cannot be set up does not stay behind half-installed. */
  async function installAdded(entry: UserTemplate, isNew: boolean): Promise<AddedTemplate> {
    try {
      await runtime.syncUserTemplates()
    }
    catch (error) {
      if (isNew) {
        templateStore.remove(entry.name)
        await runtime.removeTemplate(entry.name).catch(() => {})
      }
      throw error
    }
    return (await addedTemplates()).find(t => t.name === entry.name)!
  }
  const thumbnailer = createThumbnailer({
    onThumbnail(event) {
      emit('thumbnail', event)
      const deck = decks.get(event.deckId)
      if (deck && event.no === 1) {
        const snapshot = deck.session.snapshot()
        recents.touch({ path: deck.openedPath, title: snapshot.title, theme: snapshot.theme, thumbnail: event.dataUrl })
      }
    },
  })
  const presentation = createPresentationController({
    onState: state => emit('present:state', state),
    locale,
    deckInfo: (deckId) => {
      const snapshot = decks.get(deckId)?.session.snapshot()
      return snapshot && { title: snapshot.title, canvas: snapshot.canvas }
    },
  })
  const exporter = createExporter({ runtime, onProgress: event => emit('progress', event) })
  const updater = createUpdater({
    userDataDir,
    onState: state => emit('update:state', state),
    automatic: () => settings.get().autoUpdate !== false,
    busy: () => presentation.state().active,
  })
  const agent = createAgentService({ settings: settings.get, onEvent: event => emit('agent', event) })

  const deckOptions = {
    workDir: join(userDataDir, 'bundles'),
    onChange(snapshot: DeckSnapshot) {
      emit('deck:changed', snapshot)
      const server = decks.get(snapshot.deckId)?.server?.status()
      if (server?.state === 'ready' && server.url)
        void thumbnailer.request(snapshot, server.url).catch(() => {})
    },
  }

  function need(deckId: string): OpenDeck {
    const deck = decks.get(deckId)
    if (!deck)
      throw new Error(`Deck ${deckId} is not open`)
    return deck
  }

  function readyUrl(deckId: string): string {
    const status = need(deckId).server?.status()
    if (status?.state !== 'ready' || !status.url)
      throw new Error('The preview is not running yet')
    return status.url
  }

  async function register(session: DeckSession, openedPath: string) {
    decks.set(session.deckId, { session, openedPath })
    const snapshot = session.snapshot()
    recents.touch({ path: openedPath, title: snapshot.title, theme: snapshot.theme })
    const missingPackages = (await runtime.requirementsFor(snapshot)).filter(p => !p.installed)
    return { snapshot, missingPackages }
  }

  // --- phone remote ----------------------------------------------------------

  /** Remote-mode password of a deck's server while the phone remote is on. */
  const passwordOf = (deckId: string) => decks.get(deckId)?.server?.remote()?.password

  function remoteInfo(deckId: string): RemoteInfo {
    const deck = need(deckId)
    const config = deck.server?.remote()
    const addresses = remoteAddresses()
    const info: RemoteInfo = { mode: config?.allow ?? 'off', tailscaleAddress: addresses.tailscale, lanAddresses: addresses.lan }
    const port = deck.server?.status().port
    const address = config?.allow === 'tailscale' ? addresses.tailscale : (addresses.lan[0] ?? addresses.tailscale)
    if (config && port && address) {
      info.url = remoteUrl(address, port, config.password)
      info.qrSvg = remoteQrSvg(info.url)
    }
    return info
  }

  async function setRemote(deckId: string, mode: RemoteMode): Promise<RemoteInfo> {
    if (mode !== 'off' && mode !== 'tailscale' && mode !== 'lan')
      throw new Error(`Unknown remote mode: ${String(mode)}`)
    const server = serverFor(deckId)
    if (mode === 'off' && !server.remote())
      return remoteInfo(deckId)
    if (mode === 'tailscale' && !remoteAddresses().tailscale) {
      throw new Error(locale() === 'de'
        ? 'Tailscale läuft auf diesem Computer nicht.'
        : 'Tailscale is not running on this computer.')
    }
    const before = presentation.state()
    const presenting = before.active && before.deckId === deckId
    const status = await server.setRemote(mode === 'off' ? undefined : { password: newRemotePassword(), allow: mode })
    // The restart took the presentation's server away for a moment; put both windows back where they were.
    if (presenting && status.state === 'ready' && status.url && presentation.state().deckId === deckId)
      await presentation.reload(status.url, passwordOf(deckId), before.position)
    return remoteInfo(deckId)
  }

  function serverFor(deckId: string): SlidevServer {
    const deck = need(deckId)
    deck.server ??= createSlidevServer({
      deckId,
      entry: deck.session.snapshot().entry,
      runtime,
      bridgeClientPath: join(resourcesDir, 'launcher', 'bridge-client.js'),
      onStatus(status: ServerStatus) {
        emit('server:status', status)
        if (status.state === 'ready' && status.url)
          void thumbnailer.request(deck.session.snapshot(), status.url).catch(() => {})
      },
    })
    return deck.server
  }

  async function closeDeck(deckId: string) {
    const deck = decks.get(deckId)
    if (!deck)
      return
    decks.delete(deckId)
    if (presentation.state().deckId === deckId)
      await presentation.stop()
    thumbnailer.release(deckId)
    await agent.stop(deckId).catch(() => {})
    await deck.server?.stop().catch(() => {})
    removeSlidevScratch(deck.session.snapshot().dir)
    await deck.session.close()
  }

  /** Slidev drops a node_modules/.slidev cache into the deck folder. Remove it if nothing else lives there. */
  function removeSlidevScratch(deckDir: string) {
    const modules = join(deckDir, 'node_modules')
    try {
      if (readdirSync(modules).every(name => name === '.slidev' || name === '.vite'))
        rmSync(modules, { recursive: true, force: true })
    }
    catch {}
  }

  const api: PodiumApi = {
    async getAppInfo() {
      const defaultDeckDir = process.env.PODIUM_DECK_DIR || join(app.getPath('documents'), 'Podium')
      return { version: app.getVersion(), platform: process.platform, locale: locale(), userDataDir, defaultDeckDir }
    },
    getSettings: async () => settings.get(),
    setSettings: async patch => settings.set(patch),
    getRecentDecks: async () => recents.list(),
    removeRecentDeck: async path => recents.remove(path),
    async pickFolder(title, defaultPath) {
      if (defaultPath)
        mkdirSync(defaultPath, { recursive: true })
      const result = await dialog.showOpenDialog({ title, defaultPath, properties: ['openDirectory', 'createDirectory'] })
      return result.canceled ? undefined : result.filePaths[0]
    },
    async openExternal(url) {
      if (/^https?:\/\//.test(url))
        await shell.openExternal(url)
    },
    showInFolder: async path => shell.showItemInFolder(path),

    getRuntimeStatus: () => runtime.status(),
    ensureRuntime: () => runtime.ensure(),
    listInstalledPackages: () => runtime.listInstalled(),
    resolvePackage: (raw, kind) => runtime.resolve(raw, kind),
    installPackages: names => runtime.install(names),

    async listTemplates() {
      const added = new Set(templateStore.list().map(t => t.name))
      return (await templates.list()).map(t => added.has(t.packageName) ? { ...t, added: true } : t)
    },
    async addTemplate(source, subdir) {
      const parsed = parseTemplateSource(source, subdir)
      const isNew = !templateStore.list().some(t => sourceLabel(t.source) === sourceLabel(parsed))
      return installAdded(await templateStore.add(parsed), isNew)
    },
    listAddedTemplates: () => addedTemplates(),
    refreshTemplate: async name => installAdded(await templateStore.refresh(name), false),
    async removeTemplate(name) {
      templateStore.remove(name)
      await runtime.removeTemplate(name)
    },
    getLayouts: deckId => templates.layoutsFor(need(deckId).session.snapshot()),

    async newDeck(newOptions) {
      const starter = await templates.starter(newOptions)
      const session = await createDeck(newOptions, starter, deckOptions)
      return register(session, session.snapshot().dir)
    },
    async openDeckDialog() {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Podium / Slidev', extensions: ['podium', 'md'] },
        ],
      })
      if (result.canceled || !result.filePaths[0])
        return undefined
      return api.openDeck(result.filePaths[0])
    },
    async openDeck(path) {
      // A markdown file inside a deck folder opens that folder, a .podium file opens as bundle.
      const openedPath = extname(path) === '.md' && basename(path) === 'slides.md' ? dirname(path) : path
      for (const deck of decks.values()) {
        if (deck.openedPath === openedPath)
          return { snapshot: deck.session.snapshot(), missingPackages: [] }
      }
      const session = await openDeck(path, deckOptions)
      return register(session, openedPath)
    },
    closeDeck,
    getDeck: async deckId => need(deckId).session.snapshot(),

    applyOp: (deckId, op) => need(deckId).session.apply(op),
    undo: deckId => need(deckId).session.undo(),
    redo: deckId => need(deckId).session.redo(),
    async importImage(deckId, sourcePath) {
      let source = sourcePath
      if (!source) {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }],
        })
        if (result.canceled)
          return undefined
        source = result.filePaths[0]
      }
      return source ? need(deckId).session.importAsset(source) : undefined
    },
    importImageData: (deckId, fileName, data) => need(deckId).session.importAssetData(fileName, data),

    startServer: deckId => serverFor(deckId).start(),
    restartServer: deckId => serverFor(deckId).restart(),
    getServerStatus: async deckId => need(deckId).server?.status() ?? { deckId, state: 'stopped' },

    requestThumbnails: (deckId, nos) => thumbnailer.request(need(deckId).session.snapshot(), readyUrl(deckId), nos),
    checkDeck: deckId => thumbnailer.check(need(deckId).session.snapshot(), readyUrl(deckId), locale()),

    getDisplays: async () => presentation.displays(),
    startPresentation: (deckId, presentOptions) => presentation.start(deckId, readyUrl(deckId), {
      audienceDisplayId: settings.get().audienceDisplayId,
      ...presentOptions,
    }, passwordOf(deckId)),
    swapPresentationDisplays: () => presentation.swapDisplays(),
    stopPresentation: () => presentation.stop(),
    getPresentationState: async () => presentation.state(),

    getRemoteInfo: async deckId => remoteInfo(deckId),
    setRemote,

    async exportDeck(deckId, format) {
      const deck = need(deckId)
      const snapshot = deck.session.snapshot()
      const baseName = basename(snapshot.bundlePath ?? snapshot.dir, '.podium')
      const defaultDir = app.getPath('documents')
      // Tests export without the system's save dialog.
      const fixedDir = process.env.PODIUM_EXPORT_DIR
      if (fixedDir) {
        const name = format === 'web' || format === 'png' ? `${baseName}-${format}` : `${baseName}.${EXPORT_FILTERS[format].extensions[0]}`
        const target = join(fixedDir, name)
        if (format === 'bundle') {
          await deck.session.exportBundle(target)
          return { path: target }
        }
        return exporter.run(snapshot, readyUrl(deckId), format, target, passwordOf(deckId))
      }
      if (format === 'web' || format === 'png') {
        const result = await dialog.showOpenDialog({
          defaultPath: defaultDir,
          properties: ['openDirectory', 'createDirectory'],
        })
        if (result.canceled || !result.filePaths[0])
          return {}
        const target = join(result.filePaths[0], `${baseName}-${format}`)
        return exporter.run(snapshot, readyUrl(deckId), format, target, passwordOf(deckId))
      }
      const filter = EXPORT_FILTERS[format]
      const result = await dialog.showSaveDialog({
        defaultPath: join(defaultDir, `${baseName}.${filter.extensions[0]}`),
        filters: [filter],
      })
      if (result.canceled || !result.filePath)
        return {}
      if (format === 'bundle') {
        await deck.session.exportBundle(result.filePath)
        return { path: result.filePath }
      }
      return exporter.run(snapshot, readyUrl(deckId), format, result.filePath, passwordOf(deckId))
    },

    getUpdateState: async () => updater.state(),
    checkForUpdates: () => updater.check(true),
    installUpdate: async () => updater.installNow(),

    getAgentInfo: deckId => agent.info(need(deckId).session.snapshot(), need(deckId).server?.status()),
    async writeAgentsFile(deckId) {
      const deck = need(deckId)
      await deck.session.writeFile('AGENTS.md', await templates.agentsFile(deck.session.snapshot()))
    },
    agentSend: (deckId, prompt) => agent.send(need(deckId).session.snapshot(), prompt),
    agentStop: deckId => agent.stop(deckId),
  }

  return {
    api,
    locale,
    updater,
    displays: () => screen.getAllDisplays(),
    async shutdown() {
      await presentation.stop().catch(() => {})
      await Promise.all([...decks.keys()].map(id => closeDeck(id).catch(() => {})))
    },
    focusedWindow: () => BrowserWindow.getFocusedWindow(),
  }
}
