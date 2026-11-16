/**
 * Real runtime tests against a private copy of .dev-runtime. The install tests need
 * network access (npm registry).
 */
import type { ProgressEvent } from '../../../src/shared/types'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRuntimeManager } from '../../../src/main/runtime'
import { copyDevRuntime, DEV_RUNTIME, makeResources, ROOT, scratchDir } from './helpers'

const hasDevRuntime = existsSync(join(DEV_RUNTIME, 'node_modules', '@slidev', 'cli', 'package.json'))

function withEnv<T>(patch: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(patch).map(key => [key, process.env[key]]))
  Object.assign(process.env, patch)
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined)
      delete process.env[key]
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined)
        delete process.env[key]
      else
        process.env[key] = value
    }
  })
}

/** An address nothing listens on, so any registry access fails fast. */
const OFFLINE = { npm_config_registry: 'http://127.0.0.1:9/' }

describe.skipIf(!hasDevRuntime)('runtime manager on a copy of .dev-runtime', () => {
  let scratch: string
  let runtimeDir: string
  let resourcesDir: string
  const events: ProgressEvent[] = []
  let manager: ReturnType<typeof createRuntimeManager>
  const devPkgBefore = hasDevRuntime ? readFileSync(join(DEV_RUNTIME, 'package.json'), 'utf8') : ''
  // The app itself (e2e runs) may have set up .dev-runtime's builtin templates; only changes by this test count.
  const devBuiltinBefore = existsSync(join(DEV_RUNTIME, 'builtin'))

  beforeAll(() => {
    scratch = scratchDir('runtime')
    runtimeDir = copyDevRuntime(join(scratch, 'runtime'))
    resourcesDir = makeResources(join(scratch, 'resources'))
    manager = createRuntimeManager({ runtimeDir, resourcesDir, onProgress: e => events.push(e) })
  }, 60_000)

  afterAll(() => {
    if (scratch && !process.env.PODIUM_TEST_KEEP)
      rmSync(scratch, { recursive: true, force: true })
    // Our copy must never have leaked into the shared dev runtime.
    expect(readFileSync(join(DEV_RUNTIME, 'package.json'), 'utf8')).toBe(devPkgBefore)
    expect(existsSync(join(DEV_RUNTIME, 'builtin'))).toBe(devBuiltinBefore)
  })

  it('reports missing until the launcher is in place', async () => {
    const status = await manager.status()
    expect(status.state).toBe('missing')
    expect(status.slidevVersion).toMatch(/^53\./)
    expect(manager.launcherPath).toBe(join(runtimeDir, 'podium-launcher.mjs'))
  })

  it('accepts a complete runtime without npm and shares concurrent ensure calls', async () => {
    // With the registry unreachable, any npm call would fail the ensure.
    await withEnv(OFFLINE, async () => {
      const a = manager.ensure()
      const b = manager.ensure()
      expect(a).toBe(b)
      expect((await manager.status()).state).toBe('installing')
      const status = await a
      expect(status).toMatchObject({ state: 'ready', dir: runtimeDir })
      expect(status.slidevVersion).toMatch(/^53\./)
    })
    expect(events.at(-1)).toMatchObject({ scope: 'runtime', done: true })
    expect(events.some(e => /herunter/.test(e.message))).toBe(false)
    expect(readFileSync(manager.launcherPath, 'utf8')).toBe(readFileSync(join(ROOT, 'launcher', 'launcher.mjs'), 'utf8'))
    expect((await manager.status()).state).toBe('ready')
  })

  it('copies built-in templates and keeps them in sync', async () => {
    const installed = join(runtimeDir, 'node_modules', 'slidev-theme-testklar')
    expect(readFileSync(join(installed, 'layouts', 'cover.vue'), 'utf8')).toContain('cover')
    expect(existsSync(join(runtimeDir, 'node_modules', 'not-a-template'))).toBe(false)
    const pkg = JSON.parse(readFileSync(join(runtimeDir, 'package.json'), 'utf8'))
    expect(pkg.dependencies['slidev-theme-testklar']).toBe('file:builtin/slidev-theme-testklar')

    writeFileSync(join(resourcesDir, 'templates', 'testklar', 'layouts', 'cover.vue'), '<template><div>v2</div></template>\n')
    await manager.ensure()
    expect(readFileSync(join(installed, 'layouts', 'cover.vue'), 'utf8')).toContain('v2')
    expect(manager.packageDir('slidev-theme-testklar')).toBe(installed)
  })

  it('rewrites a changed launcher', async () => {
    writeFileSync(manager.launcherPath, '// stale')
    await manager.ensure()
    expect(readFileSync(manager.launcherPath, 'utf8')).toContain('Podium launcher')
  })

  it('refreshes a stale launcher when asked for the status, as after an app update', async () => {
    writeFileSync(manager.launcherPath, '// launcher from an older app version')
    expect((await manager.status()).state).toBe('ready')
    await expect.poll(() => readFileSync(manager.launcherPath, 'utf8')).toBe(readFileSync(join(ROOT, 'launcher', 'launcher.mjs'), 'utf8'))
  })

  it('resolves theme and addon names', async () => {
    await expect(manager.resolve('seriph', 'theme')).resolves.toEqual({ raw: 'seriph', name: '@slidev/theme-seriph', kind: 'theme', trusted: true, installed: true })
    await expect(manager.resolve('default', 'theme')).resolves.toMatchObject({ name: '@slidev/theme-default', installed: true })
    await expect(manager.resolve('testklar', 'theme')).resolves.toMatchObject({ name: 'slidev-theme-testklar', installed: true, trusted: false })
    await expect(manager.resolve('penguin', 'theme')).resolves.toMatchObject({ name: 'slidev-theme-penguin', installed: false, trusted: true })
    await expect(manager.resolve('mystery', 'theme')).resolves.toMatchObject({ name: 'slidev-theme-mystery', installed: false, trusted: false })
    await expect(manager.resolve('qrcode', 'addon')).resolves.toMatchObject({ name: 'slidev-addon-qrcode', kind: 'addon', installed: false, trusted: true })
    await expect(manager.resolve('./theme', 'theme')).resolves.toMatchObject({ installed: true })
    await expect(manager.resolve('Bad Name!', 'theme')).resolves.toMatchObject({ installed: false, trusted: false })
  })

  it('lists what a deck needs', async () => {
    const basic = await manager.requirementsFor({ dir: join(ROOT, 'tests', 'fixtures', 'basic'), theme: 'seriph', addons: [] })
    expect(basic).toEqual([{ raw: 'seriph', name: '@slidev/theme-seriph', kind: 'theme', trusted: true, installed: true }])

    // Deck with its own node_modules: an addon there counts as installed, and what it declares is needed too.
    const deck = join(scratch, 'decks', 'local')
    const addonDir = join(deck, 'node_modules', 'slidev-addon-localthing')
    mkdirSync(addonDir, { recursive: true })
    writeFileSync(join(addonDir, 'package.json'), JSON.stringify({ name: 'slidev-addon-localthing', version: '1.0.0', slidev: { addons: ['qrcode', './local-path'] } }))
    writeFileSync(join(deck, 'package.json'), JSON.stringify({ slidev: { addons: ['excalidraw'] } }))
    const needs = await manager.requirementsFor({ dir: deck, theme: '', addons: ['localthing', 'qrcode', '../shared-addon'] })
    expect(needs.map(n => [n.name, n.kind, n.installed, n.trusted])).toEqual([
      ['@slidev/theme-default', 'theme', true, true],
      ['slidev-addon-localthing', 'addon', true, false],
      ['slidev-addon-qrcode', 'addon', false, true],
      ['slidev-addon-excalidraw', 'addon', false, true],
    ])

    const plain = join(scratch, 'decks', 'plain')
    mkdirSync(plain, { recursive: true })
    const pathTheme = await manager.requirementsFor({ dir: plain, theme: './theme', addons: [] })
    expect(pathTheme).toEqual([])
    const none = await manager.requirementsFor({ dir: plain, theme: 'none', addons: [] })
    expect(none).toEqual([])
  })

  it('takes a theme from the deck\'s own workspace without asking for a download', async () => {
    const deck = join(ROOT, 'tests', 'fixtures', 'workspace-theme')
    const themeDir = join(deck, 'packages', 'slidev-theme-hausfarbe')
    // The full package name and the short form both mean the folder in the deck.
    for (const theme of ['slidev-theme-hausfarbe', 'hausfarbe']) {
      const needs = await manager.requirementsFor({ dir: deck, theme, addons: [] })
      expect(needs).toEqual([{ raw: theme, name: 'slidev-theme-hausfarbe', kind: 'theme', trusted: true, installed: true }])
    }
    expect(manager.packageDir('slidev-theme-hausfarbe', deck)).toBe(themeDir)
    expect(manager.packageDir('slidev-theme-hausfarbe')).toBeUndefined()

    // What the theme depends on is not in the deck folder, so it has to be in the runtime.
    const copy = join(scratch, 'decks', 'workspace')
    cpSync(deck, copy, { recursive: true })
    const pkgFile = join(copy, 'packages', 'slidev-theme-hausfarbe', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    pkg.dependencies['@iconify-json/tabler'] = '*'
    pkg.dependencies['some-unknown-helper'] = '*'
    writeFileSync(pkgFile, JSON.stringify(pkg))
    const withDeps = await manager.requirementsFor({ dir: copy, theme: 'slidev-theme-hausfarbe', addons: [] })
    expect(withDeps.map(n => [n.name, n.kind, n.installed, n.trusted])).toEqual([
      ['slidev-theme-hausfarbe', 'theme', true, true],
      ['@iconify-json/tabler', 'icons', false, true],
      ['some-unknown-helper', 'other', false, false],
    ])
  })

  it('rejects invalid package names before running npm', async () => {
    for (const bad of [['--global', 'x'], ['a/b'], ['file:../x'], ['x@1 || 2'], ['https://evil.example/x.tgz']])
      await expect(manager.install(bad)).rejects.toThrow(/Ungültiger Paketname/)
  })

  it('installs a theme into the runtime and keeps the templates', async () => {
    await manager.install(['@slidev/theme-apple-basic'])
    const dir = manager.packageDir('@slidev/theme-apple-basic')
    expect(dir).toBe(join(runtimeDir, 'node_modules', '@slidev', 'theme-apple-basic'))
    await expect(manager.resolve('apple-basic', 'theme')).resolves.toMatchObject({ installed: true })
    // npm prunes undeclared folders; the template must survive.
    expect(existsSync(join(runtimeDir, 'node_modules', 'slidev-theme-testklar', 'layouts', 'cover.vue'))).toBe(true)
    expect(existsSync(join(runtimeDir, 'node_modules', '@slidev', 'theme-seriph', 'package.json'))).toBe(true)
    expect(events.at(-1)).toMatchObject({ scope: 'packages', done: true })
    expect(events.at(-1)?.error).toBeUndefined()

    const list = await manager.listInstalled()
    const byName = Object.fromEntries(list.map(p => [p.name, p]))
    expect(byName['@slidev/theme-apple-basic']).toMatchObject({ kind: 'theme', builtin: false })
    expect(byName['@slidev/theme-default']).toMatchObject({ kind: 'theme', builtin: true })
    expect(byName['@slidev/theme-seriph']).toMatchObject({ kind: 'theme', builtin: true })
    expect(byName['slidev-theme-testklar']).toMatchObject({ kind: 'theme', builtin: true, version: '1.0.0' })
    expect(byName['@iconify-json/carbon']).toMatchObject({ kind: 'icons', builtin: true })
    expect(list.some(p => p.name === '@slidev/cli')).toBe(false)
    expect((await manager.status()).state).toBe('ready')
  }, 180_000)

  it('skips npm when the package is already there', async () => {
    await withEnv(OFFLINE, () => manager.install(['@slidev/theme-seriph']))
  })

  it('reports a missing package readably and runs installs one at a time', async () => {
    const start = events.length
    const a = manager.install(['slidev-theme-podium-does-not-exist-4711'])
    const b = manager.install(['slidev-addon-podium-does-not-exist-4712'])
    await expect(a).rejects.toThrow(/„slidev-theme-podium-does-not-exist-4711“ wurde nicht gefunden/)
    await expect(b).rejects.toThrow(/„slidev-addon-podium-does-not-exist-4712“ wurde nicht gefunden/)
    const log = events.slice(start).map(e => e.message)
    const firstDone = log.findIndex(m => m.includes('fehlgeschlagen') && m.includes('4711'))
    const secondStart = log.findIndex(m => m.startsWith('Installiere') && m.includes('4712'))
    expect(firstDone).toBeGreaterThanOrEqual(0)
    expect(secondStart).toBeGreaterThan(firstDone)
  }, 120_000)

  it('reports being offline readably', async () => {
    await withEnv(OFFLINE, async () => {
      await expect(manager.install(['slidev-addon-python-runner'])).rejects.toThrow(/Internetverbindung/)
    })
  }, 120_000)
})

describe.skipIf(!hasDevRuntime)('runtime manager from a seed', () => {
  it('copies the seed instead of downloading', async () => {
    const scratch = scratchDir('seed')
    try {
      const seedDir = copyDevRuntime(join(scratch, 'seed'))
      const resourcesDir = makeResources(join(scratch, 'resources'))
      const runtimeDir = join(scratch, 'runtime')
      const events: ProgressEvent[] = []
      const manager = createRuntimeManager({ runtimeDir, resourcesDir, seedDir, onProgress: e => events.push(e) })
      expect((await manager.status()).state).toBe('missing')
      const status = await withEnv(OFFLINE, () => manager.ensure())
      expect(status.state, status.error).toBe('ready')
      expect(events.some(e => /App-Paket/.test(e.message))).toBe(true)
      expect(existsSync(join(runtimeDir, 'node_modules', 'slidev-theme-testklar', 'package.json'))).toBe(true)
    }
    finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('runtime manager without network', () => {
  it('reports an error when the download fails', async () => {
    const scratch = scratchDir('offline')
    try {
      const resourcesDir = makeResources(join(scratch, 'resources'))
      const events: ProgressEvent[] = []
      const manager = createRuntimeManager({ runtimeDir: join(scratch, 'runtime'), resourcesDir, seedDir: join(scratch, 'no-seed'), onProgress: e => events.push(e) })
      const status = await withEnv(OFFLINE, () => manager.ensure())
      expect(status.state).toBe('error')
      expect(status.error).toMatch(/Internetverbindung/)
      expect((await manager.status()).state).toBe('error')
      expect(events.at(-1)).toMatchObject({ scope: 'runtime', done: true })
      expect(events.at(-1)?.error).toMatch(/Internetverbindung/)
      const pkg = JSON.parse(readFileSync(join(scratch, 'runtime', 'package.json'), 'utf8'))
      expect(pkg).toMatchObject({ private: true, type: 'module' })
    }
    finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }, 120_000)
})

describe.runIf(process.env.PODIUM_TEST_FULL_INSTALL)('runtime manager from scratch (network, about a minute)', () => {
  it('installs Slidev into an empty folder', async () => {
    const scratch = scratchDir('fresh')
    try {
      const resourcesDir = makeResources(join(scratch, 'resources'))
      const events: ProgressEvent[] = []
      const manager = createRuntimeManager({ runtimeDir: join(scratch, 'runtime'), resourcesDir, onProgress: e => events.push(e) })
      const status = await manager.ensure()
      expect(status.state, status.error).toBe('ready')
      expect(status.slidevVersion).toMatch(/^53\./)
      const pkg = JSON.parse(readFileSync(join(scratch, 'runtime', 'package.json'), 'utf8'))
      expect(pkg.dependencies['@slidev/cli']).toBe('^53.1.0')
      expect(existsSync(join(scratch, 'runtime', 'node_modules', 'slidev-theme-testklar', 'layouts', 'cover.vue'))).toBe(true)
      expect(events.some(e => /herunter/.test(e.message))).toBe(true)
    }
    finally {
      if (!process.env.PODIUM_TEST_KEEP)
        rmSync(scratch, { recursive: true, force: true })
    }
  }, 600_000)
})
