/**
 * Phone as remote control, in the real (built) app: switch Slidev's remote mode on through
 * Tailscale, open the returned link in a phone-sized Chromium over this machine's Tailscale
 * address, and steer the presentation from Slidev's presenter page there.
 *
 * Run: npx electron-vite build
 *      xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test -c tests/e2e/app/playwright.config.ts
 *
 * Needs a Tailscale address on this machine and skips without one. Screenshots of the phone
 * page and the dialog go to PODIUM_REMOTE_SHOTS, or the test's output folder.
 */
import type { Browser, ElectronApplication, Page } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, expect, test } from '@playwright/test'
import { remoteAddresses } from '../../../src/main/remote'
// @ts-expect-error plain JS helper shared with ad-hoc driver scripts
import { launchPodium } from './launch.mjs'

interface Position { no: number, clicks: number, clicksTotal: number, total: number }
interface State { active: boolean, position?: Position }
interface Info { mode: string, tailscaleAddress?: string, lanAddresses: string[], url?: string, qrSvg?: string }

const ROOT = resolve(import.meta.dirname, '../../..')
const { tailscale } = remoteAddresses()

let profile: string
let shots: string
let app: ElectronApplication
let main: Page
let browser: Browser
let phone: Page
let deckId: string
let serverUrl: string
let remoteUrl: string
let password: string

const podium = <T>(fn: string, ...args: unknown[]) =>
  main.evaluate(([name, rest]) => (window as any).podium[name as string](...(rest as unknown[])), [fn, args] as const) as Promise<T>

/** The audience window: Slidev's play page (not the thumbnail window, not the presenter page). */
const audience = () => app.windows().find(w => /^http:\/\/localhost:\d+\/\d+(?:\?|$)/.test(w.url()) && !w.url().includes('embedded'))
const presenter = () => app.windows().find(w => w.url().startsWith(`${serverUrl}/presenter/`))

/** Slide and click step a Slidev page shows, e.g. "2/1". */
async function shown(page: Page | undefined): Promise<string> {
  if (!page)
    return ''
  return page.evaluate(() => {
    const nav = (window as any).__slidev__?.nav
    return nav ? `${nav.currentSlideNo}/${nav.clicks}` : ''
  }).catch(() => '')
}

test.describe.configure({ mode: 'serial' })
test.skip(!tailscale, 'This machine has no Tailscale address (100.64.0.0/10). The phone remote spec reaches the app over Tailscale and needs one.')

test.beforeAll(async () => {
  test.setTimeout(240_000)
  profile = mkdtempSync(join(tmpdir(), 'podium-remote-'))
  shots = process.env.PODIUM_REMOTE_SHOTS || test.info().outputPath('shots')
  mkdirSync(shots, { recursive: true })
  const deckDir = join(profile, 'deck')
  mkdirSync(deckDir, { recursive: true })
  copyFileSync(join(ROOT, 'tests/fixtures/windows/slides.md'), join(deckDir, 'slides.md'))
  ;({ app, page: main } = await launchPodium({ profile, args: [deckDir] }))
  await expect(main.frameLocator('iframe').first().locator('[data-slidev-no="1"] .slidev-layout')).toBeVisible({ timeout: 180_000 })
  deckId = (await podium<{ snapshot: { deckId: string } }>('openDeck', deckDir)).snapshot.deckId
  serverUrl = (await podium<{ url: string }>('getServerStatus', deckId)).url
  browser = await chromium.launch()
})

// What the Slidev server said, when a test fails: reloads and restarts show up there.
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    const status = await podium<{ state: string, log?: string[] }>('getServerStatus', deckId).catch(() => undefined)
    console.log(`server ${status?.state}:\n${(status?.log ?? []).join('\n')}`)
  }
})

test.afterAll(async () => {
  await browser?.close().catch(() => {})
  await app?.close().catch(() => {})
  if (profile)
    rmSync(profile, { recursive: true, force: true })
})

test('the dialog offers Tailscale as the recommended way, off by default', async () => {
  await main.getByRole('button', { name: /Präsentieren: Optionen/ }).click()
  await main.getByTestId('menu-remote').click()
  const dialog = main.getByTestId('remote-dialog')
  await expect(dialog).toBeVisible()
  await expect(main.getByTestId('remote-off').locator('input')).toBeChecked()
  await expect(main.getByTestId('remote-tailscale')).toContainText('Empfohlen')
  await expect(main.getByTestId('remote-tailscale')).toContainText('Nur deine eigenen Geräte kommen ran.')
  await expect(main.getByTestId('remote-tailscale').locator('input')).toBeEnabled()
  await expect(main.getByTestId('remote-lan')).toContainText('besser Tailscale nehmen.')
  await expect(dialog).toContainText('Das dauert ein paar Sekunden.')
  await main.locator('.modal').screenshot({ path: join(shots, 'dialog-off.png') })
  await main.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(main.getByTestId('remote-indicator')).toHaveCount(0)
})

test('switching on during a presentation brings both windows back to their slide', async () => {
  await podium('startPresentation', deckId, { from: 2, presenterView: true })
  await expect.poll(() => shown(presenter())).toBe('2/0')
  // Keys count once the slide mounted and registered its click steps, in both pages.
  const clicksTotal = (page: Page | undefined) => page?.evaluate(() => (window as any).__slidev__?.nav?.clicksTotal).catch(() => 0)
  await expect.poll(() => clicksTotal(presenter())).toBe(3)
  await expect.poll(() => clicksTotal(audience())).toBe(3)
  // Each Slidev page reports its position once after loading; let those settle before steering.
  await main.waitForTimeout(1000)
  await presenter()!.keyboard.press('PageDown')
  await expect.poll(() => shown(audience())).toBe('2/1')
  // Slidev's pages echo each position back; a person presses slower than that.
  await main.waitForTimeout(300)
  await presenter()!.keyboard.press('PageDown')
  await expect.poll(() => shown(audience())).toBe('2/2')
  // The app samples the audience's position every 250 ms; switch once it has seen this one.
  await expect.poll(async () => (await podium<State>('getPresentationState')).position).toMatchObject({ no: 2, clicks: 2 })

  const info = await podium<Info>('setRemote', deckId, 'tailscale')
  expect(info.mode).toBe('tailscale')
  expect(info.tailscaleAddress).toBe(tailscale)
  const port = new URL(serverUrl).port
  expect(info.url).toMatch(new RegExp(`^http://${tailscale!.replace(/\./g, '\\.')}:${port}/presenter/\\?password=[\\w-]{22}$`))
  expect(info.qrSvg).toMatch(/^<svg /)
  remoteUrl = info.url!
  password = new URL(remoteUrl).searchParams.get('password')!

  // Same port; the audience is back where it was, the laptop's presenter page has the password.
  expect((await podium<{ url: string }>('getServerStatus', deckId)).url).toBe(serverUrl)
  await expect.poll(() => shown(audience()), { timeout: 30_000 }).toBe('2/2')
  await expect.poll(() => presenter()?.url() ?? '').toContain(`password=${password}`)
  await expect.poll(() => shown(presenter())).toBe('2/2')
  await expect.poll(async () => (await podium<State>('getPresentationState')).position).toMatchObject({ no: 2, clicks: 2 })
  await expect(main.getByTestId('remote-indicator')).toBeVisible()

  // The laptop's presenter page still drives the audience.
  await presenter()!.keyboard.press('PageDown')
  await expect.poll(() => shown(audience())).toBe('2/3')
})

test('the phone opens Slidev\'s presenter page and drives the laptop', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' })
  phone = await context.newPage()
  const prompts: string[] = []
  phone.on('dialog', (d) => {
    prompts.push(d.message())
    void d.dismiss()
  })
  await phone.goto(remoteUrl)
  // Joining must not move the talk: the phone picks up where the audience is.
  await expect.poll(() => shown(phone)).toBe('2/3')
  expect(phone.url()).toContain('/presenter/')
  await expect(phone.getByText('Notiz zwei')).toBeVisible()
  expect(await shown(audience())).toBe('2/3')
  await phone.screenshot({ path: join(shots, 'phone-presenter.png') })

  // Slidev's "next" arrow in the presenter's navigation bar.
  await phone.locator('button:has(.i-carbon\\:arrow-right)').first().tap()
  await expect.poll(() => shown(audience())).toBe('3/0')
  await expect.poll(() => shown(phone)).toBe('3/0')
  await expect.poll(async () => (await podium<State>('getPresentationState')).position).toMatchObject({ no: 3, clicks: 0 })
  await expect(main.getByTestId('present-where')).toHaveText('Folie 3 von 5')
  expect(prompts).toEqual([])
  await phone.screenshot({ path: join(shots, 'phone-presenter-next.png') })
})

test('a wrong password does not get a phone into presenter mode', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const stranger = await context.newPage()
  stranger.on('dialog', d => void d.dismiss())
  await stranger.goto(remoteUrl.replace(/password=[^&]+/, 'password=wrong'))
  await expect.poll(() => stranger.url()).not.toContain('/presenter/')
  await context.close()
})

test('switching off keeps the presentation going and shuts the phone out', async () => {
  const off = await podium<Info>('setRemote', deckId, 'off')
  expect(off.mode).toBe('off')
  expect(off.url).toBeUndefined()
  await expect(main.getByTestId('remote-indicator')).toHaveCount(0)
  await expect.poll(() => shown(audience()), { timeout: 30_000 }).toBe('3/0')
  // The laptop's presenter page works again without a password.
  await expect.poll(() => presenter()?.url() ?? '').toBe(`${serverUrl}/presenter/3`)
  await expect.poll(() => shown(presenter())).toBe('3/0')
  // Each Slidev page reports its position once after loading; let those settle before steering.
  await main.waitForTimeout(1000)
  await presenter()!.keyboard.press('PageDown')
  await expect.poll(() => shown(audience())).toBe('4/0')
  // Bound to localhost again: the Tailscale address does not answer.
  const reply = await phone.request.get(remoteUrl, { timeout: 5000 }).then(r => r.status()).catch(() => 'refused')
  expect(reply).toBe('refused')
  await podium('stopPresentation')
})

test('the dialog shows the QR code and link while on', async () => {
  // Back in the editor after the presentation: it is hidden while one runs.
  const on = await podium<Info>('setRemote', deckId, 'tailscale')
  await main.getByTestId('remote-indicator').click()
  await expect(main.getByTestId('remote-tailscale').locator('input')).toBeChecked()
  await expect(main.getByTestId('remote-qr')).toBeVisible()
  await expect(main.getByTestId('remote-url')).toHaveText(on.url!)
  const box = await main.getByTestId('remote-qr').boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(200)
  await main.locator('.modal').screenshot({ path: join(shots, 'dialog-on.png') })
  await main.keyboard.press('Escape')
  await podium('setRemote', deckId, 'off')
})
