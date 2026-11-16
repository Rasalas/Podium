// Takes the README screenshots from the real app with a deck made from the built-in template.
// Needs a build (`npx electron-vite build`), the development runtime and a display:
//   xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/screenshots.mjs
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchPodium } from '../tests/e2e/app/launch.mjs'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'podium-shots-'))
const { app, page } = await launchPodium({ profile })
const shot = name => page.screenshot({ path: join(out, `${name}.png`) })
const pause = ms => page.waitForTimeout(ms)

try {
  await page.getByRole('button', { name: /Neue Präsentation/ }).first().click({ timeout: 120_000 })
  await page.getByPlaceholder(/Jahresrückblick/).fill('Jahresrückblick Wanderverein')
  await pause(600)
  await shot('new-deck')
  await page.getByRole('button', { name: 'Erstellen' }).click()
  const canvas = page.frameLocator('iframe').first()
  await canvas.locator('[data-pd-block]').first().waitFor({ timeout: 120_000 })
  await pause(5000)

  // Notes with click steps on the second slide.
  await page.locator('[aria-label^="Folie 2"]').first().click()
  await canvas.locator('[data-slidev-no="2"] .slidev-layout').waitFor()
  await page.locator('.notes .cm-content').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Erst das Wichtigste: Wir waren 14 Mal unterwegs.')
  await page.getByTestId('notes-insert-click').click()
  await page.keyboard.type('Die längste Tour ging über 28 Kilometer.')
  await page.getByTestId('notes-insert-click').click()
  await page.keyboard.type('Danke an alle, die Kuchen mitgebracht haben.')
  await pause(1500)

  // Typing straight on the slide.
  const item = canvas.locator('[data-slidev-no="2"] [data-pd-block="listitem"]').first()
  await item.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('14 Wanderungen, bei jedem Wetter')
  await pause(400)
  await shot('editor')
  await page.keyboard.press('Enter')
  await pause(300)
  await page.keyboard.press('Escape')
  await pause(1200)

  await page.getByRole('button', { name: /Layout ändern/ }).click()
  await pause(900)
  await shot('layouts')
  await page.keyboard.press('Escape')
  await pause(400)

  // Slidev's own presenter view, as the speaker sees it.
  const deckId = await page.evaluate(async () => (await window.podium.getRecentDecks())[0].path).then(path => page.evaluate(async p => (await window.podium.openDeck(p)).snapshot.deckId, path))
  await page.evaluate(id => window.podium.startPresentation(id, { from: 2, presenterView: true }), deckId)
  let presenter
  for (let i = 0; i < 100 && !presenter; i++) {
    presenter = app.windows().find(w => w.url().includes('/presenter/'))
    await pause(100)
  }
  await presenter.waitForLoadState('networkidle')
  await presenter.waitForTimeout(2500)
  await presenter.screenshot({ path: join(out, 'presenter.png') })
  await page.evaluate(() => window.podium.stopPresentation())
}
finally {
  await app.close()
  rmSync(profile, { recursive: true, force: true })
}
console.log(`Screenshots in ${out}`)
