/**
 * Adding a template of one's own in the real app: from the new-presentation dialog, used for a
 * deck, listed in the settings, removed again. The source is a theme folder of the fixtures;
 * fetching from git and zip is covered by tests/unit/templates/import.test.ts.
 */
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
// @ts-expect-error plain JS helper without types
import { launchPodium } from './launch.mjs'

const THEME = resolve(import.meta.dirname, '../../fixtures/workspace-theme/packages/slidev-theme-hausfarbe')
let profile: string
let app: ElectronApplication
let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  profile = mkdtempSync(join(tmpdir(), 'podium-templates-'))
  ;({ app, page } = await launchPodium({ profile }))
  await page.getByRole('button', { name: /Neue Präsentation/ }).first().waitFor({ timeout: 120_000 })
})

test.afterAll(async () => {
  // The development runtime is shared between test runs: never leave the template in it.
  await page?.evaluate(() => window.podium!.removeTemplate('slidev-theme-hausfarbe')).catch(() => {})
  await app?.close()
  rmSync(profile, { recursive: true, force: true })
})

test('a wrong source is explained in the dialog and adds nothing', async () => {
  await page.getByRole('button', { name: /Neue Präsentation/ }).first().click()
  await page.getByTestId('add-template').click()
  await page.getByTestId('template-source').fill(join(profile, 'gibt-es-nicht'))
  await page.getByTestId('template-add').click()
  await expect(page.getByTestId('template-problem')).toHaveText('Diesen Ordner gibt es nicht.')
  expect(await page.evaluate(() => window.podium!.listAddedTemplates())).toEqual([])
})

test('a template from a folder becomes a choice for new presentations', async () => {
  await page.getByTestId('template-source').fill(THEME)
  await page.getByTestId('template-add').click()
  await expect(page.getByTestId('template-source')).toHaveCount(0, { timeout: 60_000 })
  // Back in the new-presentation dialog the new template is there and already chosen.
  const tile = page.getByRole('radio', { name: /hausfarbe/i })
  await expect(tile).toHaveAttribute('aria-checked', 'true')
  const added = await page.evaluate(() => window.podium!.listAddedTemplates())
  expect(added).toMatchObject([{ name: 'slidev-theme-hausfarbe', version: '0.0.1', source: THEME }])
})

test('a presentation made with it uses its layouts', async () => {
  await page.getByPlaceholder(/Jahresrückblick/).fill('Mit eigener Vorlage')
  await page.getByRole('button', { name: 'Erstellen' }).click()
  const canvas = page.frameLocator('iframe').first()
  await expect(canvas.locator('[data-slidev-no="1"] .slidev-layout')).toBeVisible({ timeout: 120_000 })
  const deckDir = join(profile, 'decks', 'Mit eigener Vorlage')
  expect(readFileSync(join(deckDir, 'slides.md'), 'utf8')).toContain('theme: hausfarbe')
  const layouts = await page.evaluate(async (dir) => {
    const opened = await window.podium!.openDeck(dir)
    return (await window.podium!.getLayouts(opened.snapshot.deckId)).map(l => l.name)
  }, deckDir)
  expect(layouts).toContain('merksatz')
  await page.getByRole('button', { name: 'Zur Startseite' }).click()
})

test('the settings list it and can remove it', async () => {
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  const row = page.getByTestId('added-template')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(THEME)
  page.once('dialog', dialog => void dialog.accept())
  await row.getByRole('button', { name: /entfernen/i }).click()
  await expect(row).toHaveCount(0)
  expect(await page.evaluate(() => window.podium!.listAddedTemplates())).toEqual([])
  const templates = await page.evaluate(() => window.podium!.listTemplates())
  expect(templates.some(t => t.packageName === 'slidev-theme-hausfarbe')).toBe(false)
})
