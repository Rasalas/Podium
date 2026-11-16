import type { Exporter, ExporterOptions } from '../contracts'
import type { DeckSnapshot, ExportFormat, ExportResult } from '../../shared/types'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gotoSlide, openExportPage, openSlideWindow, screenshot } from './print-page'

const SCOPE = 'export'
const PNG_SCALE = 2
const BUILD_TAIL_CHARS = 1500

type Format = Exclude<ExportFormat, 'bundle'>

export function createExporter(options: ExporterOptions): Exporter {
  const progress = (message: string, fraction?: number) => options.onProgress({ scope: SCOPE, message, fraction })

  async function pdf(deck: DeckSnapshot, serverUrl: string, target: string, password?: string): Promise<string> {
    progress('Folien werden geladen …', 0.05)
    const win = await openExportPage(deck, serverUrl, password)
    try {
      progress('PDF wird erstellt …', 0.5)
      const { width, height } = deck.canvas
      // Slidev's print styles set @page to the slide size; the explicit size is the fallback.
      const data = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: { width: width / 96, height: height / 96 },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      await mkdir(resolve(target, '..'), { recursive: true })
      await writeFile(target, data)
      return target
    }
    finally {
      win.destroy()
    }
  }

  /** Render every slide to a PNG buffer: capture mode window, DevTools screenshot at the given scale. */
  async function renderSlides(deck: DeckSnapshot, serverUrl: string, from: number, to: number, scale: number): Promise<Buffer[]> {
    progress('Folien werden geladen …', from)
    const win = await openSlideWindow(deck, serverUrl, scale)
    try {
      const out: Buffer[] = []
      for (let i = 0; i < deck.slides.length; i++) {
        progress(`Folie ${i + 1} von ${deck.slides.length} …`, from + (to - from) * (i / deck.slides.length))
        await gotoSlide(win, i + 1)
        out.push(await screenshot(win))
      }
      return out
    }
    finally {
      if (!win.isDestroyed())
        win.destroy()
    }
  }

  async function png(deck: DeckSnapshot, serverUrl: string, target: string): Promise<string> {
    await mkdir(target, { recursive: true })
    const images = await renderSlides(deck, serverUrl, 0.05, 0.95, PNG_SCALE)
    const pad = Math.max(3, String(images.length).length)
    for (const name of await readdir(target)) {
      if (/^\d+\.png$/.test(name))
        await rm(join(target, name), { force: true })
    }
    for (let i = 0; i < images.length; i++)
      await writeFile(join(target, `${String(i + 1).padStart(pad, '0')}.png`), images[i])
    return target
  }

  async function pptx(deck: DeckSnapshot, serverUrl: string, target: string): Promise<string> {
    // pptxgenjs is a dependency of Slidev's client and lives in the runtime's node_modules.
    const file = join(options.runtime.runtimeDir, 'node_modules', 'pptxgenjs', 'dist', 'pptxgen.es.js')
    const mod = await import(/* @vite-ignore */ pathToFileURL(file).href) as { default: new () => any }
    const images = await renderSlides(deck, serverUrl, 0.05, 0.85, PNG_SCALE)
    progress('Präsentation wird zusammengesetzt …', 0.9)
    const wIn = deck.canvas.width / 96
    const hIn = deck.canvas.height / 96
    const doc = new mod.default()
    doc.defineLayout({ name: 'PODIUM', width: wIn, height: hIn })
    doc.layout = 'PODIUM'
    doc.title = deck.title
    for (let i = 0; i < images.length; i++) {
      const slide = doc.addSlide()
      slide.addImage({ data: `image/png;base64,${images[i].toString('base64')}`, x: 0, y: 0, w: wIn, h: hIn })
      const note = deck.slides[i]?.note
      if (note)
        slide.addNotes(note)
    }
    const buf = await doc.write({ outputType: 'nodebuffer' }) as Buffer
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, buf)
    return target
  }

  async function web(deck: DeckSnapshot, _serverUrl: string, target: string): Promise<string> {
    progress('Webseite wird gebaut. Das kann eine Minute dauern …')
    const cli = join(options.runtime.runtimeDir, 'node_modules', '@slidev', 'cli', 'bin', 'slidev.mjs')
    await mkdir(target, { recursive: true })
    const child = options.runtime.spawnNode([cli, 'build', deck.entry, '--out', target], {
      cwd: deck.dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let tail = ''
    const collect = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-BUILD_TAIL_CHARS * 2)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const code = await new Promise<number | null>((res, rej) => {
      child.once('error', rej)
      child.once('close', res)
    })
    if (code !== 0) {
      // eslint-disable-next-line no-control-regex
      const clean = tail.replace(/\u001B\[[0-9;]*m/g, '').trim().slice(-BUILD_TAIL_CHARS)
      throw new Error(`Der Webseiten-Export ist fehlgeschlagen (Code ${code}).\n${clean}`)
    }
    return target
  }

  async function run(deck: DeckSnapshot, serverUrl: string, format: Format, targetPath: string, password?: string): Promise<ExportResult> {
    try {
      progress('Export startet …', 0)
      const steps: Record<Format, typeof pdf> = { pdf, png, pptx, web }
      const path = await steps[format](deck, serverUrl, targetPath, password)
      options.onProgress({ scope: SCOPE, message: 'Fertig.', fraction: 1, done: true })
      return { path }
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      options.onProgress({ scope: SCOPE, message: 'Export fehlgeschlagen.', done: true, error: message })
      throw err
    }
  }

  return { run }
}
