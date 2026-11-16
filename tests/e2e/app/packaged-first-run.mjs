// Release check: starts the packaged app (release/linux-unpacked) with an empty profile,
// waits for the first-run setup to download Slidev, creates a deck and waits for the slide.
// Usage: xvfb-run -a node tests/e2e/app/packaged-first-run.mjs   (needs internet, about a minute)
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const profile = mkdtempSync(join(tmpdir(), 'podium-packaged-'))
const started = Date.now()
const seconds = () => Math.round((Date.now() - started) / 1000)
const app = await electron.launch({
  executablePath: resolve(import.meta.dirname, '../../../release/linux-unpacked/podium'),
  args: ['--no-sandbox', '--disable-gpu'],
  env: { ...process.env, PODIUM_USER_DATA: join(profile, 'userdata'), PODIUM_DECK_DIR: join(profile, 'decks'), PODIUM_RUNTIME_DIR: '', LANG: 'de_DE.UTF-8' },
})
let ok = false
try {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: /Neue Präsentation/ }).first().click({ timeout: 300_000 })
  console.log(`setup finished after ${seconds()} s`)
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
