/**
 * Real Slidev servers from a private copy of .dev-runtime, ports 3400–3419.
 */
import type { ServerStatus } from '../../../src/shared/types'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkPort } from 'get-port-please'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRuntimeManager } from '../../../src/main/runtime'
import { createSlidevServer } from '../../../src/main/server'
import { extractSlidevError, LineLog, parseStatusLine } from '../../../src/main/server/log'
import { copyDevRuntime, DEV_RUNTIME, makeResources, ROOT, scratchDir } from '../runtime/helpers'

const PORTS: [number, number] = [3400, 3419]
const hasDevRuntime = existsSync(join(DEV_RUNTIME, 'node_modules', '@slidev', 'cli', 'package.json'))

/** PIDs of processes whose command line mentions `needle` (Linux only). */
function processesWith(needle: string): number[] {
  if (!existsSync('/proc/self/cmdline'))
    return []
  const pids: number[] = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid)
      continue
    try {
      if (readFileSync(`/proc/${entry}/cmdline`, 'utf8').includes(needle))
        pids.push(Number(entry))
    }
    catch {}
  }
  return pids
}

async function waitFor(check: () => boolean, ms = 30_000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until)
      throw new Error('timed out waiting')
    await new Promise(r => setTimeout(r, 100))
  }
}

describe('server output parsing', () => {
  it('parses status lines', () => {
    expect(parseStatusLine('@@podium {"event":"ready","port":3412,"url":"http://localhost:3412"}')).toEqual({ event: 'ready', port: 3412, url: 'http://localhost:3412' })
    expect(parseStatusLine('@@podium {"event":"restarting","reason":"theme"}')).toEqual({ event: 'restarting', reason: 'theme' })
    expect(parseStatusLine('@@podium not json')).toBeUndefined()
    expect(parseStatusLine('  VITE ready')).toBeUndefined()
  })

  it('keeps the last 200 lines without colour codes', () => {
    const log = new LineLog(200)
    for (let i = 0; i < 250; i++)
      log.push(`\u001B[32mline ${i}\u001B[39m`)
    expect(log.all()).toHaveLength(200)
    expect(log.all()[0]).toBe('line 50')
    expect(log.feed('out', 'a\nb')).toEqual(['a'])
    expect(log.feed('out', 'c\n')).toEqual(['bc'])
  })

  it('finds Slidev\'s own error message', () => {
    expect(extractSlidevError(['some noise', 'The theme "nope" was not found and cannot prompt for installation'])).toBe('The theme "nope" was not found and cannot prompt for installation')
    expect(extractSlidevError(['x'], 'Error: boom\n    at foo')).toBe('Error: boom')
    expect(extractSlidevError(['x', 'TypeError: bad thing'])).toBe('TypeError: bad thing')
    expect(extractSlidevError(['all good'])).toBeUndefined()
  })
})

describe.skipIf(!hasDevRuntime)('slidev server', () => {
  let scratch: string
  let runtime: ReturnType<typeof createRuntimeManager>
  let deckDir: string
  let bridge: string

  beforeAll(async () => {
    scratch = scratchDir('server')
    const runtimeDir = copyDevRuntime(join(scratch, 'runtime'))
    const resourcesDir = makeResources(join(scratch, 'resources'))
    bridge = join(resourcesDir, 'launcher', 'bridge-client.js')
    runtime = createRuntimeManager({ runtimeDir, resourcesDir, onProgress: () => {} })
    const status = await runtime.ensure()
    expect(status.state, status.error).toBe('ready')
    deckDir = join(scratch, 'deck')
    cpSync(join(ROOT, 'tests', 'fixtures', 'basic'), deckDir, { recursive: true })
  }, 60_000)

  afterAll(() => {
    if (scratch && !process.env.PODIUM_TEST_KEEP)
      rmSync(scratch, { recursive: true, force: true })
  })

  it('starts, serves, restarts and stops without leftovers', async () => {
    const statuses: ServerStatus[] = []
    const server = createSlidevServer({
      deckId: 'deck-1',
      entry: join(deckDir, 'slides.md'),
      runtime,
      bridgeClientPath: bridge,
      onStatus: s => statuses.push(s),
      portRange: PORTS,
    })
    expect(server.status()).toMatchObject({ deckId: 'deck-1', state: 'stopped' })

    const first = server.start()
    expect(server.start()).toBe(first)
    const ready = await first
    expect(ready.state).toBe('ready')
    expect(ready.port).toBeGreaterThanOrEqual(3400)
    expect(ready.port).toBeLessThanOrEqual(3419)
    expect(ready.url).toBe(`http://localhost:${ready.port}`)
    expect(ready.mcpUrl).toBe(`${ready.url}/__mcp`)
    expect(statuses.map(s => s.state)).toEqual(['starting', 'ready'])

    const page = await fetch(`${ready.url}/1`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('/@podium/bridge.js')
    const bridgeJs = await fetch(`${ready.url}/@podium/bridge.js`)
    expect(await bridgeJs.text()).toContain('__podiumBridgeStub')

    await expect(server.start()).resolves.toMatchObject({ state: 'ready', port: ready.port })
    const launchers = processesWith(runtime.launcherPath)
    expect(launchers).toHaveLength(1)

    // A theme change in the file makes the launcher restart itself.
    const slides = join(deckDir, 'slides.md')
    writeFileSync(slides, readFileSync(slides, 'utf8').replace('theme: seriph', 'theme: default'))
    await waitFor(() => statuses.some(s => s.state === 'restarting'))
    await waitFor(() => statuses.at(-1)?.state === 'ready', 60_000)
    expect((await fetch(`${ready.url}/1`)).status).toBe(200)

    // restart() replaces the process and keeps the port when it is free.
    const restarted = await server.restart()
    expect(restarted.state).toBe('ready')
    expect(restarted.port).toBe(ready.port)
    expect((await fetch(`${restarted.url}/1`)).status).toBe(200)
    const after = processesWith(runtime.launcherPath)
    expect(after).toHaveLength(1)
    expect(after[0]).not.toBe(launchers[0])

    await server.stop()
    expect(server.status().state).toBe('stopped')
    expect(statuses.at(-1)?.state).toBe('stopped')
    expect(processesWith(runtime.launcherPath)).toEqual([])
    expect(await checkPort(restarted.port!)).toBe(restarted.port)
    // Stopping twice is harmless.
    await server.stop()
  }, 180_000)

  it('reports a missing theme with Slidev\'s message', async () => {
    const broken = join(scratch, 'broken')
    cpSync(join(ROOT, 'tests', 'fixtures', 'basic'), broken, { recursive: true })
    const slides = join(broken, 'slides.md')
    writeFileSync(slides, readFileSync(slides, 'utf8').replace(/theme: \w+/, 'theme: podium-nope-4711'))
    const server = createSlidevServer({ deckId: 'broken', entry: slides, runtime, bridgeClientPath: bridge, onStatus: () => {}, portRange: PORTS })
    await expect(server.start()).rejects.toThrow(/The theme "slidev-theme-podium-nope-4711" was not found/)
    const status = server.status()
    expect(status.state).toBe('error')
    expect(status.error).toMatch(/^The theme "slidev-theme-podium-nope-4711" was not found/)
    expect(status.log?.length).toBeGreaterThan(0)
    expect(processesWith(slides)).toEqual([])
  }, 60_000)

  it('serves a deck whose theme lives in the deck folder', async () => {
    const deck = join(scratch, 'workspace-theme')
    cpSync(join(ROOT, 'tests', 'fixtures', 'workspace-theme'), deck, { recursive: true })
    const slides = join(deck, 'slides.md')
    const statuses: ServerStatus[] = []
    const server = createSlidevServer({ deckId: 'workspace', entry: slides, runtime, bridgeClientPath: bridge, onStatus: s => statuses.push(s), portRange: PORTS })
    try {
      const ready = await server.start()
      expect(ready.state, server.status().error).toBe('ready')
      // The theme's style entry imports @slidev/theme-default, which only the runtime has.
      const styles = await fetch(`${ready.url}/@fs${join(deck, 'packages', 'slidev-theme-hausfarbe', 'styles', 'index.ts')}`)
      expect(styles.status).toBe(200)
      expect(await styles.text()).toMatch(/import ".*runtime\/node_modules\/.*theme-default/)

      // An edit must not look like a theme change: the server stays up.
      writeFileSync(slides, readFileSync(slides, 'utf8').replace('- Ein Punkt', '- Ein anderer Punkt'))
      await new Promise(resolve => setTimeout(resolve, 2500))
      expect(statuses.map(s => s.state)).toEqual(['starting', 'ready'])

      // Switching to an installed theme does restart it.
      writeFileSync(slides, readFileSync(slides, 'utf8').replace('theme: slidev-theme-hausfarbe', 'theme: seriph').replace('layout: merksatz', 'layout: default'))
      await waitFor(() => statuses.some(s => s.state === 'restarting'))
      await waitFor(() => statuses.at(-1)?.state === 'ready', 60_000)
    }
    finally {
      await server.stop()
    }
  }, 120_000)

  it('notices when the process dies', async () => {
    const statuses: ServerStatus[] = []
    const server = createSlidevServer({ deckId: 'killed', entry: join(deckDir, 'slides.md'), runtime, bridgeClientPath: bridge, onStatus: s => statuses.push(s), portRange: PORTS })
    await server.start()
    const [pid] = processesWith(runtime.launcherPath)
    process.kill(pid, 'SIGKILL')
    await waitFor(() => server.status().state === 'error')
    expect(server.status().error).toMatch(/unerwartet beendet \(SIGKILL\)/)
    // It can be started again afterwards.
    await expect(server.start()).resolves.toMatchObject({ state: 'ready' })
    await server.stop()
    expect(processesWith(runtime.launcherPath)).toEqual([])
  }, 120_000)

  it('stops while still starting', async () => {
    const server = createSlidevServer({ deckId: 'early', entry: join(deckDir, 'slides.md'), runtime, bridgeClientPath: bridge, onStatus: () => {}, portRange: PORTS })
    const starting = server.start()
    await waitFor(() => processesWith(runtime.launcherPath).length === 1)
    await server.stop()
    await expect(starting).rejects.toThrow()
    expect(server.status().state).toBe('stopped')
    expect(processesWith(runtime.launcherPath)).toEqual([])
  }, 60_000)
})
