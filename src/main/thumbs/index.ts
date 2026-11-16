import type { Thumbnailer, ThumbnailerOptions } from '../contracts'
import type { DeckSnapshot, Locale, SlideCheck } from '../../shared/types'
import { BrowserWindow } from 'electron'
import { API_EXPR, FALLBACK_SCRIPT } from './page-script'

const THUMB_WIDTH = 480
const JPEG_QUALITY = 80
/** Slidev hot-reloads a moment after the file changed; capturing earlier shows the old slide. */
const HMR_SETTLE_MS = 350
/** Overflow below this many px is rounding noise. */
const OVERFLOW_TOLERANCE = 2

interface Entry {
  deckId: string
  win?: BrowserWindow
  serverUrl: string
  size: string
  /** Set when the page crashed or failed to load: the window is rebuilt on next use. */
  dead: boolean
  cache: Map<number, string>
  cover?: string
  pending?: { deck: DeckSnapshot, serverUrl: string, nos?: number[] }
  running?: Promise<void>
  /** Tail of the exclusive-access chain, one capture at a time per window. */
  lock: Promise<unknown>
  released: boolean
}

function overflowMessages(locale: Locale, x: number, y: number): string[] {
  const out: string[] = []
  if (y > OVERFLOW_TOLERANCE) {
    out.push(locale === 'de'
      ? `Der Inhalt ragt ${y} px unten über die Folie hinaus.`
      : `The content extends ${y} px below the bottom of the slide.`)
  }
  if (x > OVERFLOW_TOLERANCE) {
    out.push(locale === 'de'
      ? `Der Inhalt ragt ${x} px rechts über die Folie hinaus.`
      : `The content extends ${x} px beyond the right edge of the slide.`)
  }
  return out
}

export function createThumbnailer(options: ThumbnailerOptions): Thumbnailer {
  const entries = new Map<string, Entry>()

  function entryFor(deckId: string): Entry {
    let e = entries.get(deckId)
    if (!e) {
      e = { deckId, serverUrl: '', size: '', dead: false, cache: new Map(), lock: Promise.resolve(), released: false }
      entries.set(deckId, e)
    }
    return e
  }

  function exclusive<T>(e: Entry, fn: () => Promise<T>): Promise<T> {
    const run = e.lock.then(fn, fn)
    e.lock = run.catch(() => {})
    return run
  }

  function destroyWindow(e: Entry) {
    const w = e.win
    e.win = undefined
    if (w && !w.isDestroyed())
      w.destroy()
  }

  async function ensureWindow(e: Entry, deck: DeckSnapshot, serverUrl: string): Promise<BrowserWindow> {
    const size = `${deck.canvas.width}x${deck.canvas.height}`
    if (e.win && !e.win.isDestroyed() && !e.dead && e.serverUrl === serverUrl && e.size === size)
      return e.win
    destroyWindow(e)
    e.dead = false
    e.serverUrl = serverUrl
    e.size = size
    e.cache.clear()
    const win = new BrowserWindow({
      show: false,
      width: deck.canvas.width,
      height: deck.canvas.height,
      useContentSize: true,
      frame: false,
      enableLargerThanScreen: true,
      backgroundColor: '#ffffff',
      // Offscreen rendering keeps animation frames coming. A plain hidden window stalls them,
    // and Slidev's slide switch waits on frames.
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    win.setContentSize(deck.canvas.width, deck.canvas.height)
    win.webContents.setAudioMuted(true)
    win.webContents.on('render-process-gone', () => { e.dead = true })
    win.webContents.on('did-fail-load', (_ev, _code, _desc, _url, isMain) => { if (isMain) e.dead = true })
    win.on('closed', () => { if (e.win === win) e.win = undefined })
    e.win = win
    await win.loadURL(`${serverUrl.replace(/\/$/, '')}/1?embedded=true`)
    return win
  }

  /** Make sure the page API exists (a Vite full reload drops the injected fallback) and Slidev is mounted. */
  async function prepare(win: BrowserWindow): Promise<void> {
    const js = win.webContents.executeJavaScript.bind(win.webContents)
    await js(FALLBACK_SCRIPT)
    await js(`${API_EXPR}.ready()`)
    await js(`${API_EXPR}.setMode('capture')`)
  }

  async function capture(win: BrowserWindow, no: number): Promise<string> {
    await win.webContents.executeJavaScript(`${API_EXPR}.goto(${no})`)
    const image = await win.webContents.capturePage()
    if (image.isEmpty())
      throw new Error('empty capture')
    const small = image.getSize().width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'best' }) : image
    return `data:image/jpeg;base64,${small.toJPEG(JPEG_QUALITY).toString('base64')}`
  }

  async function renderRun(e: Entry): Promise<void> {
    while (e.pending && !e.released) {
      const job = e.pending
      e.pending = undefined
      const { deck } = job
      const total = deck.slides.length
      for (const no of [...e.cache.keys()]) {
        if (no > total)
          e.cache.delete(no)
      }
      const wanted = job.nos
        ? job.nos.filter(n => n >= 1 && n <= total)
        : deck.slides.filter(s => e.cache.get(s.no) !== s.revision).map(s => s.no)
      if (!wanted.length)
        continue
      const order = [...new Set(wanted)].sort((a, b) => a - b)
      if (deck.cause !== 'load')
        await new Promise(r => setTimeout(r, HMR_SETTLE_MS))
      let win: BrowserWindow
      try {
        win = await ensureWindow(e, deck, job.serverUrl)
        await prepare(win)
      }
      catch (err) {
        e.dead = true
        throw err
      }
      for (const no of order) {
        // A newer request wins: restart with it instead of finishing a stale list.
        if (e.pending || e.released)
          break
        const slide = deck.slides.find(s => s.no === no)
        if (!slide)
          continue
        try {
          const dataUrl = await capture(win, no)
          if (e.released)
            return
          e.cache.set(no, slide.revision)
          if (no === 1)
            e.cover = dataUrl
          options.onThumbnail({ deckId: deck.deckId, no, revision: slide.revision, dataUrl })
        }
        catch (err) {
          if (win.isDestroyed() || e.dead)
            throw err
          // One bad slide must not block the others.
        }
      }
    }
  }

  async function request(deck: DeckSnapshot, serverUrl: string, nos?: number[]): Promise<void> {
    const e = entryFor(deck.deckId)
    e.released = false
    e.pending = { deck, serverUrl, nos }
    if (!e.running) {
      e.running = exclusive(e, () => renderRun(e)).finally(() => { e.running = undefined })
    }
    return e.running
  }

  async function check(deck: DeckSnapshot, serverUrl: string, locale: Locale): Promise<SlideCheck[]> {
    const e = entryFor(deck.deckId)
    e.released = false
    return exclusive(e, async () => {
      const win = await ensureWindow(e, deck, serverUrl)
      await prepare(win)
      const results: SlideCheck[] = []
      for (const slide of deck.slides) {
        await win.webContents.executeJavaScript(`${API_EXPR}.goto(${slide.no})`)
        const report = await win.webContents.executeJavaScript(`${API_EXPR}.measure()`) as { overflowX: number, overflowY: number }
        const messages = overflowMessages(locale, report.overflowX, report.overflowY)
        results.push({
          no: slide.no,
          overflow: messages.length > 0,
          overflowX: report.overflowX,
          overflowY: report.overflowY,
          messages,
        })
      }
      return results
    })
  }

  return {
    request,
    check,
    cover: deckId => entries.get(deckId)?.cover,
    release(deckId) {
      const e = entries.get(deckId)
      if (!e)
        return
      e.released = true
      e.pending = undefined
      destroyWindow(e)
      entries.delete(deckId)
    },
  }
}
