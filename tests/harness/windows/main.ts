/* Electron main script for manual verification. Bundled with esbuild, run under xvfb. See report. */
import type { DeckSnapshot } from '../../../src/shared/types'
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { createExporter } from '../../../src/main/export'
import { createPresentationController } from '../../../src/main/present'
import { createThumbnailer } from '../../../src/main/thumbs'

const env = process.env
const out = env.HARNESS_OUT!
const url = env.HARNESS_URL!
const runtimeDir = env.HARNESS_RUNTIME!
const entry = env.HARNESS_ENTRY!
const only = env.HARNESS_ONLY?.split(',')
mkdirSync(out, { recursive: true })
const log = (...a: unknown[]) => console.log('[harness]', ...a)

const revs = ['a', 'b', 'c', 'd', 'e']
const deck = {
  deckId: 'd1',
  dir: join(entry, '..'),
  entry,
  title: 'Windows Fixture',
  headmatter: {},
  theme: 'default',
  addons: [],
  canvas: { width: 980, height: 552 },
  slides: revs.map((r, i) => ({ no: i + 1, revision: r, note: `Notiz ${i + 1}` })),
  cause: 'load',
} as unknown as DeckSnapshot

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const want = (n: string) => !only || only.includes(n)

app.on('window-all-closed', () => {}) // the real app keeps its main window; the harness must not quit between hidden windows

async function main() {
  await app.whenReady()
  const t0 = Date.now()
  if (want('thumbs')) {
    const events: string[] = []
    const thumbs = createThumbnailer({
      onThumbnail(e) {
        events.push(`${e.no}:${e.revision}`)
        const b64 = e.dataUrl.split(',')[1]
        writeFileSync(join(out, `thumb-${e.no}.jpg`), Buffer.from(b64, 'base64'))
      },
    })
    await thumbs.request(deck, url)
    log('thumbs first run', events.join(' '), `${Date.now() - t0}ms`)
    events.length = 0
    await thumbs.request(deck, url)
    log('thumbs second run (expect none)', events.length)
    const changed = { ...deck, cause: 'app', slides: deck.slides.map((s, i) => i === 1 ? { ...s, revision: 'z' } : s) } as DeckSnapshot
    await thumbs.request(changed, url)
    log('thumbs after change of slide 2', events.join(' '))
    // coalescing
    events.length = 0
    const p1 = thumbs.request(deck, url, [1, 2, 3, 4, 5])
    const p2 = thumbs.request(deck, url, [5])
    await Promise.all([p1, p2])
    log('coalesced', events.join(' '))
    log('cover', thumbs.cover('d1')?.length)
    const checks = await thumbs.check(deck, url, 'de')
    log('check', JSON.stringify(checks))
    log('check en', JSON.stringify((await thumbs.check(deck, url, 'en')).filter(c => c.overflow)))
    thumbs.release('d1')
  }
  if (want('export')) {
    const progress: string[] = []
    const exporter = createExporter({
      runtime: { runtimeDir, spawnNode: (args: string[], o: object) => spawn(process.execPath, args, { ...o, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }) } as never,
      onProgress: e => progress.push(`${e.message}${e.done ? ' [done]' : ''}${e.error ? ` ERR ${e.error}` : ''}`),
    })
    for (const f of (env.HARNESS_FORMATS?.split(',') ?? ['pdf', 'png', 'pptx']) as Array<'pdf' | 'png' | 'pptx'>) {
      const target = join(out, f === 'png' ? 'png' : `deck.${f}`)
      const t = Date.now()
      const r = await exporter.run(deck, url, f, target)
      log('export', f, r.path, `${Date.now() - t}ms`)
    }
    if (!env.HARNESS_FORMATS) log('png files', readdirSync(join(out, 'png')).map(n => `${n}:${statSync(join(out, 'png', n)).size}`).join(' '))
    if (!env.HARNESS_FORMATS) log('pdf size', statSync(join(out, 'deck.pdf')).size, 'pptx size', statSync(join(out, 'deck.pptx')).size)
    if (want('web')) {
      const t = Date.now()
      try {
        await exporter.run(deck, url, 'web', join(out, 'web'))
        log('web ok', readdirSync(join(out, 'web')).join(','), `${Date.now() - t}ms`)
      }
      catch (e) { log('web failed', String(e).slice(0, 600)) }
    }
    log('progress', progress.slice(0, 4).join(' | '), '...', progress.slice(-2).join(' | '))
  }
  if (want('present')) {
    const states: string[] = []
    const pc = createPresentationController({
      locale: () => 'de',
      onState: s => states.push(`active=${s.active} aud=${s.audienceDisplayId} pres=${s.presenterDisplayId}`),
    })
    log('displays', JSON.stringify(pc.displays()), JSON.stringify(screen.getAllDisplays().map(d => d.bounds)))
    for (const presenterView of [false, true]) {
      const st = await pc.start('d1', url, { from: 2, presenterView })
      await sleep(2500)
      log('present', presenterView, JSON.stringify(st))
      for (const w of BrowserWindow.getAllWindows()) {
        log('  window', JSON.stringify({ title: w.getTitle(), url: w.webContents.getURL(), bounds: w.getBounds(), fullscreen: w.isFullScreen(), maximized: w.isMaximized(), focused: w.isFocused(), visible: w.isVisible() }))
      }
      const wins = BrowserWindow.getAllWindows()
      if (wins[0]) {
        const img = await wins[0].webContents.capturePage()
        writeFileSync(join(out, `present-${presenterView}-${wins.length - 1}.png`), img.toPNG())
      }
      if (wins[1]) writeFileSync(join(out, `present-${presenterView}-second.png`), (await wins[1].webContents.capturePage()).toPNG())
      // Escape ends it
      wins[wins.length - 1].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      await sleep(500)
      log('after escape', JSON.stringify(pc.state().active), BrowserWindow.getAllWindows().length)
      await pc.stop()
    }
    log('states', states.join(' ; '))
  }
  log('done')
  app.exit(0)
}
main().catch((e) => { console.error('[harness] FAIL', e); app.exit(1) })
