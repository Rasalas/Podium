/**
 * The editing flows a first-time user goes through, in the real app against a real
 * Slidev server: create a deck from the built-in template, type on the slide, add
 * things, undo, and see outside changes arrive.
 *
 * Needs a built app (`npx electron-vite build`) and a display (`xvfb-run`).
 */
import type { ElectronApplication, FrameLocator, Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
// @ts-expect-error plain JS helper without types
import { launchPodium } from './launch.mjs'

const TITLE = 'Editor Test'
let profile: string
let app: ElectronApplication
let page: Page
let canvas: FrameLocator
let deckDir: string
let deckId: string

const markdown = () => readFileSync(join(deckDir, 'slides.md'), 'utf8')
const slideBlocks = (no: number, kind: string) => canvas.locator(`[data-slidev-no="${no}"] [data-pd-block="${kind}"]`)

async function selectSlide(no: number) {
  await page.getByRole('option', { name: new RegExp(`^Folie ${no}\\b`) }).or(page.locator(`[aria-label^="Folie ${no}"]`)).first().click()
  await expect(canvas.locator(`[data-slidev-no="${no}"] .slidev-layout`)).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  profile = mkdtempSync(join(tmpdir(), 'podium-e2e-'))
  ;({ app, page } = await launchPodium({ profile, env: { PODIUM_EXPORT_DIR: join(profile, 'exports') } }))
  await page.getByRole('button', { name: /Neue Präsentation/ }).first().click({ timeout: 120_000 })
  await page.getByPlaceholder(/Jahresrückblick/).fill(TITLE)
  await page.getByRole('button', { name: 'Erstellen' }).click()
  canvas = page.frameLocator('iframe').first()
  await expect(canvas.locator('[data-pd-block]').first()).toBeVisible({ timeout: 120_000 })
  deckDir = join(profile, 'decks', TITLE)
  deckId = await page.evaluate(async dir => (await window.podium!.openDeck(dir)).snapshot.deckId, deckDir)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(profile, { recursive: true, force: true })
})

test('a new deck comes with the template, agent files and thumbnails', async () => {
  expect(markdown()).toContain('theme: klar')
  expect(markdown()).toContain(`# ${TITLE}`)
  expect(readFileSync(join(deckDir, 'AGENTS.md'), 'utf8')).toContain('two-cols')
  await expect(page.locator('.slide-list img, [class*="thumb"] img').first()).toBeVisible({ timeout: 30_000 })
})

test('typing on the slide changes one line in the file', async () => {
  const before = markdown()
  await canvas.locator('h1[data-pd-block]').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('Getippter Titel')
  await page.keyboard.press('Enter')
  await expect.poll(markdown).toContain('# Getippter Titel')
  const changed = markdown().split('\n').filter((line, i) => line !== before.split('\n')[i])
  expect(changed).toEqual(['# Getippter Titel'])
})

test('Enter in a list item adds a new item that takes the caret', async () => {
  await selectSlide(2)
  const first = slideBlocks(2, 'listitem').first()
  const original = (await first.innerText()).trim()
  await first.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' plus')
  await page.keyboard.press('Enter')
  await expect.poll(markdown).toContain(`- ${original} plus\n- \n`)
  // The new empty item is being edited: typing lands in it.
  await expect(canvas.locator('[data-pd-editing]')).toHaveCount(1)
  await page.keyboard.type('Neuer Punkt')
  // Clicking elsewhere commits. (Escape would discard the typed text.)
  await canvas.locator('[data-slidev-no="2"] h1').click()
  await page.keyboard.press('Escape')
  await expect.poll(markdown).toContain(`- ${original} plus\n- Neuer Punkt\n`)
})

test('undo takes the last change back', async () => {
  await page.getByRole('button', { name: /Rückgängig/ }).first().click()
  await expect.poll(markdown).not.toContain('- Neuer Punkt')
})

test('a new slide starts with placeholder text and can change its layout', async () => {
  const countBefore = await page.evaluate(async id => (await window.podium!.getDeck(id)).slides.length, deckId)
  await page.getByRole('button', { name: /^Neue Folie$/ }).first().click()
  await expect.poll(() => page.evaluate(async id => (await window.podium!.getDeck(id)).slides.length, deckId)).toBe(countBefore + 1)
  await expect(slideBlocks(3, 'heading').first()).toBeVisible()

  await page.getByRole('button', { name: /Layout ändern/ }).click()
  await page.getByRole('button', { name: /^Zwei Spalten$/ }).first().click()
  await expect.poll(markdown).toContain('layout: two-cols')
  await expect.poll(markdown).toContain('::right::')
})

test('inserted text is selected, so typing replaces the placeholder', async () => {
  await page.getByRole('button', { name: /^Text/ }).first().click()
  await expect(canvas.locator('[data-pd-editing]')).toBeVisible()
  await page.keyboard.type('Eingefügter Absatz')
  await page.keyboard.press('Enter')
  await expect.poll(markdown).toContain('Eingefügter Absatz')
})

test('speaker notes are saved as a comment at the end of the slide', async () => {
  const notes = page.locator('.notes .cm-content')
  await notes.click()
  await page.keyboard.type('Notiz aus dem Test')
  await expect.poll(markdown).toContain('<!-- Notiz aus dem Test -->')
})

test('a click marker goes in with a button and shows as a numbered chip', async () => {
  await page.getByTestId('notes-insert-click').click()
  await page.keyboard.type('nach dem Klick')
  // The file gets Slidev's plain marker on a line of its own.
  await expect.poll(markdown).toContain('<!--\nNotiz aus dem Test\n[click] nach dem Klick\n-->')
  await expect(page.locator('.notes .click-chip')).toHaveText('Klick 1')
  // The caret steps over the chip as one piece, and one Backspace removes the whole marker.
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Backspace')
  await expect.poll(markdown).not.toContain('[click]')
  await expect(page.locator('.notes .click-chip')).toHaveCount(0)
})

test('the notes can be dragged taller and keep that height', async () => {
  const panel = page.locator('.notes')
  const before = (await panel.boundingBox())!.height
  const grip = (await page.getByTestId('notes-grip').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2, grip.y - 150, { steps: 5 })
  await page.mouse.up()
  const after = (await panel.boundingBox())!.height
  expect(after).toBeGreaterThan(before + 120)
  expect(await page.evaluate(() => localStorage.getItem('podium.notesHeight'))).toBe(String(Math.round(after)))
})

test('a change made outside the app shows up on the slide and can be undone', async () => {
  await selectSlide(1)
  writeFileSync(join(deckDir, 'slides.md'), markdown().replace('# Getippter Titel', '# Vom Agenten geändert'))
  await expect(canvas.locator('[data-slidev-no="1"] h1')).toHaveText('Vom Agenten geändert', { timeout: 15_000 })
  const canUndo = await page.evaluate(async id => (await window.podium!.getDeck(id)).canUndo, deckId)
  expect(canUndo).toBe(true)
  await page.evaluate(id => window.podium!.undo(id), deckId)
  await expect.poll(markdown).toContain('# Getippter Titel')
})

test('PowerPoint export has one picture per slide and the speaker notes', async () => {
  const slideCount = await page.evaluate(async id => (await window.podium!.getDeck(id)).slides.length, deckId)
  const result = await page.evaluate(id => window.podium!.exportDeck(id, 'pptx'), deckId)
  expect(result.path).toBe(join(profile, 'exports', `${TITLE}.pptx`))
  const files = unzipSync(readFileSync(result.path!))
  const names = Object.keys(files)
  expect(names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(slideCount)
  expect(names.filter(n => /^ppt\/media\/.+\.png$/.test(n))).toHaveLength(slideCount)
  // The note typed earlier in this file sits in PowerPoint's notes of that slide.
  const notes = names.filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map(n => strFromU8(files[n]))
  expect(notes.some(xml => xml.includes('Notiz aus dem Test'))).toBe(true)
})

test('PDF export writes a PDF with one page per slide', async () => {
  const slideCount = await page.evaluate(async id => (await window.podium!.getDeck(id)).slides.length, deckId)
  const result = await page.evaluate(id => window.podium!.exportDeck(id, 'pdf'), deckId)
  const pdf = readFileSync(result.path!)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length).toBe(slideCount)
})

test('the slide check finds no overflow in the template deck', async () => {
  const checks = await page.evaluate(id => window.podium!.checkDeck(id), deckId)
  expect(checks.length).toBeGreaterThan(5)
  expect(checks.filter(c => c.overflow).map(c => c.no)).toEqual([])
})
