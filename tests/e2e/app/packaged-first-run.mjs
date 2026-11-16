// Release check: starts the packaged app (release/linux-unpacked) with an empty profile and a
// deck to open, the way a double-clicked file arrives. The deck has to wait for the first-run
// setup to download Slidev and then open by itself. After that a new deck is created.
// Usage: xvfb-run -a node tests/e2e/app/packaged-first-run.mjs   (needs internet, about a minute)
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const profile = mkdtempSync(join(tmpdir(), 'podium-packaged-'))
// A deck that brings its own theme, so this also covers themes from the deck's folder in a packaged app.
const deck = join(profile, 'deck')
cpSync(resolve(import.meta.dirname, '../../fixtures/workspace-theme'), deck, { recursive: true })
const started = Date.now()
const seconds = () => Math.round((Date.now() - started) / 1000)
const app = await electron.launch({
  executablePath: resolve(import.meta.dirname, '../../../release/linux-unpacked/podium'),
  args: ['--no-sandbox', '--disable-gpu', deck],
  env: { ...process.env, PODIUM_USER_DATA: join(profile, 'userdata'), PODIUM_DECK_DIR: join(profile, 'decks'), PODIUM_RUNTIME_DIR: '', PODIUM_NO_UPDATE: '1', LANG: 'de_DE.UTF-8' },
})
let ok = false
try {
  const page = await app.firstWindow()
  await page.frameLocator('iframe').first().locator('[data-slidev-no="1"] h1').filter({ hasText: 'Vortrag mit eigener Vorlage' }).waitFor({ timeout: 300_000 })
  console.log(`setup finished and the requested deck opened after ${seconds()} s`)
  await page.getByRole('button', { name: 'Zur Startseite' }).click()
  await page.getByRole('button', { name: /Neue Präsentation/ }).first().click({ timeout: 60_000 })
  await page.getByPlaceholder(/Jahresrückblick/).fill('Paket Test')
  await page.getByRole('button', { name: 'Erstellen' }).click()
  await page.frameLocator('iframe').first().locator('[data-pd-block]').first().waitFor({ timeout: 180_000 })
  console.log(`slide on the canvas after ${seconds()} s`)
  ok = true
}
catch (error) {
  console.error(`FAILED after ${seconds()} s: ${String(error.message).split('\n')[0]}`)
}
finally {
  await app.close()
  rmSync(profile, { recursive: true, force: true })
}
process.exit(ok ? 0 : 1)
