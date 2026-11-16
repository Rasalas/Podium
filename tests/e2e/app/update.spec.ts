/**
 * The update check in the real app against a feed served from this machine. A development
 * build on Linux cannot replace itself, so it takes the "there is a new version, get it
 * here" path: the check, the note in the window and the settings are what this covers.
 * Loading and installing are covered by the unit tests of the feed and the install script,
 * and by updating a released build on a Mac.
 */
import type { ElectronApplication, Page } from '@playwright/test'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
// @ts-expect-error plain JS helper without types
import { launchPodium } from './launch.mjs'

let profile: string
let app: ElectronApplication
let page: Page
let server: Server
let feedVersion = '99.0.0'
let requests = 0

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  server = createServer((req, res) => {
    requests++
    if (req.url !== '/latest-linux.yml') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/yaml' })
    res.end(`version: ${feedVersion}\nfiles:\n  - url: podium_${feedVersion}_amd64.deb\n    sha512: YQ==\n    size: 1\n`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  profile = mkdtempSync(join(tmpdir(), 'podium-update-'))
  ;({ app, page } = await launchPodium({ profile, env: { PODIUM_UPDATE_FEED: `http://127.0.0.1:${port}` } }))
  await page.getByRole('button', { name: /Neue Präsentation/ }).first().waitFor({ timeout: 120_000 })
})

test.afterAll(async () => {
  await app?.close()
  server?.close()
  rmSync(profile, { recursive: true, force: true })
})

test('nothing shows while there is no newer version', async () => {
  feedVersion = '0.0.1'
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  await page.getByTestId('update-check').click()
  await expect(page.getByTestId('update-status')).toHaveText('Podium ist aktuell.')
  expect(requests).toBe(1)
  await expect(page.getByTestId('update-note')).toHaveCount(0)
})

test('a newer version shows as a quiet note with the way to get it', async () => {
  feedVersion = '99.0.0'
  await page.getByTestId('update-check').click()
  await expect(page.getByTestId('update-status')).toHaveText('Version 99.0.0 ist da.')
  await page.getByRole('button', { name: 'Schließen' }).last().click()
  const note = page.getByTestId('update-note')
  await expect(note).toHaveText('Neue Version')
  await note.click()
  await expect(page.getByRole('dialog')).toContainText('Podium 99.0.0')
  await expect(page.getByRole('button', { name: 'Herunterladen' })).toBeVisible()
  const state = await page.evaluate(() => window.podium!.getUpdateState())
  expect(state).toMatchObject({ status: 'available', version: '99.0.0' })
  expect(state.downloadUrl).toMatch(/\/podium_99\.0\.0_amd64\.deb$/)
  await page.getByRole('button', { name: 'Später' }).click()
})

test('the setting switches the background checks off and on', async () => {
  await page.getByRole('button', { name: 'Einstellungen' }).click()
  const box = page.getByLabel('Neue Versionen automatisch laden und beim Beenden installieren')
  await expect(box).toBeChecked()
  await box.uncheck()
  expect((await page.evaluate(() => window.podium!.getSettings())).autoUpdate).toBe(false)
  await box.check()
  expect((await page.evaluate(() => window.podium!.getSettings())).autoUpdate).toBe(true)
})
