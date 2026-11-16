import type { DeckSnapshot } from '../../shared/types'
import { BrowserWindow } from 'electron'
import { API_EXPR, FALLBACK_SCRIPT } from './page-script'

export interface Rect { x: number, y: number, width: number, height: number }

export const PDF_WINDOW = { width: 1600, height: 900 }

function hiddenWindow(width: number, height: number): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    enableLargerThanScreen: true,
    backgroundColor: '#ffffff',
    // Offscreen rendering keeps animation frames coming. A plain hidden window stalls them,
    // and Slidev's slide switch waits on frames.
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.setContentSize(width, height)
  return win
}

/**
 * Loads Slidev's browser-exporter route (`/export`, available in the dev server, unlike `/print`)
 * into a hidden window. In print media it lays all slides out one per page with every click revealed.
 */
export async function openExportPage(deck: DeckSnapshot, serverUrl: string, password?: string): Promise<BrowserWindow> {
  const win = hiddenWindow(PDF_WINDOW.width, PDF_WINDOW.height)
  try {
    // In remote mode Slidev guards this page with the password.
    const query = password ? `?password=${encodeURIComponent(password)}` : ''
    await win.loadURL(`${serverUrl.replace(/\/$/, '')}/export${query}`)
    await win.webContents.executeJavaScript(waitScript(deck.slides.length), true)
  }
  catch (err) {
    win.destroy()
    throw err
  }
  return win
}

/** Hidden window sized like one slide times `scale`, showing slide 1 in capture mode. */
export async function openSlideWindow(deck: DeckSnapshot, serverUrl: string, scale: number): Promise<BrowserWindow> {
  const win = hiddenWindow(deck.canvas.width * scale, deck.canvas.height * scale)
  try {
    await win.loadURL(`${serverUrl.replace(/\/$/, '')}/1?embedded=true`)
    const js = win.webContents.executeJavaScript.bind(win.webContents)
    await js(FALLBACK_SCRIPT)
    await js(`${API_EXPR}.ready()`)
    await js(`${API_EXPR}.setMode('capture')`)
  }
  catch (err) {
    win.destroy()
    throw err
  }
  return win
}

export async function gotoSlide(win: BrowserWindow, no: number): Promise<void> {
  await win.webContents.executeJavaScript(`${API_EXPR}.goto(${no})`)
}

function waitScript(total: number): string {
  return `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const t0 = Date.now()
    const late = () => { if (Date.now() - t0 > 90000) throw new Error('Die Folien wurden nicht rechtzeitig geladen.') }
    while (document.querySelectorAll('.print-slide-container').length < ${total}) { late(); await sleep(100) }
    while (document.querySelector('.slidev-slide-loading')) { late(); await sleep(100) }
    for (const el of document.querySelectorAll('[data-waitfor]')) {
      const sel = el.getAttribute('data-waitfor')
      const t1 = Date.now()
      while (sel && !el.querySelector(sel) && Date.now() - t1 < 10000) await sleep(100)
    }
    const mer = document.querySelector('#mermaid-rendering-container')
    if (mer) {
      const t1 = Date.now()
      while (mer.querySelector('div') && Date.now() - t1 < 15000) await sleep(100)
      mer.style.display = 'none'
    }
    document.querySelectorAll('.monaco-aria-container').forEach(n => { n.style.display = 'none' })
    await document.fonts.ready
    await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = () => r(0) })))
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    await sleep(300)
  })()`
}

/**
 * PNG of the whole page. The hidden window is `scale` times larger than the slide; Slidev fits the slide to
 * the viewport, so the bitmap shows it at `scale`x pixels, rendered sharp rather than upscaled.
 * (DevTools screenshots hang on hidden windows, capturePage does not.)
 */
export async function screenshot(win: BrowserWindow): Promise<Buffer> {
  const image = await win.webContents.capturePage()
  if (image.isEmpty())
    throw new Error('Leeres Bild')
  return image.toPNG()
}
