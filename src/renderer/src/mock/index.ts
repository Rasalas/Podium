// Mock backend: lets the renderer run in a plain browser without Electron.
// Query parameters tweak the scenario, e.g. ?mockRuntime=missing, ?mockRuntime=error,
// ?mockRecents=0, ?mockAgent=none, ?mockServer=error, ?mockDisplays=1, ?mockTailscale=0.
import type { PodiumBridge, PodiumEvents } from '@shared/ipc'
import type {
  AgentInfo,
  DeckOpenResult,
  DisplayInfo,
  LayoutInfo,
  PackageRequest,
  PresentPosition,
  PresentationState,
  RecentDeck,
  RemoteInfo,
  RemoteMode,
  RuntimeStatus,
  ServerStatus,
  Settings,
  SlideCheck,
  TemplateInfo,
  UpdateState,
} from '@shared/types'
import { MockDeck } from './deck'
import { MOCK_LAYOUTS, sampleDeck } from './data'
import { colorsFor, drawThumbnail, renderSlideHtml } from './render'

type Listener = (payload: never) => void

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export interface MockControl {
  render: (no: number) => { html: string, colors: { background: string, foreground: string, accent: string }, canvas: { width: number, height: number }, total: number } | undefined
  subscribe: (cb: () => void) => () => void
}

function mockUpdate(): UpdateState {
  const wanted = params.get('mockUpdate')
  const status = wanted === 'ready' || wanted === 'available' ? wanted : 'idle'
  return {
    status,
    currentVersion: '0.2.0',
    version: status === 'idle' ? undefined : '0.3.0',
    releaseUrl: status === 'idle' ? undefined : 'https://github.com/Rasalas/Podium/releases/tag/v0.3.0',
    downloadUrl: status === 'available' ? 'https://github.com/Rasalas/Podium/releases/latest' : undefined,
  }
}

export function createMockBridge(): PodiumBridge & { __mock: true } {
  const listeners = new Map<string, Set<Listener>>()
  const emit = <K extends keyof PodiumEvents>(event: K, payload: PodiumEvents[K]) => {
    for (const l of listeners.get(event) ?? []) (l as (p: PodiumEvents[K]) => void)(payload)
  }
  const frameSubscribers = new Set<() => void>()

  let runtime: RuntimeStatus = {
    state: params.get('mockRuntime') === 'missing' || params.get('mockRuntime') === 'error' ? 'missing' : 'ready',
    dir: '/home/anna/.config/Podium/runtime',
    slidevVersion: '53.1.0',
  }
  let runtimeFailOnce = params.get('mockRuntime') === 'error'
  let settings: Settings = { locale: 'system', agentPreset: 'claude', agentCommand: 'claude -p {prompt}', autoInstallTrusted: true, autoUpdate: true }
  const installed = new Set(['@slidev/theme-default', 'slidev-theme-klar'])
  const decks = new Map<string, { deck: MockDeck, server: ServerStatus, rendered: Map<string, string> }>()
  let deckCounter = 0
  let imageCounter = 0
  let agentTimer: ReturnType<typeof setTimeout> | undefined
  const now = Date.now()

  let recents: RecentDeck[] = params.get('mockRecents') === '0'
    ? []
    : [
        { path: '/home/anna/Dokumente/Podium/Jahresrückblick Wanderverein', title: 'Jahresrückblick Wanderverein', theme: 'klar', lastOpened: now - 3_600_000, exists: true },
        { path: '/home/anna/Dokumente/Podium/Omas 80. Geburtstag', title: 'Omas 80. Geburtstag', theme: 'seriph', lastOpened: now - 86_400_000 - 7_200_000, exists: true },
        { path: '/home/anna/Dokumente/Podium/Gartenplanung', title: 'Gartenplanung Frühjahr', theme: 'default', lastOpened: now - 9 * 86_400_000, exists: true },
        { path: '/media/usb/Vortrag Schule', title: 'Vortrag Schule', theme: 'klar', lastOpened: now - 40 * 86_400_000, exists: false },
      ]

  const templates: TemplateInfo[] = [
    { id: 'klar', packageName: 'slidev-theme-klar', label: 'Klar', description: 'Ruhig und gut lesbar, für jeden Anlass', builtin: true, installed: true, colors: colorsFor('klar') },
    { id: 'seriph', packageName: '@slidev/theme-seriph', label: 'Elegant', description: 'Serifenschrift, warmes Papier', builtin: false, installed: false, colors: colorsFor('seriph') },
    { id: 'default', packageName: '@slidev/theme-default', label: 'Schlicht', description: 'Weiß mit grünem Akzent', builtin: true, installed: true, colors: colorsFor('default') },
    { id: 'apple-basic', packageName: 'slidev-theme-apple-basic', label: 'Dunkel', description: 'Schwarzer Hintergrund, große Schrift', builtin: false, installed: false, colors: colorsFor('apple-basic') },
  ]

  function packageFor(raw: string, kind: 'theme' | 'addon'): PackageRequest {
    const name = kind === 'theme'
      ? (templates.find(t => t.id === raw)?.packageName ?? `slidev-theme-${raw}`)
      : `slidev-addon-${raw}`
    const trusted = kind === 'theme' && templates.some(t => t.id === raw)
    return { raw, name, kind, trusted, installed: installed.has(name) }
  }

  function need(deckId: string) {
    const entry = decks.get(deckId)
    if (!entry)
      throw new Error(`Präsentation ${deckId} ist nicht geöffnet`)
    return entry
  }

  function changed(deckId: string) {
    const entry = need(deckId)
    const snapshot = entry.deck.snapshot()
    emit('deck:changed', snapshot)
    for (const cb of frameSubscribers) cb()
    scheduleThumbnails(deckId)
    return snapshot
  }

  function scheduleThumbnails(deckId: string, force = false) {
    const entry = decks.get(deckId)
    if (!entry || entry.server.state !== 'ready')
      return
    const snapshot = entry.deck.snapshot()
    const stale = snapshot.slides.filter(s => force || entry.rendered.get(s.id) !== s.revision)
    stale.forEach((slide, i) => {
      entry.rendered.set(slide.id, slide.revision)
      setTimeout(() => {
        const current = entry.deck.snapshot()
        const now = current.slides.find(s => s.id === slide.id)
        if (!now)
          return
        emit('thumbnail', { deckId, no: now.no, revision: slide.revision, dataUrl: drawThumbnail(current, slide) })
      }, 500 + i * 120)
    })
  }

  async function progress(scope: string, steps: string[], total = 2000) {
    for (let i = 0; i < steps.length; i++) {
      emit('progress', { scope, message: steps[i], fraction: i / steps.length })
      await wait(total / steps.length)
    }
    emit('progress', { scope, message: steps.at(-1) ?? '', fraction: 1, done: true })
  }

  function openPath(path: string): DeckOpenResult {
    const deckId = `deck-${++deckCounter}`
    const sample = sampleDeck(path)
    const deck = new MockDeck(deckId, path.replace(/\/slides\.md$/, '').replace(/\.podium$/, ''), sample.headmatter, sample.slides)
    decks.set(deckId, { deck, server: { deckId, state: 'stopped' }, rendered: new Map() })
    const snapshot = deck.snapshot()
    const existing = recents.find(r => r.path === path)
    recents = [
      { path, title: snapshot.title, theme: snapshot.theme, lastOpened: Date.now(), exists: true, thumbnail: existing?.thumbnail },
      ...recents.filter(r => r.path !== path),
    ]
    const missing: PackageRequest[] = []
    const theme = packageFor(snapshot.theme, 'theme')
    if (!theme.installed)
      missing.push(theme)
    for (const addon of snapshot.addons) {
      const req = packageFor(addon, 'addon')
      if (!req.installed)
        missing.push(req)
    }
    return { snapshot, missingPackages: missing }
  }

  function setServer(deckId: string, status: Partial<ServerStatus>) {
    const entry = need(deckId)
    entry.server = { ...entry.server, ...status, deckId }
    emit('server:status', entry.server)
    return entry.server
  }

  async function bootServer(deckId: string, restart: boolean) {
    const entry = need(deckId)
    setServer(deckId, { state: restart ? 'restarting' : 'starting', error: undefined, log: undefined })
    await wait(restart ? 900 : 1600)
    if (params.get('mockServer') === 'error' && !restart) {
      return setServer(deckId, {
        state: 'error',
        error: 'Slidev wurde unerwartet beendet',
        log: [
          '  ●■▲',
          '  Slidev  v53.1.0',
          '[vite] Internal server error: Failed to resolve import "./components/Karte.vue"',
          '  Plugin: vite:import-analysis',
          '  File: slides.md__slidev_4.md',
          'Process exited with code 1',
        ],
      })
    }
    const url = `${location.origin}/__mock`
    const status = setServer(deckId, { state: 'ready', url, port: Number(location.port) || 80, mcpUrl: `${url}/__mcp` })
    entry.rendered.clear()
    scheduleThumbnails(deckId, true)
    for (const cb of frameSubscribers) cb()
    return status
  }

  let presentation: PresentationState = { active: false, displays: [] }
  const remotes = new Map<string, { mode: RemoteMode, password: string }>()

  /** A stand-in QR code: a grid pattern from the URL, good enough to look at the dialog. */
  function fakeQr(url: string): string {
    const n = 29
    let hash = 0
    for (const ch of url) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
    const cells: string[] = []
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const finder = (x < 7 || x >= n - 7) && y < 7 || x < 7 && y >= n - 7
        const on = finder
          ? !(x % (n - 7) === 1 || y % (n - 7) === 1) || (x % (n - 7) >= 2 && x % (n - 7) <= 4 && y % (n - 7) >= 2 && y % (n - 7) <= 4)
          : ((hash >>> ((x * 7 + y * 13) % 31)) ^ (x * y)) & 1
        if (on)
          cells.push(`M${x + 2},${y + 2}h1v1h-1z`)
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}"><rect fill="white" width="${n + 4}" height="${n + 4}"/><path fill="black" d="${cells.join('')}"/></svg>`
  }

  function remoteInfo(deckId: string): RemoteInfo {
    const entry = need(deckId)
    const remote = remotes.get(deckId)
    const tailscaleAddress = params.get('mockTailscale') === '0' ? undefined : '100.101.102.103'
    const info: RemoteInfo = { mode: remote?.mode ?? 'off', tailscaleAddress, lanAddresses: ['192.168.178.23'] }
    const address = remote?.mode === 'tailscale' ? tailscaleAddress : info.lanAddresses[0]
    if (remote && address && entry.server.port) {
      info.url = `http://${address}:${entry.server.port}/presenter/?password=${remote.password}`
      info.qrSvg = fakeQr(info.url)
    }
    return info
  }
  const displays: DisplayInfo[] = [
    { id: 1, label: 'Eingebauter Bildschirm', primary: true, internal: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    ...(params.get('mockDisplays') === '1'
      ? []
      : [{ id: 2, label: 'Beamer (HDMI)', primary: false, internal: false, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }]),
  ]

  /** The mock has no v-clicks; every list item counts as one click step. */
  function positionOf(deckId: string, no: number, clicks: number): PresentPosition {
    const slides = need(deckId).deck.snapshot().slides
    const slide = slides[Math.min(Math.max(no, 1), slides.length) - 1]
    const clicksTotal = slide ? (slide.content.match(/^\s*- /gm)?.length ?? 0) : 0
    return { no: slide?.no ?? 1, clicks: Math.min(Math.max(clicks, 0), clicksTotal), clicksTotal, total: slides.length }
  }

  const control: MockControl = {
    render(no) {
      // The mock serves one preview at a time, like one Slidev server per deck window.
      const entry = [...decks.values()].at(-1)
      if (!entry)
        return undefined
      const snapshot = entry.deck.snapshot()
      const slide = snapshot.slides[Math.min(Math.max(no, 1), snapshot.slides.length) - 1]
      if (!slide)
        return undefined
      return { html: renderSlideHtml(slide, `${location.origin}/__mock`), colors: colorsFor(snapshot.theme), canvas: snapshot.canvas, total: snapshot.slides.length }
    },
    subscribe(cb) {
      frameSubscribers.add(cb)
      return () => frameSubscribers.delete(cb)
    },
  }
  ;(window as unknown as { __podiumMock: MockControl }).__podiumMock = control

  const api: PodiumBridge & { __mock: true } = {
    __mock: true,
    on(event, listener) {
      const set = listeners.get(event) ?? new Set<Listener>()
      listeners.set(event, set)
      set.add(listener as Listener)
      return () => set.delete(listener as Listener)
    },
    pathForFile: file => `/home/anna/Dokumente/${file.name}`,

    async getAppInfo() {
      const lang = params.get('mockLocale') ?? navigator.language
      return {
        version: '0.1.0 (Vorschau)',
        platform: 'linux',
        locale: lang.startsWith('de') ? 'de' : 'en',
        userDataDir: '/home/anna/.config/Podium',
        defaultDeckDir: '/home/anna/Dokumente/Podium',
      }
    },
    // ?mockUpdate=ready|available shows the update note.
    getUpdateState: async () => mockUpdate(),
    checkForUpdates: async () => mockUpdate(),
    installUpdate: async () => {},
    getSettings: async () => ({ ...settings }),
    async setSettings(patch) {
      settings = { ...settings, ...patch }
      return { ...settings }
    },
    getRecentDecks: async () => recents.map(r => ({ ...r })),
    async removeRecentDeck(path) {
      recents = recents.filter(r => r.path !== path)
      return recents.map(r => ({ ...r }))
    },
    async pickFolder(_title, defaultPath) {
      await wait(300)
      return defaultPath ? `${defaultPath}/Verein` : '/home/anna/Dokumente'
    },
    async openExternal() {},
    async showInFolder() {},

    getRuntimeStatus: async () => ({ ...runtime }),
    async ensureRuntime() {
      if (runtime.state === 'ready')
        return runtime
      runtime = { ...runtime, state: 'installing' }
      await progress('runtime', [
        'Bausteine werden heruntergeladen …',
        'Bausteine werden heruntergeladen …',
        'Vorlagen werden eingerichtet …',
        'Schriften werden vorbereitet …',
        'Fast fertig …',
      ], 4000)
      if (runtimeFailOnce) {
        runtimeFailOnce = false
        runtime = { ...runtime, state: 'error', error: 'Keine Verbindung zum Paketserver (registry.npmjs.org)' }
        emit('progress', { scope: 'runtime', message: 'Fehler', error: runtime.error, done: true })
        throw new Error(runtime.error)
      }
      runtime = { ...runtime, state: 'ready', error: undefined }
      return runtime
    },
    listInstalledPackages: async () => [...installed].map(name => ({ name, version: '1.0.0', kind: 'theme' as const, builtin: true, dir: `/runtime/node_modules/${name}` })),
    resolvePackage: async (raw, kind) => packageFor(raw, kind),
    async installPackages(names) {
      await progress('packages', names.map(n => `${n} wird installiert …`), 1200 * names.length)
      for (const n of names) installed.add(n)
      for (const t of templates) t.installed = installed.has(t.packageName)
    },

    listTemplates: async () => templates.map(t => ({ ...t, installed: installed.has(t.packageName) })),
    addTemplate: async source => ({ name: 'slidev-theme-beispiel', label: 'Beispiel', version: '1.0.0', source, fetchedAt: Date.now() }),
    listAddedTemplates: async () => [],
    refreshTemplate: async name => ({ name, label: name, version: '1.0.1', source: 'https://example.org/vorlage', fetchedAt: Date.now() }),
    removeTemplate: async () => {},
    async getLayouts(deckId) {
      need(deckId)
      return structuredClone(MOCK_LAYOUTS) as LayoutInfo[]
    },

    async newDeck(options) {
      await wait(500)
      const path = `${options.parentDir}/${options.folderName ?? options.title}`
      const result = openPath(path)
      const entry = need(result.snapshot.deckId)
      entry.deck.state.headmatter = { ...entry.deck.state.headmatter, title: options.title, theme: options.template }
      entry.deck.state.slides = [
        { uid: 9000 + deckCounter, frontmatter: {}, content: `# ${options.title}\n\nUntertitel`, note: '' },
        { uid: 9100 + deckCounter, frontmatter: {}, content: '# Erste Folie\n\n- Ein Punkt\n- Noch ein Punkt', note: '' },
      ]
      recents[0] = { ...recents[0], title: options.title, theme: options.template }
      const snapshot = entry.deck.snapshot()
      const theme = packageFor(options.template, 'theme')
      return { snapshot, missingPackages: theme.installed ? [] : [theme] }
    },
    async openDeckDialog() {
      await wait(200)
      return openPath('/home/anna/Dokumente/Podium/Gartenplanung')
    },
    async openDeck(path) {
      await wait(300)
      if (path.includes('Vortrag Schule'))
        throw new Error(`Der Ordner „${path}“ wurde nicht gefunden.`)
      return openPath(path)
    },
    async closeDeck(deckId) {
      if (agentTimer)
        clearTimeout(agentTimer)
      decks.delete(deckId)
    },
    getDeck: async deckId => need(deckId).deck.snapshot(),

    async applyOp(deckId, op) {
      await wait(30)
      const result = need(deckId).deck.apply(op)
      changed(deckId)
      return result
    },
    async undo(deckId) {
      const result = need(deckId).deck.undo()
      changed(deckId)
      return result
    },
    async redo(deckId) {
      const result = need(deckId).deck.redo()
      changed(deckId)
      return result
    },
    async importImage(deckId) {
      need(deckId)
      await wait(200)
      return `/images/foto-${++imageCounter}.png`
    },
    async importImageData(deckId, fileName) {
      need(deckId)
      return `/images/${fileName}`
    },

    startServer: async (deckId) => {
      const entry = need(deckId)
      if (entry.server.state === 'ready')
        return entry.server
      return bootServer(deckId, false)
    },
    restartServer: deckId => bootServer(deckId, true),
    getServerStatus: async deckId => need(deckId).server,

    async requestThumbnails(deckId) {
      scheduleThumbnails(deckId, true)
    },
    async checkDeck(deckId) {
      const snapshot = need(deckId).deck.snapshot()
      await wait(1500)
      return snapshot.slides.map((slide): SlideCheck => {
        const lines = slide.content.split('\n').filter(l => l.trim()).length
        const overflowY = Math.max(0, (lines - 9) * 38)
        return {
          no: slide.no,
          overflow: overflowY > 0,
          overflowX: 0,
          overflowY,
          messages: overflowY > 0 ? [`Der Text ist ${overflowY} px zu hoch. Kürze ihn oder verteile ihn auf zwei Folien.`] : [],
        }
      })
    },

    getDisplays: async () => displays,
    async startPresentation(deckId, options) {
      if (need(deckId).server.state !== 'ready')
        throw new Error('Die Vorschau läuft noch nicht')
      const audience = options.audienceDisplayId ?? settings.audienceDisplayId ?? displays.find(d => !d.primary)?.id ?? 1
      presentation = {
        active: true,
        deckId,
        audienceDisplayId: audience,
        presenterDisplayId: displays.find(d => d.id !== audience)?.id,
        displays,
        position: positionOf(deckId, options.from, 0),
        startedAt: Date.now(),
        windowed: !!options.windowed,
      }
      emit('present:state', presentation)
      return presentation
    },
    async swapPresentationDisplays() {
      presentation = { ...presentation, audienceDisplayId: presentation.presenterDisplayId, presenterDisplayId: presentation.audienceDisplayId }
      emit('present:state', presentation)
      return presentation
    },
    async stopPresentation() {
      presentation = { active: false, displays }
      emit('present:state', presentation)
      return presentation
    },
    getPresentationState: async () => presentation,

    getRemoteInfo: async deckId => remoteInfo(deckId),
    async setRemote(deckId, mode) {
      need(deckId)
      if (mode === 'tailscale' && params.get('mockTailscale') === '0')
        throw new Error('Tailscale läuft auf diesem Computer nicht.')
      await wait(1200)
      if (mode === 'off')
        remotes.delete(deckId)
      else
        remotes.set(deckId, { mode, password: Math.random().toString(36).slice(2, 14) })
      return remoteInfo(deckId)
    },

    async exportDeck(deckId, format) {
      const snapshot = need(deckId).deck.snapshot()
      await progress('export', snapshot.slides.map(s => `Folie ${s.no} von ${snapshot.slides.length} …`), 2500)
      const ext = { pdf: '.pdf', pptx: '.pptx', png: '-bilder', web: '-webseite', bundle: '.podium' }[format]
      return { path: `/home/anna/Dokumente/${snapshot.title}${ext}` }
    },

    async getAgentInfo(deckId): Promise<AgentInfo> {
      const entry = need(deckId)
      const mcpUrl = entry.server.mcpUrl
      return {
        available: params.get('mockAgent') !== 'none',
        preset: settings.agentPreset,
        command: settings.agentCommand.split(' ')[0],
        mcpUrl,
        mcpSetupCommand: mcpUrl ? `claude mcp add --transport http podium ${mcpUrl}` : undefined,
        hasAgentsFile: true,
      }
    },
    async writeAgentsFile(deckId) {
      need(deckId)
      await wait(300)
    },
    async agentSend(deckId, prompt) {
      const entry = need(deckId)
      emit('agent', { deckId, type: 'started', prompt })
      const steps: (() => void)[] = [
        () => emit('agent', { deckId, type: 'text', text: 'Ich schaue mir die Präsentation an' }),
        () => emit('agent', { deckId, type: 'text', text: ' und lese zuerst die Folien.' }),
        () => emit('agent', { deckId, type: 'tool', name: 'Read', detail: 'slides.md' }),
        () => emit('agent', { deckId, type: 'tool', name: 'Edit', detail: 'slides.md: neue Folie „Zusammenfassung“' }),
        () => {
          entry.deck.external((state) => {
            state.slides.push({ uid: Date.now(), frontmatter: {}, content: '# Zusammenfassung\n\n- Was wir erreicht haben\n- Was als Nächstes kommt', note: '' })
          })
          changed(deckId)
        },
        () => emit('agent', { deckId, type: 'text', text: 'Ich habe am Ende eine Folie „Zusammenfassung“ mit zwei Punkten ergänzt.' }),
        () => emit('agent', { deckId, type: 'done', ok: true }),
      ]
      let i = 0
      const tick = () => {
        steps[i++]?.()
        if (i < steps.length)
          agentTimer = setTimeout(tick, 700)
      }
      agentTimer = setTimeout(tick, 400)
    },
    async agentStop(deckId) {
      if (agentTimer)
        clearTimeout(agentTimer)
      emit('agent', { deckId, type: 'error', message: 'Vom Benutzer angehalten' })
      emit('agent', { deckId, type: 'done', ok: false })
    },
  }
  return api
}
