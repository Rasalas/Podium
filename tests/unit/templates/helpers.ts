import type { RuntimeManager } from '../../../src/main/contracts'
import type { InstalledPackage, Locale } from '../../../src/shared/types'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const ROOT = resolve(__dirname, '../../..')
export const RUNTIME_MODULES = join(ROOT, '.dev-runtime', 'node_modules')
export const FIXTURES = join(ROOT, 'tests', 'fixtures', 'templates')

/** Read-only stand-in for the runtime: .dev-runtime plus extra packages from the fixtures. */
export function fakeRuntime(extra: Record<string, string> = {}): RuntimeManager {
  const dirOf = (name: string) => {
    if (extra[name])
      return extra[name]
    const dir = join(RUNTIME_MODULES, name)
    return existsSync(dir) ? dir : undefined
  }
  const nameOf = (raw: string, kind: 'theme' | 'addon') => {
    if (raw === 'klar')
      return 'slidev-theme-klar'
    if (kind === 'theme') {
      for (const candidate of [`@slidev/theme-${raw}`, `slidev-theme-${raw}`, raw])
        if (dirOf(candidate))
          return candidate
      return `slidev-theme-${raw}`
    }
    return raw.startsWith('slidev-addon-') ? raw : `slidev-addon-${raw}`
  }
  const base = {
    runtimeDir: join(ROOT, '.dev-runtime'),
    launcherPath: '',
    status: async () => ({ state: 'ready', dir: '' }),
    ensure: async () => ({ state: 'ready', dir: '' }),
    resolve: async (raw: string, kind: 'theme' | 'addon') => {
      const name = nameOf(raw, kind)
      return { raw, name, kind, trusted: true, installed: dirOf(name) !== undefined }
    },
    requirementsFor: async () => [],
    install: async () => {},
    listInstalled: async (): Promise<InstalledPackage[]> => {
      const names = ['@slidev/theme-default', '@slidev/theme-seriph', ...Object.keys(extra).filter(n => n.startsWith('slidev-theme-'))]
      if (existsSync(RUNTIME_MODULES))
        readdirSync(RUNTIME_MODULES).filter(n => n.startsWith('slidev-theme-')).forEach(n => names.push(n))
      return [...new Set(names)].map(name => ({ name, version: '1.0.0', kind: 'theme' as const, builtin: false, dir: dirOf(name) ?? '' }))
    },
    packageDir: dirOf,
    spawnNode: () => { throw new Error('not used') },
  }
  return base as unknown as RuntimeManager
}

export function fixtureRuntime() {
  return fakeRuntime({
    'slidev-theme-fake': join(FIXTURES, 'slidev-theme-fake'),
    'slidev-theme-manifest': join(FIXTURES, 'slidev-theme-manifest'),
    'slidev-addon-cards': join(FIXTURES, 'addon-cards'),
  })
}

export function registryOptions(runtime: RuntimeManager, locale: Locale = 'de') {
  return { runtime, resourcesDir: ROOT, locale: () => locale }
}
