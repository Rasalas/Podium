import type { DeckStarter, TemplateRegistry, TemplateRegistryOptions } from '../contracts'
import type { InstalledPackage, LayoutInfo, NewDeckOptions, TemplateInfo } from '../../shared/types'
import type { PackageSource } from './layouts'
import type { ThemeManifest } from './types'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { buildAgentsFile } from './agents'
import { buildLayouts } from './layouts'
import { CLAUDE_MD, genericStarter, GITIGNORE, prepareStarter, slugify } from './starter'
import { localize } from './types'

type DeckRef = { dir: string, theme: string, addons: string[] }

interface BuiltinTemplate {
  id: string
  packageName: string
  label: { de: string, en: string }
  description: { de: string, en: string }
  colors: { background: string, foreground: string, accent: string }
}

const BUILTIN: BuiltinTemplate[] = [
  {
    id: 'klar',
    packageName: 'slidev-theme-klar',
    label: { de: 'Klar', en: 'Clear' },
    description: {
      de: 'Ruhig, kontrastreich, mit einer Akzentfarbe. Für Vorträge und Vorlesungen.',
      en: 'Calm, high contrast, with one accent colour. For talks and lectures.',
    },
    colors: { background: '#fbfbf9', foreground: '#15181e', accent: '#2459d3' },
  },
  {
    id: 'default',
    packageName: '@slidev/theme-default',
    label: { de: 'Standard', en: 'Default' },
    description: {
      de: 'Die Standardvorlage von Slidev: hell, schlicht, mit blauem Akzent.',
      en: 'Slidev\'s standard template: light, plain, with a blue accent.',
    },
    colors: { background: '#ffffff', foreground: '#1b1b1b', accent: '#3ab9d5' },
  },
  {
    id: 'seriph',
    packageName: '@slidev/theme-seriph',
    label: { de: 'Seriph', en: 'Seriph' },
    description: {
      de: 'Klassisch mit Serifenschrift, gedämpftes Blaugrün.',
      en: 'Classic with a serif typeface and a muted blue-green.',
    },
    colors: { background: '#ffffff', foreground: '#1b1b1b', accent: '#5d8392' },
  },
]

/** Package names of the templates Podium always offers. A template the user adds cannot take one of them. */
export const BUILTIN_TEMPLATE_PACKAGES: ReadonlySet<string> = new Set(BUILTIN.map(b => b.packageName))

const isPathStyle = (name: string) => name.startsWith('.') || name.startsWith('/') || isAbsolute(name)

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  }
  catch {
    return undefined
  }
}

/** podium.json in the package root, or a `podium` field in its package.json. */
async function readManifest(dir: string): Promise<ThemeManifest | undefined> {
  const direct = await readJson<ThemeManifest>(join(dir, 'podium.json'))
  if (direct && typeof direct === 'object')
    return direct
  const pkg = await readJson<{ podium?: ThemeManifest }>(join(dir, 'package.json'))
  return pkg?.podium && typeof pkg.podium === 'object' ? pkg.podium : undefined
}

function themeIdFromPackage(name: string): string {
  const m = name.match(/^@slidev\/theme-(.+)$/) ?? name.match(/^slidev-theme-(.+)$/)
  return m ? m[1] : name
}

export function createTemplateRegistry(options: TemplateRegistryOptions): TemplateRegistry {
  const { runtime, resourcesDir } = options

  /** Folder of a theme or addon: in the deck's workspace, installed in the runtime, path-style relative to the deck, or shipped with the app. */
  async function packageFolder(raw: string, kind: 'theme' | 'addon', deckDir: string | undefined): Promise<{ dir: string, name?: string } | undefined> {
    if (isPathStyle(raw)) {
      const dir = resolve(deckDir ?? '.', raw)
      return existsSync(dir) ? { dir } : undefined
    }
    let name: string | undefined
    try {
      name = (await runtime.resolve(raw, kind, deckDir)).name
    }
    catch {
      name = undefined
    }
    const candidates = name ? [name] : []
    if (kind === 'theme') {
      const builtin = BUILTIN.find(b => b.id === raw)
      if (builtin)
        candidates.push(builtin.packageName)
    }
    for (const candidate of candidates) {
      const dir = runtime.packageDir(candidate, deckDir)
      if (dir)
        return { dir, name: candidate }
      const shipped = join(resourcesDir, 'templates', candidate)
      if (existsSync(shipped))
        return { dir: shipped, name: candidate }
    }
    return undefined
  }

  async function sourcesFor(deck: DeckRef): Promise<PackageSource[]> {
    const sources: PackageSource[] = []
    const theme = await packageFolder(deck.theme, 'theme', deck.dir)
    if (theme)
      sources.push({ origin: 'theme', packageName: theme.name, dir: theme.dir, manifest: await readManifest(theme.dir) })
    for (const addon of deck.addons) {
      const found = await packageFolder(addon, 'addon', deck.dir)
      if (found)
        sources.push({ origin: 'addon', packageName: found.name, dir: found.dir, manifest: await readManifest(found.dir) })
    }
    sources.push({ origin: 'deck', dir: deck.dir })
    return sources
  }

  async function layoutsIn(deck: DeckRef, locale: 'de' | 'en'): Promise<LayoutInfo[]> {
    const clientDir = runtime.packageDir('@slidev/client')
    return buildLayouts(clientDir ? join(clientDir, 'layouts') : undefined, await sourcesFor(deck), locale)
  }

  async function list(): Promise<TemplateInfo[]> {
    const locale = options.locale()
    const installed: InstalledPackage[] = await runtime.listInstalled().catch(() => [])
    const installedNames = new Set(installed.map(p => p.name))

    const result: TemplateInfo[] = []
    for (const b of BUILTIN) {
      const shipped = join(resourcesDir, 'templates', b.packageName)
      const dir = runtime.packageDir(b.packageName) ?? (existsSync(shipped) ? shipped : undefined)
      const manifest = dir ? await readManifest(dir) : undefined
      result.push({
        id: b.id,
        packageName: b.packageName,
        label: localize(manifest?.label ?? b.label, locale),
        description: localize(manifest?.description ?? b.description, locale),
        builtin: true,
        installed: installedNames.has(b.packageName) || runtime.packageDir(b.packageName) !== undefined,
        colors: manifest?.colors ?? b.colors,
      })
    }

    const builtinNames = new Set(BUILTIN.map(b => b.packageName))
    const others: TemplateInfo[] = []
    for (const pkg of installed) {
      if (pkg.kind !== 'theme' || builtinNames.has(pkg.name))
        continue
      const dir = runtime.packageDir(pkg.name) ?? pkg.dir
      const manifest = await readManifest(dir)
      const description = (await readJson<{ description?: string }>(join(dir, 'package.json')))?.description ?? ''
      others.push({
        id: themeIdFromPackage(pkg.name),
        packageName: pkg.name,
        label: localize(manifest?.label, locale) || themeLabel(pkg.name),
        description: localize(manifest?.description, locale) || description,
        builtin: false,
        installed: true,
        colors: manifest?.colors,
      })
    }
    others.sort((a, b) => a.label.localeCompare(b.label))
    return [...result, ...others]
  }

  async function agentsFile(deck: DeckRef & { title: string }): Promise<string> {
    return buildAgentsFile(deck, await layoutsIn(deck, 'en'))
  }

  async function starter(newDeck: NewDeckOptions): Promise<DeckStarter> {
    const locale = options.locale()
    const theme = await packageFolder(newDeck.template, 'theme', undefined)
    const manifest = theme ? await readManifest(theme.dir) : undefined

    let raw: string | undefined
    if (theme && manifest?.starter) {
      const base = join(theme.dir, manifest.starter)
      const localised = base.replace(/(\.[^./\\]+)$/, `.${locale}$1`)
      for (const file of locale === 'de' ? [base] : [localised, base]) {
        raw = await readFile(file, 'utf8').catch(() => undefined)
        if (raw !== undefined)
          break
      }
    }
    const slides = prepareStarter(raw ?? genericStarter(locale), newDeck.template, newDeck.title.trim() || (locale === 'de' ? 'Neue Präsentation' : 'New presentation'))

    const title = newDeck.title.trim() || 'Presentation'
    const dir = join(newDeck.parentDir, newDeck.folderName ?? slugify(title))
    return {
      slides,
      files: {
        'AGENTS.md': await agentsFile({ dir, theme: newDeck.template, addons: [], title }),
        'CLAUDE.md': CLAUDE_MD,
        '.gitignore': GITIGNORE,
      },
    }
  }

  return {
    list,
    layoutsFor: deck => layoutsIn(deck, options.locale()),
    starter,
    agentsFile,
  }
}

function themeLabel(packageName: string): string {
  const id = themeIdFromPackage(packageName).replace(/^@[^/]+\//, '')
  const words = id.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
