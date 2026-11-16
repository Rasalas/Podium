/**
 * Presenting in the real (built) app: the audience window shows Slidev's play page, the
 * presenter window Slidev's own presenter page, and Slidev keeps them in sync.
 *
 * Run: npx electron-vite build
 *      xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test -c tests/e2e/app/playwright.config.ts
 *
 * One display here, so the presenter window is asked for explicitly and shares the screen with
 * the audience window. Uses a throwaway profile and a copy of tests/fixtures/windows.
 */
import type { ElectronApplication, Page } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
// @ts-expect-error plain JS helper shared with ad-hoc driver scripts
import { launchPodium } from './launch.mjs'

interface Position { no: number, clicks: number, clicksTotal: number, total: number }
interface State { active: boolean, position?: Position, startedAt?: number, windowed?: boolean }

const ROOT = resolve(import.meta.dirname, '../../..')

let profile: string
let app: ElectronApplication
let main: Page
let presenter: Page
let audience: Page
let deckId: string
let serverUrl: string

const events = () => main.evaluate(() => (window as any).__events as State[])
/** Slide and click step a Slidev page shows, e.g. "2/1". */
async function shown(target: Page): Promise<string> {
  return target.evaluate(() => {
    const nav = (window as any).__slidev__?.nav
    return nav ? `${nav.currentSlideNo}/${nav.clicks}` : ''
  }).catch(() => '')
}

async function position(): Promise<Position | undefined> {
  return (await main.evaluate(() => (window as any).podium.getPresentationState()) as State).position
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(240_000)
  profile = mkdtempSync(join(tmpdir(), 'podium-present-'))
  const deckDir = join(profile, 'deck')
  mkdirSync(deckDir, { recursive: true })
  copyFileSync(join(ROOT, 'tests/fixtures/windows/slides.md'), join(deckDir, 'slides.md'))
  // Passing the deck on the command line opens it in the editor like a double click would.
  ;({ app, page: main } = await launchPodium({ profile, args: [deckDir] }))
  await expect(main.frameLocator('iframe').first().locator('[data-slidev-no="1"] .slidev-layout')).toBeVisible({ timeout: 180_000 })
  deckId = await main.evaluate(async dir => (await (window as any).podium.openDeck(dir)).snapshot.deckId, deckDir)
  serverUrl = await main.evaluate(async id => (await (window as any).podium.getServerStatus(id)).url, deckId)
  await main.evaluate(() => {
    const w = window as any
    w.__events = []
    w.podium.on('present:state', (s: State) => w.__events.push(s))
  })
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  if (profile)
    rmSync(profile, { recursive: true, force: true })
})

/** Is the editor window on screen? It is the one window that does not show a page of the Slidev server. */
function editorVisible(): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, url) =>
    BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith(url) && !w.webContents.isOffscreen())!.isVisible(), serverUrl)
}

test('start opens the audience window and Slidev\'s presenter page', async () => {
  const state = await main.evaluate(id => (window as any).podium.startPresentation(id, { from: 1, presenterView: true }), deckId) as State
  expect(state.active).toBe(true)
  expect(state.startedAt).toBeGreaterThan(Date.now() - 60_000)
  expect(state.position).toEqual({ no: 1, clicks: 0, clicksTotal: 0, total: 5 })

  await expect.poll(() => app.windows().some(w => w.url() === `${serverUrl}/presenter/1`)).toBe(true)
  presenter = app.windows().find(w => w.url() === `${serverUrl}/presenter/1`)!
  audience = app.windows().find(w => w.url() === `${serverUrl}/1`)!
  expect(audience).toBeTruthy()
  await expect.poll(() => shown(presenter)).toBe('1/0')
  await expect.poll(() => shown(audience)).toBe('1/0')
  await expect(presenter.getByText('Notiz eins')).toBeVisible()
  // The editor steps aside, so the presenter view is the only Podium window on this screen.
  await expect.poll(editorVisible).toBe(false)
  // Each Slidev page reports its position once after loading; let those settle before steering.
  await presenter.waitForTimeout(1000)
})

test('clicker keys in the presenter page step through clicks and the audience follows', async () => {
  await presenter.keyboard.press('PageDown')
  await expect.poll(() => shown(audience)).toBe('2/0')
  await expect.poll(position).toEqual({ no: 2, clicks: 0, clicksTotal: 3, total: 5 })
  await expect(presenter.getByText('Notiz zwei')).toBeVisible()
  await main.waitForTimeout(300)

  for (const clicks of [1, 2, 3]) {
    await presenter.keyboard.press('PageDown')
    await expect.poll(() => shown(presenter)).toBe(`2/${clicks}`)
    await expect.poll(() => shown(audience)).toBe(`2/${clicks}`)
    await expect.poll(position).toMatchObject({ no: 2, clicks })
    // Slidev's pages echo each position back; a person presses slower than that.
    await main.waitForTimeout(300)
  }

  await presenter.keyboard.press('PageUp')
  await expect.poll(() => shown(audience)).toBe('2/2')
  // The editor's banner follows too.
  await expect(main.getByTestId('present-where')).toHaveText('Folie 2 von 5')

  const seen = (await events()).filter(e => e.position?.no === 2).map(e => e.position!.clicks)
  expect(seen).toEqual(expect.arrayContaining([0, 1, 2, 3]))
})

test('navigation in the audience window itself is followed', async () => {
  await audience.evaluate(() => (window as any).__slidev__.nav.go(4))
  await expect.poll(position).toEqual({ no: 4, clicks: 0, clicksTotal: 0, total: 5 })
  await expect(main.getByTestId('present-where')).toHaveText('Folie 4 von 5')
  // Slidev syncs both ways on this computer: the presenter page follows and goes on from there.
  await expect.poll(() => shown(presenter)).toBe('4/0')
  await presenter.keyboard.press('PageDown')
  await expect.poll(() => shown(audience)).toBe('5/0')
  await expect.poll(position).toMatchObject({ no: 5, clicks: 0 })
})

test('slides picked in the editor do not move the presentation', async () => {
  const canvas = main.frames().find(f => f.url().includes('embedded'))!
  await canvas.evaluate(() => (window as any).__slidev__.nav.go(1))
  await main.waitForTimeout(1500)
  expect(await shown(audience)).toBe('5/0')
  expect(await shown(presenter)).toBe('5/0')
})

test('Escape in the presenter page ends the presentation and closes its windows', async () => {
  // A real key press: Playwright's keyboard events skip Electron's before-input-event.
  await app.evaluate(({ BrowserWindow }, url) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(`${url}/presenter/`))!
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  }, serverUrl)
  await expect.poll(async () => (await main.evaluate(() => (window as any).podium.getPresentationState()) as State).active).toBe(false)
  await expect.poll(() => presenter.isClosed() && audience.isClosed()).toBe(true)
  expect((await events()).at(-1)?.active).toBe(false)
  await expect(main.getByTestId('present-where')).toHaveCount(0)
  await expect.poll(editorVisible).toBe(true)
})

test('windowed mode for video calls: a normal window with a fixed title, driven from the presenter page', async () => {
  const state = await main.evaluate(id => (window as any).podium.startPresentation(id, { from: 2, windowed: true }), deckId) as State
  expect(state).toMatchObject({ active: true, windowed: true, position: { no: 2, clicks: 0 } })

  await expect.poll(() => app.windows().some(w => w.url() === `${serverUrl}/presenter/2`)).toBe(true)
  presenter = app.windows().find(w => w.url() === `${serverUrl}/presenter/2`)!
  audience = app.windows().find(w => w.url() === `${serverUrl}/2`)!
  expect(audience).toBeTruthy()
  // Give Slidev time to set its own document title; ours must stay.
  await audience.waitForTimeout(1000)
  const info = await app.evaluate(({ BrowserWindow }, url) => {
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === `${url}/2`)!
    return { title: w.getTitle(), fullscreen: w.isFullScreen(), resizable: w.isResizable(), onTop: w.isAlwaysOnTop(), size: w.getContentSize(), throttled: w.webContents.getBackgroundThrottling() }
  }, serverUrl)
  const { size, ...rest } = info
  expect(rest).toEqual({ title: 'Windows Fixture – Präsentation', fullscreen: false, resizable: true, onTop: false, throttled: false })
  // 1280×720, fitted to the deck's 980×552.
  expect(size[0]).toBeGreaterThanOrEqual(1270)
  expect(size[0]).toBeLessThanOrEqual(1280)
  expect(Math.abs(size[1] - 720)).toBeLessThanOrEqual(2)

  await expect.poll(() => shown(presenter)).toBe('2/0')
  await expect.poll(position).toMatchObject({ clicksTotal: 3 })
  await expect.poll(() => presenter.evaluate(() => (window as any).__slidev__?.nav?.clicksTotal)).toBe(3)
  await presenter.waitForTimeout(1000)
  await presenter.keyboard.press('PageDown')
  await expect.poll(() => shown(audience)).toBe('2/1')
  // Slidev's pages echo each position back; a person presses slower than that.
  await main.waitForTimeout(300)
  await presenter.keyboard.press('ArrowRight')
  await expect.poll(() => shown(audience)).toBe('2/2')

  // Closing either window ends the presentation.
  await audience.close()
  await expect.poll(async () => (await main.evaluate(() => (window as any).podium.getPresentationState()) as State).active).toBe(false)
  await expect.poll(() => presenter.isClosed()).toBe(true)
})
