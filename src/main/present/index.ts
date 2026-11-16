import type { PresentationController, PresentationOptions } from '../contracts'
import type { DisplayInfo, PresentationState, PresentOptions, PresentPosition } from '../../shared/types'
import { app, BrowserWindow, powerSaveBlocker, screen } from 'electron'
import { NEXT_STEP, parsePosition, READ_POSITION, samePosition } from './audience-scripts'
import { pickDisplays } from './pick-displays'

export { pickDisplays } from './pick-displays'

/** How often the audience window is asked where it is, to catch navigation that happens there. */
const POLL_MS = 250

interface Session {
  deckId: string
  serverUrl: string
  options: PresentOptions
  audience: BrowserWindow
  presenter?: BrowserWindow
  audienceDisplayId: number
  presenterDisplayId?: number
  blockerId: number
  startedAt: number
  position?: PresentPosition
  windowed: boolean
  poll?: ReturnType<typeof setInterval>
}

export function createPresentationController(options: PresentationOptions): PresentationController {
  let session: Session | undefined
  let stopping = false

  function displays(): DisplayInfo[] {
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: d.label || (options.locale() === 'de' ? `Bildschirm ${i + 1}` : `Display ${i + 1}`),
      primary: d.id === primaryId,
      internal: d.internal,
      bounds: { ...d.bounds },
    }))
  }

  function state(): PresentationState {
    return {
      active: !!session,
      deckId: session?.deckId,
      audienceDisplayId: session?.audienceDisplayId,
      presenterDisplayId: session?.presenterDisplayId,
      displays: displays(),
      position: session?.position,
      startedAt: session?.startedAt,
      windowed: session ? session.windowed : undefined,
    }
  }

  const emit = () => options.onState(state())

  function boundsOf(id: number) {
    return (screen.getAllDisplays().find(d => d.id === id) ?? screen.getPrimaryDisplay())
  }

  /** Put the audience window fullscreen on a display: move first, then fullscreen, so the OS picks that display. */
  function placeAudience(win: BrowserWindow, displayId: number) {
    if (win.isDestroyed())
      return
    const b = boundsOf(displayId).bounds
    const mac = process.platform === 'darwin'
    if (mac ? win.isSimpleFullScreen() : win.isFullScreen()) {
      if (mac)
        win.setSimpleFullScreen(false)
      else
        win.setFullScreen(false)
    }
    win.setBounds(b)
    if (mac)
      win.setSimpleFullScreen(true)
    else
      win.setFullScreen(true)
  }

  function placePresenter(win: BrowserWindow, displayId: number) {
    if (win.isDestroyed())
      return
    const wa = boundsOf(displayId).workArea
    if (win.isMaximized())
      win.unmaximize()
    win.setBounds(wa)
    win.maximize()
  }

  function focusMain(s: Session) {
    const w = s.presenter ?? s.audience
    if (!w.isDestroyed()) {
      w.show()
      w.focus()
      w.webContents.focus()
    }
  }

  function plainWindow(extra: Electron.BrowserWindowConstructorOptions): BrowserWindow {
    // No app preload, no node: these windows show a web page and nothing else.
    return new BrowserWindow({
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
        // Slidev's pages confirm every position to each other. A covered window that the system
        // slows down confirms late, after the next key press, and takes the talk a step back.
        backgroundThrottling: false,
      },
      ...extra,
    })
  }

  /**
   * The audience window for video calls: a normal framed window that can be picked in a
   * "share window" list, with a fixed title, that keeps rendering while covered.
   */
  function sharedWindow(deckId: string, displayId: number): BrowserWindow {
    const info = options.deckInfo?.(deckId)
    const aspect = info && info.canvas.width && info.canvas.height ? info.canvas.width / info.canvas.height : 16 / 9
    const width = Math.round(Math.min(1280, 720 * aspect))
    const height = Math.round(width / aspect)
    const wa = boundsOf(displayId).workArea
    const de = options.locale() === 'de'
    const win = new BrowserWindow({
      show: false,
      x: wa.x,
      y: wa.y,
      width,
      height,
      useContentSize: true,
      autoHideMenuBar: true,
      resizable: true,
      fullscreenable: true,
      backgroundColor: '#000000',
      title: `${info?.title || 'Podium'} – ${de ? 'Präsentation' : 'Presentation'}`,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
        // Zoom and co. capture this window while the presenter view has focus.
        backgroundThrottling: false,
      },
    })
    win.removeMenu()
    win.on('page-title-updated', e => e.preventDefault())
    return win
  }

  /** Bounds for the presenter view next to the windowed audience window on the same display. */
  function besideBounds(audience: BrowserWindow, displayId: number): Electron.Rectangle {
    const wa = boundsOf(displayId).workArea
    const a = audience.getBounds()
    const x = Math.min(a.x + a.width, wa.x + wa.width - 640)
    return { x: Math.max(wa.x, x), y: wa.y, width: Math.max(640, wa.x + wa.width - Math.max(wa.x, x)), height: wa.height }
  }

  async function readPosition(s: Session): Promise<PresentPosition | undefined> {
    if (s.audience.isDestroyed())
      return undefined
    try {
      return parsePosition(await s.audience.webContents.executeJavaScript(READ_POSITION, true))
    }
    catch {
      return undefined
    }
  }

  /** Read where the audience window is and publish it when it moved (or always, with `force`). */
  async function refreshPosition(s: Session, force = false) {
    const position = await readPosition(s)
    if (session !== s)
      return
    const changed = !!position && !samePosition(position, s.position)
    if (position)
      s.position = position
    if (changed || force)
      emit()
  }

  function startPolling(s: Session) {
    let busy = false
    s.poll = setInterval(() => {
      if (busy || session !== s)
        return
      busy = true
      void refreshPosition(s).finally(() => { busy = false })
    }, POLL_MS)
  }

  /** Slidev's presenter page. In remote mode Slidev asks for the password there. */
  function presenterUrl(base: string, no: number, password?: string): string {
    return `${base}/presenter/${no}${password ? `?password=${encodeURIComponent(password)}` : ''}`
  }

  async function reload(serverUrl: string, password?: string, at?: PresentPosition): Promise<PresentationState> {
    const s = session
    if (!s || s.audience.isDestroyed())
      return state()
    s.serverUrl = serverUrl
    const base = serverUrl.replace(/\/$/, '')
    const pos = at ?? s.position
    const no = pos?.no ?? Math.max(1, Math.floor(s.options.from || 1))
    const clicks = pos?.clicks ?? 0
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    const load = async (win: BrowserWindow | undefined, url: string) => {
      // A window left on an error page would stay blank for the rest of the talk, so try again.
      for (let attempt = 0; attempt < 8 && session === s && win && !win.isDestroyed(); attempt++) {
        try {
          await win.loadURL(url)
        }
        catch {
          // Either Vite's client reloaded the page at the same moment, which aborts this load but
          // lands on the same URL, or the server was not answering yet.
        }
        if (win.isDestroyed() || win.webContents.getURL().startsWith(base))
          return
        await sleep(400)
      }
    }
    await load(s.audience, `${base}/${no}`)
    await load(s.presenter, presenterUrl(base, no, password))
    const deadline = Date.now() + 15_000
    // Wait until the slide has mounted (its click steps are known only then).
    while (session === s && Date.now() < deadline) {
      const now = await readPosition(s)
      if (now)
        s.position = now
      if (now && now.no === no && now.clicksTotal >= clicks)
        break
      await sleep(100)
    }
    // Every Slidev page reports its position once after loading, with no click steps yet, and
    // the others follow. Let that settle, then step the audience page forward the way a clicker
    // would; the presenter pages follow it (an untouched presenter page does not lead, see
    // launcher/bridge-client.js).
    const leader = s.audience
    if (clicks > 0)
      await sleep(800)
    while (session === s && Date.now() < deadline && !leader.isDestroyed()) {
      const now = await readPosition(s)
      if (now)
        s.position = now
      if (!now || now.no !== no || now.clicks >= clicks)
        break
      await leader.webContents.executeJavaScript(NEXT_STEP, true).catch(() => false)
      const before = now.clicks
      const until = Date.now() + 2000
      while (session === s && Date.now() < until && (s.position?.clicks ?? 0) <= before) {
        await sleep(100)
        const after = await readPosition(s)
        if (after)
          s.position = after
      }
    }
    if (session === s) {
      focusMain(s)
      emit()
    }
    return state()
  }

  function wire(win: BrowserWindow) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        void stop()
      }
      // Same keys as the menu entry, which these windows do not have on Windows and Linux.
      else if (input.type === 'keyDown' && input.shift && (input.control || input.meta) && input.key.toLowerCase() === 't') {
        event.preventDefault()
        void swapDisplays()
      }
    })
    win.on('closed', () => { void stop() })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  async function start(deckId: string, serverUrl: string, present: PresentOptions, password?: string): Promise<PresentationState> {
    if (session)
      await stop()
    const windowed = !!present.windowed
    // In a window the presenter view is the whole point: the speaker shares the slides window in the call.
    const picked = pickDisplays(displays(), { audienceDisplayId: present.audienceDisplayId, presenterView: windowed || present.presenterView })
    if (!picked)
      throw new Error(options.locale() === 'de' ? 'Kein Bildschirm gefunden.' : 'No display found.')
    const base = serverUrl.replace(/\/$/, '')
    const from = Math.max(1, Math.floor(present.from || 1))
    const ab = boundsOf(picked.audience.id).bounds

    const audience = windowed
      ? sharedWindow(deckId, picked.audience.id)
      : plainWindow({
          ...ab,
          frame: false,
          fullscreenable: true,
          backgroundColor: '#000000',
          title: 'Podium',
          resizable: false,
          skipTaskbar: false,
        })
    let presenter: BrowserWindow | undefined
    if (picked.presenter) {
      const wa = boundsOf(picked.presenter.id).workArea
      presenter = plainWindow({ ...(windowed ? besideBounds(audience, picked.presenter.id) : wa), title: 'Podium' })
      // The editor's menu shortcuts belong to the main window.
      presenter.removeMenu()
    }
    const s: Session = {
      deckId,
      serverUrl,
      options: present,
      audience,
      presenter,
      audienceDisplayId: picked.audience.id,
      presenterDisplayId: picked.presenter?.id,
      blockerId: powerSaveBlocker.start('prevent-display-sleep'),
      startedAt: Date.now(),
      windowed,
    }
    session = s
    wire(audience)
    if (presenter)
      wire(presenter)

    try {
      await Promise.all([
        audience.loadURL(`${base}/${from}`),
        presenter?.loadURL(presenterUrl(base, from, password)),
      ])
    }
    catch (err) {
      await stop()
      throw err
    }
    if (session !== s)
      return state()
    if (!windowed)
      placeAudience(audience, s.audienceDisplayId)
    audience.show()
    if (presenter) {
      if (!windowed || s.presenterDisplayId !== s.audienceDisplayId)
        placePresenter(presenter, s.presenterDisplayId!)
      presenter.show()
    }
    focusMain(s)
    // Window managers sometimes hand focus to the fullscreen window last.
    setTimeout(() => { if (session === s) focusMain(s) }, 300)
    // Slidev needs a moment after the load event before its nav is up; callers want a position.
    const deadline = Date.now() + 10_000
    while (session === s && !s.position && Date.now() < deadline) {
      await refreshPosition(s)
      if (!s.position)
        await new Promise(resolve => setTimeout(resolve, 100))
    }
    startPolling(s)
    emit()
    return state()
  }

  async function stop(): Promise<PresentationState> {
    const s = session
    if (!s || stopping) {
      emit()
      return state()
    }
    stopping = true
    session = undefined
    if (s.poll)
      clearInterval(s.poll)
    try {
      if (powerSaveBlocker.isStarted(s.blockerId))
        powerSaveBlocker.stop(s.blockerId)
      for (const w of [s.audience, s.presenter]) {
        if (w && !w.isDestroyed()) {
          if (process.platform === 'darwin' && w.isSimpleFullScreen())
            w.setSimpleFullScreen(false)
          w.destroy()
        }
      }
    }
    finally {
      stopping = false
    }
    emit()
    return state()
  }

  async function swapDisplays(): Promise<PresentationState> {
    const s = session
    if (s?.presenter && !s.windowed && s.presenterDisplayId !== undefined && s.presenterDisplayId !== s.audienceDisplayId) {
      const a = s.audienceDisplayId
      s.audienceDisplayId = s.presenterDisplayId
      s.presenterDisplayId = a
      placeAudience(s.audience, s.audienceDisplayId)
      placePresenter(s.presenter, s.presenterDisplayId)
      focusMain(s)
    }
    emit()
    return state()
  }

  /** A display appeared or vanished (or changed size) while presenting: re-pick and re-apply. */
  function onDisplaysChanged() {
    const s = session
    // Windowed sessions are normal windows the user arranges; leave them where they are.
    if (s && !s.windowed) {
      const picked = pickDisplays(displays(), { audienceDisplayId: s.audienceDisplayId, presenterView: !!s.presenter })
      if (picked) {
        s.audienceDisplayId = picked.audience.id
        s.presenterDisplayId = s.presenter ? picked.presenter?.id : undefined
        // Skip when nothing moved: fullscreen changes themselves fire metrics events.
        const target = boundsOf(s.audienceDisplayId).bounds
        const cur = s.audience.getBounds()
        const presenterOk = !s.presenter || s.presenterDisplayId === undefined
          || screen.getDisplayMatching(s.presenter.getBounds()).id === s.presenterDisplayId
        const same = presenterOk && cur.x === target.x && cur.y === target.y && cur.width === target.width && cur.height === target.height
        if (!same) {
          placeAudience(s.audience, s.audienceDisplayId)
          if (s.presenter && s.presenterDisplayId !== undefined)
            placePresenter(s.presenter, s.presenterDisplayId)
          focusMain(s)
        }
      }
    }
    emit()
  }

  void app.whenReady().then(() => {
    screen.on('display-added', onDisplaysChanged)
    screen.on('display-removed', onDisplaysChanged)
    screen.on('display-metrics-changed', onDisplaysChanged)
  })

  return {
    displays,
    state,
    start,
    swapDisplays,
    reload,
    stop,
  }
}
