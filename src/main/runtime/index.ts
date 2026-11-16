import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { RuntimeManager, RuntimeOptions } from '../contracts'
import type { InstalledPackage, PackageKind, PackageRequest, RuntimeStatus } from '../../shared/types'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { readJsonSync, writeFileAtomic } from './fsutil'
import { workspacePackages } from './local'
import { candidateNames, installName, isResolvableName, needsNoPackage, parseSpec } from './names'
import { runNpm } from './npm'
import { findTemplates, syncTemplates, unregisterTemplate } from './templates'
import { isTrusted } from './trusted'

export { isValidPackageName, parseSpec } from './names'
export { describeNpmError, npmCliPath } from './npm'
export { isTrusted } from './trusted'

export const SLIDEV_RANGE = '^53.1.0'
/** Packages every runtime has. The first one carries the version range. */
export const BASE_PACKAGES = ['@slidev/cli', '@slidev/theme-default', '@slidev/theme-seriph']
const LAUNCHER_NAME = 'podium-launcher.mjs'
/** Package scripts never run. Few retries, so being offline shows up within seconds. */
const NPM_INSTALL = [
  'install',
  '--save',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--fetch-retries=1',
  '--fetch-retry-mintimeout=2000',
  '--fetch-retry-maxtimeout=5000',
  '--',
]

interface PackageJson {
  name?: string
  version?: string
  keywords?: string[]
  slidev?: { addons?: unknown }
  dependencies?: Record<string, string>
}

export function createRuntimeManager(options: RuntimeOptions): RuntimeManager {
  const runtimeDir = resolvePath(options.runtimeDir)
  const nodeModules = join(runtimeDir, 'node_modules')
  const launcherPath = join(runtimeDir, LAUNCHER_NAME)
  const launcherSource = join(options.resourcesDir, 'launcher', 'launcher.mjs')

  let ensuring: Promise<RuntimeStatus> | undefined
  let lastError: string | undefined
  /** All npm runs (base install and extra packages) go through this chain, one at a time. */
  let npmQueue: Promise<unknown> = Promise.resolve()
  let npmPending = 0

  const progress = (scope: string, message: string, extra: { fraction?: number, done?: boolean, error?: string } = {}) => {
    try {
      options.onProgress({ scope, message, ...extra })
    }
    catch {}
  }

  function spawnNode(args: string[], spawnOptions: SpawnOptions = {}): ChildProcess {
    // Electron in node mode; under plain Node (tests) process.execPath already is node.
    const env = { ...(spawnOptions.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' }
    return spawn(process.execPath, args, { windowsHide: true, ...spawnOptions, env })
  }

  function packageDir(name: string, deckDir?: string): string | undefined {
    if (!parseSpec(name))
      return undefined
    // A package the deck brings along wins over one of the same name in the runtime.
    const local = deckDir ? workspacePackages(deckDir).get(name) : undefined
    if (local)
      return local
    const dir = join(nodeModules, ...name.split('/'))
    return existsSync(join(dir, 'package.json')) ? dir : undefined
  }

  function slidevVersion(): string | undefined {
    return readJsonSync<PackageJson>(join(nodeModules, '@slidev', 'cli', 'package.json'))?.version
  }

  function basePresent(): boolean {
    return BASE_PACKAGES.every(name => existsSync(join(nodeModules, ...name.split('/'), 'package.json')))
  }

  function isReady(): boolean {
    return basePresent() && existsSync(launcherPath)
  }

  let refreshingLauncher: Promise<boolean> | undefined

  async function status(): Promise<RuntimeStatus> {
    if (ensuring)
      return { state: 'installing', dir: runtimeDir, slidevVersion: slidevVersion() }
    // The app only runs ensure() when the runtime is missing. After an app update the copied
    // launcher would stay old (and ignore new arguments such as the phone remote's), so refresh
    // it here. In the background: boot waits on status(), and the write is done long before a
    // deck's server starts.
    if (basePresent() && existsSync(launcherPath) && !refreshingLauncher)
      refreshingLauncher = syncLauncher().catch(() => false).finally(() => { refreshingLauncher = undefined })
    if (isReady())
      return { state: 'ready', dir: runtimeDir, slidevVersion: slidevVersion() }
    if (lastError)
      return { state: 'error', dir: runtimeDir, slidevVersion: slidevVersion(), error: lastError }
    return { state: 'missing', dir: runtimeDir, slidevVersion: slidevVersion() }
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    npmPending++
    const run = npmQueue.then(task, task).finally(() => {
      npmPending--
    })
    npmQueue = run.catch(() => {})
    return run
  }

  async function writePackageJson(): Promise<void> {
    const path = join(runtimeDir, 'package.json')
    const pkg = readJsonSync<PackageJson & Record<string, unknown>>(path)
    if (pkg && pkg.private === true && pkg.type === 'module')
      return
    await writeFileAtomic(path, `${JSON.stringify({ name: 'podium-runtime', ...pkg, private: true, type: 'module' }, null, 2)}\n`)
  }

  async function syncLauncher(): Promise<boolean> {
    if (!existsSync(launcherSource))
      throw new Error(`Startprogramm fehlt in der App: ${launcherSource}`)
    const content = await readFile(launcherSource)
    if (existsSync(launcherPath) && (await readFile(launcherPath)).equals(content))
      return false
    await writeFileAtomic(launcherPath, content)
    return true
  }

  async function runEnsure(): Promise<RuntimeStatus> {
    const scope = 'runtime'
    try {
      progress(scope, 'Prüfe die Slidev-Installation …', { fraction: 0 })
      await mkdir(runtimeDir, { recursive: true })

      if (!basePresent() && options.seedDir && existsSync(join(options.seedDir, 'node_modules', '@slidev', 'cli', 'package.json'))) {
        progress(scope, 'Richte Slidev aus dem App-Paket ein …', { fraction: 0.1 })
        await cp(options.seedDir, runtimeDir, { recursive: true, force: true, verbatimSymlinks: true })
      }
      await writePackageJson()

      progress(scope, 'Kopiere die eingebauten Vorlagen …', { fraction: 0.2 })
      await syncTemplates(options.resourcesDir, runtimeDir, options.userTemplatesDir)

      if (!basePresent()) {
        progress(scope, 'Lade Slidev herunter. Das dauert beim ersten Start etwa eine Minute …', { fraction: 0.3 })
        await enqueue(() => runNpm(spawnNode, runtimeDir, [
          ...NPM_INSTALL,
          `${BASE_PACKAGES[0]}@${SLIDEV_RANGE}`,
          ...BASE_PACKAGES.slice(1),
        ], (line) => {
          if (/^added \d+ packages?/.test(line))
            progress(scope, `Slidev heruntergeladen (${line.trim()}).`, { fraction: 0.9 })
        }))
        if (!basePresent())
          throw new Error('Slidev wurde nicht vollständig installiert.')
        // npm may have re-extracted the templates from builtin/; make sure node_modules has the full copy.
        await syncTemplates(options.resourcesDir, runtimeDir, options.userTemplatesDir)
      }

      progress(scope, 'Richte das Startprogramm ein …', { fraction: 0.95 })
      await syncLauncher()

      lastError = undefined
      const version = slidevVersion()
      progress(scope, `Slidev ${version ?? ''} ist bereit.`.replace('  ', ' '), { fraction: 1, done: true })
      return { state: 'ready', dir: runtimeDir, slidevVersion: version }
    }
    catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      progress(scope, 'Slidev konnte nicht eingerichtet werden.', { done: true, error: lastError })
      return { state: 'error', dir: runtimeDir, slidevVersion: slidevVersion(), error: lastError }
    }
  }

  function ensure(): Promise<RuntimeStatus> {
    ensuring ??= runEnsure().finally(() => {
      ensuring = undefined
    })
    return ensuring
  }

  /** Root of `name`: a package in the deck's own workspace, the runtime's node_modules, then node_modules above the deck. */
  function findPackage(name: string, deckDir?: string): string | undefined {
    const known = packageDir(name, deckDir)
    if (known)
      return known
    if (!deckDir)
      return undefined
    let dir = resolvePath(deckDir)
    while (true) {
      const candidate = join(dir, 'node_modules', ...name.split('/'))
      if (existsSync(join(candidate, 'package.json')))
        return candidate
      const parent = dirname(dir)
      if (parent === dir)
        return undefined
      dir = parent
    }
  }

  async function resolve(raw: string, kind: 'theme' | 'addon', deckDir?: string): Promise<PackageRequest> {
    const value = String(raw ?? '').trim()
    if (needsNoPackage(value))
      return { raw, name: value, kind, trusted: true, installed: true }
    if (!isResolvableName(value))
      return { raw, name: value, kind, trusted: false, installed: false }
    const local = deckDir ? workspacePackages(deckDir) : undefined
    for (const name of candidateNames(value, kind)) {
      // Nothing gets downloaded for a package the deck brings along, so there is nothing to confirm.
      if (local?.has(name))
        return { raw, name, kind, trusted: true, installed: true }
      if (findPackage(name, deckDir))
        return { raw, name, kind, trusted: isTrusted(name), installed: true }
    }
    const name = installName(value, kind)
    return { raw, name, kind, trusted: isTrusted(name), installed: false }
  }

  function declaredAddons(pkgDir: string | undefined): string[] {
    if (!pkgDir)
      return []
    const addons = readJsonSync<PackageJson>(join(pkgDir, 'package.json'))?.slidev?.addons
    return Array.isArray(addons) ? addons.filter((a): a is string => typeof a === 'string') : []
  }

  async function requirementsFor(deck: { dir: string, theme: string, addons: string[] }): Promise<PackageRequest[]> {
    const result: PackageRequest[] = []
    const seen = new Set<string>()
    const local = workspacePackages(deck.dir)
    const visit = async (raw: string, kind: 'theme' | 'addon') => {
      if (typeof raw !== 'string' || needsNoPackage(raw.trim()))
        return
      const request = await resolve(raw, kind, deck.dir)
      if (seen.has(request.name))
        return
      seen.add(request.name)
      result.push(request)
      if (request.installed) {
        for (const addon of declaredAddons(findPackage(request.name, deck.dir)))
          await visit(addon, 'addon')
        // A package from the deck's own folder was never installed, so npm did not fetch what it depends on.
        const localDir = local.get(request.name)
        const dependencies = localDir ? readJsonSync<PackageJson>(join(localDir, 'package.json'))?.dependencies : undefined
        for (const dependency of Object.keys(dependencies ?? {})) {
          if (seen.has(dependency) || !parseSpec(dependency) || findPackage(dependency, deck.dir))
            continue
          seen.add(dependency)
          const kind: PackageKind = dependency.startsWith('@iconify-json/') ? 'icons' : 'other'
          result.push({ raw: dependency, name: dependency, kind, trusted: isTrusted(dependency), installed: false })
        }
      }
    }
    await visit(deck.theme || 'default', 'theme')
    for (const addon of deck.addons ?? [])
      await visit(addon, 'addon')
    // Slidev also reads `slidev.addons` from the deck's own package.json.
    for (const addon of declaredAddons(existsSync(join(deck.dir, 'package.json')) ? deck.dir : undefined))
      await visit(addon, 'addon')
    return result
  }

  async function install(names: string[]): Promise<void> {
    const scope = 'packages'
    const list = [...new Set((names ?? []).map(n => String(n).trim()).filter(Boolean))]
    const invalid = list.filter(name => !parseSpec(name))
    if (invalid.length) {
      const message = `Ungültiger Paketname: ${invalid.map(n => `„${n}“`).join(', ')}`
      progress(scope, message, { done: true, error: message })
      throw new Error(message)
    }
    if (!list.length)
      return
    // A plain name that is already there needs no download; "name@version" always goes to npm.
    const todo = list.filter(spec => parseSpec(spec)!.version || !packageDir(spec))
    if (!todo.length) {
      progress(scope, 'Alles schon installiert.', { done: true })
      return
    }
    const label = todo.join(', ')
    if (npmPending)
      progress(scope, `Warte auf eine andere Installation, dann: ${label}`)
    return enqueue(async () => {
      if (!basePresent())
        throw new Error('Slidev ist noch nicht eingerichtet.')
      progress(scope, `Installiere ${label} …`)
      try {
        await writePackageJson()
        await runNpm(spawnNode, runtimeDir, [
          ...NPM_INSTALL,
          ...todo,
        ])
        await syncTemplates(options.resourcesDir, runtimeDir, options.userTemplatesDir)
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        progress(scope, `Installation fehlgeschlagen: ${label}`, { done: true, error: message })
        throw new Error(message)
      }
      progress(scope, `Installiert: ${label}`, { done: true })
    })
  }

  /** Does a template the user added name a package that is not in the runtime yet? */
  async function userTemplatesNeedPackages(): Promise<boolean> {
    const shipped = new Set((await findTemplates(options.resourcesDir)).map(t => t.name))
    for (const template of await findTemplates(options.resourcesDir, options.userTemplatesDir)) {
      if (shipped.has(template.name))
        continue
      const dependencies = readJsonSync<PackageJson>(join(template.source, 'package.json'))?.dependencies
      if (Object.keys(dependencies ?? {}).some(name => !packageDir(name)))
        return true
    }
    return false
  }

  function syncUserTemplates(): Promise<void> {
    return enqueue(async () => {
      if (!basePresent())
        throw new Error('Slidev ist noch nicht eingerichtet.')
      await syncTemplates(options.resourcesDir, runtimeDir, options.userTemplatesDir)
      if (await userTemplatesNeedPackages()) {
        progress('packages', 'Lade, was die Vorlage braucht …')
        try {
          // Without package names npm installs what package.json lists, including what the templates depend on.
          await runNpm(spawnNode, runtimeDir, NPM_INSTALL.slice(0, -1))
          // npm may have re-extracted the templates from builtin/; make sure node_modules has the full copy.
          await syncTemplates(options.resourcesDir, runtimeDir, options.userTemplatesDir)
        }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          progress('packages', 'Die Vorlage konnte nicht vollständig eingerichtet werden.', { done: true, error: message })
          throw new Error(message)
        }
        progress('packages', 'Vorlage eingerichtet.', { done: true })
      }
    })
  }

  function removeTemplate(name: string): Promise<void> {
    return enqueue(async () => {
      if ((await findTemplates(options.resourcesDir)).some(t => t.name === name))
        throw new Error('Eingebaute Vorlagen lassen sich nicht entfernen.')
      await unregisterTemplate(runtimeDir, name)
    })
  }

  function kindOf(name: string, pkg: PackageJson): PackageKind | undefined {
    if (name.startsWith('@iconify-json/'))
      return 'icons'
    const base = name.split('/').pop() ?? name
    const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : []
    if (/^(?:theme-|slidev-theme-)/.test(base) && (name.startsWith('@slidev/') || base.startsWith('slidev-theme-')))
      return 'theme'
    if (/^(?:addon-|slidev-addon-)/.test(base) && (name.startsWith('@slidev/') || base.startsWith('slidev-addon-')))
      return 'addon'
    if (keywords.includes('slidev-theme'))
      return 'theme'
    if (keywords.includes('slidev-addon'))
      return 'addon'
    return undefined
  }

  async function topLevelPackages(): Promise<string[]> {
    const names: string[] = []
    let entries
    try {
      entries = await readdir(nodeModules, { withFileTypes: true })
    }
    catch {
      return names
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.'))
        continue
      if (entry.name.startsWith('@') && (entry.isDirectory() || entry.isSymbolicLink())) {
        try {
          for (const sub of await readdir(join(nodeModules, entry.name)))
            names.push(`${entry.name}/${sub}`)
        }
        catch {}
      }
      else if (entry.isDirectory() || entry.isSymbolicLink()) {
        names.push(entry.name)
      }
    }
    return names
  }

  async function listInstalled(): Promise<InstalledPackage[]> {
    const runtimePkg = readJsonSync<PackageJson>(join(runtimeDir, 'package.json')) ?? {}
    const direct = new Set(Object.keys(runtimePkg.dependencies ?? {}))
    const templates = new Set((await findTemplates(options.resourcesDir)).map(t => t.name))
    const result: InstalledPackage[] = []
    for (const name of await topLevelPackages()) {
      const dir = join(nodeModules, ...name.split('/'))
      const pkg = readJsonSync<PackageJson>(join(dir, 'package.json'))
      if (!pkg)
        continue
      const kind = kindOf(name, pkg)
      if (!kind)
        continue
      // Packages the user did not ask for (they came with Slidev) count as built in too.
      const builtin = BASE_PACKAGES.includes(name) || templates.has(name) || !direct.has(name)
      result.push({ name, version: pkg.version ?? '', kind, builtin, dir })
    }
    return result.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
  }

  return {
    runtimeDir,
    launcherPath,
    status,
    ensure,
    resolve,
    requirementsFor,
    install,
    listInstalled,
    syncUserTemplates,
    removeTemplate,
    packageDir,
    spawnNode,
  }
}
