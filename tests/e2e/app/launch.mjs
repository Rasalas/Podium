// Starts the built app under Playwright. Shared by the e2e spec and ad-hoc driver scripts.
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '../../..')
const NOISE = /dbus|GLib|gpu|Gtk|libEGL|viz_main|Fontconfig|sandbox/i

export async function launchPodium({ profile, verbose = false, args = [], env = {} }) {
  mkdirSync(profile, { recursive: true })
  const app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--disable-gpu', root, ...args],
    env: {
      ...process.env,
      PODIUM_USER_DATA: resolve(profile, 'userdata'),
      PODIUM_RUNTIME_DIR: process.env.PODIUM_RUNTIME_DIR || resolve(root, '.dev-runtime'),
      PODIUM_DECK_DIR: resolve(profile, 'decks'),
      LANG: 'de_DE.UTF-8',
      ...env,
    },
  })
  const log = []
  const note = (line) => {
    log.push(line)
    if (verbose)
      console.log(line)
  }
  app.process().stdout.on('data', d => note(`[main] ${String(d).trimEnd()}`))
  app.process().stderr.on('data', (d) => {
    const text = String(d).trimEnd()
    if (!NOISE.test(text))
      note(`[main:err] ${text}`)
  })
  const page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      note(`[renderer:${m.type()}] ${m.text()}`)
  })
  page.on('pageerror', e => note(`[pageerror] ${e.message}`))
  return { app, page, log, root }
}
