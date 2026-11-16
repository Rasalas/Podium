/** Builds the layout list for a deck from Slidev's base layouts, the theme, addons and the deck itself. */
import type { LayoutInfo, Locale } from '../../shared/types'
import type { CatalogField, CatalogSlot, LayoutMeta, ThemeManifest } from './types'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE_CATALOG, CATEGORY_ORDER, LAYOUT_PRIORITY, THEME_CATALOG } from './catalog'
import { humanise, resolveFields, resolveSlots, scannedFields, scannedSlots, scanVue, starterFromSlots } from './scanner'
import { localize } from './types'

export interface PackageSource {
  origin: 'theme' | 'addon' | 'deck'
  /** npm package name, when there is one. Selects THEME_CATALOG entries. */
  packageName?: string
  dir: string
  manifest?: ThemeManifest
}

/** Props that every layout may have; scanned values for catalog layouts are noise. */
const GENERIC_PROPS = new Set(['class', 'layoutClass'])

async function vueFiles(dir: string): Promise<{ name: string, file: string }[]> {
  if (!existsSync(dir))
    return []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.vue'))
    .map(e => ({ name: e.name.slice(0, -4), file: join(dir, e.name) }))
}

interface Draft {
  meta: Required<Pick<LayoutMeta, 'slots' | 'fields'>> & LayoutMeta
  origin: LayoutInfo['origin']
}

function mergeUnique<T>(base: T[], extra: T[], key: (t: T) => string, skip: (t: T) => boolean = () => false): T[] {
  const have = new Set(base.map(key))
  return [...base, ...extra.filter(e => !have.has(key(e)) && !skip(e))]
}

/**
 * One layout from one source. Precedence for each piece of information:
 * manifest, then catalog, then what the scanner found in the file.
 */
async function draftFor(
  name: string,
  file: string | undefined,
  origin: LayoutInfo['origin'],
  manifest: LayoutMeta | undefined,
  themeCatalog: LayoutMeta | undefined,
  previous: Draft | undefined,
): Promise<Draft> {
  const scan = file ? scanVue(await readFile(file, 'utf8').catch(() => '')) : undefined
  const catalog = BASE_CATALOG[name]
  const known = { ...catalog, ...themeCatalog }
  const hasCatalog = Boolean(catalog || themeCatalog)

  let slots: CatalogSlot[] = known.slots ?? previous?.meta.slots ?? []
  let fields: CatalogField[] = known.fields ?? previous?.meta.fields ?? []
  if (scan) {
    // The base catalog describes Slidev's own file. A theme may add slots or props to a known layout.
    const sSlots = scannedSlots(scan)
    const sFields = scannedFields(scan)
    if (hasCatalog && origin === 'slidev') {
      // Slidev's own file is what the catalog describes. Nothing to add.
    }
    else if (hasCatalog) {
      slots = mergeUnique(slots, sSlots, s => s.name)
      fields = mergeUnique(fields, sFields, f => f.key, f => GENERIC_PROPS.has(f.key))
    }
    else {
      slots = sSlots
      fields = sFields
    }
  }

  const fallbackLabel = humanise(name)
  const meta: Draft['meta'] = {
    label: known.label ?? previous?.meta.label ?? fallbackLabel,
    description: known.description ?? previous?.meta.description ?? {
      de: origin === 'deck' ? 'Eigene Anordnung dieser Präsentation.' : 'Anordnung aus der Vorlage.',
      en: origin === 'deck' ? 'This presentation\'s own layout.' : 'Layout from the template.',
    },
    category: known.category ?? previous?.meta.category ?? 'special',
    sketch: known.sketch ?? previous?.meta.sketch ?? 'generic',
    slots,
    fields,
    starter: known.starter ?? previous?.meta.starter,
    hidden: known.hidden ?? previous?.meta.hidden,
  }

  if (manifest) {
    if (manifest.label !== undefined) meta.label = manifest.label
    if (manifest.description !== undefined) meta.description = manifest.description
    if (manifest.category) meta.category = manifest.category
    if (manifest.sketch) meta.sketch = manifest.sketch
    if (manifest.slots) meta.slots = manifest.slots
    if (manifest.fields) meta.fields = manifest.fields
    if (manifest.starter !== undefined) meta.starter = manifest.starter
    if (manifest.hidden !== undefined) meta.hidden = manifest.hidden
  }
  return { meta, origin }
}

function toInfo(name: string, draft: Draft, locale: Locale): LayoutInfo {
  const { meta } = draft
  const slotNames = meta.slots.map(s => s.name)
  const label = localize(meta.label, locale)
  const starter = meta.starter !== undefined
    ? localize(meta.starter, locale)
    : starterFromSlots(slotNames, label, 'Text')
  const info: LayoutInfo = {
    name,
    label,
    description: localize(meta.description, locale),
    origin: draft.origin,
    slots: resolveSlots(meta.slots, locale),
    fields: resolveFields(meta.fields, locale),
    sketch: meta.sketch ?? 'generic',
    starter,
    category: meta.category ?? 'special',
  }
  if (meta.hidden)
    info.hidden = true
  return info
}

export function sortLayouts(layouts: LayoutInfo[]): LayoutInfo[] {
  const priority = (name: string) => {
    const i = LAYOUT_PRIORITY.indexOf(name)
    return i === -1 ? LAYOUT_PRIORITY.length : i
  }
  return [...layouts].sort((a, b) => {
    if (Boolean(a.hidden) !== Boolean(b.hidden))
      return a.hidden ? 1 : -1
    const c = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    if (c !== 0)
      return c
    const p = priority(a.name) - priority(b.name)
    return p !== 0 ? p : a.label.localeCompare(b.label)
  })
}

export async function buildLayouts(
  baseLayoutsDir: string | undefined,
  sources: PackageSource[],
  locale: Locale,
): Promise<LayoutInfo[]> {
  const drafts = new Map<string, Draft>()

  // Slidev's own layouts. If the folder is missing, fall back to the catalog so the picker is never empty.
  const baseFiles = baseLayoutsDir ? await vueFiles(baseLayoutsDir) : []
  const baseNames = baseFiles.length > 0 ? baseFiles : Object.keys(BASE_CATALOG).map(name => ({ name, file: undefined }))
  for (const { name, file } of baseNames)
    drafts.set(name, await draftFor(name, file, 'slidev', undefined, undefined, undefined))

  for (const source of sources) {
    const files = await vueFiles(join(source.dir, 'layouts'))
    const themeCatalog = source.packageName ? THEME_CATALOG[source.packageName] : undefined
    for (const { name, file } of files) {
      drafts.set(name, await draftFor(name, file, source.origin, source.manifest?.layouts?.[name], themeCatalog?.[name], drafts.get(name)))
    }
    // The manifest may also restyle layouts the theme inherits from Slidev.
    for (const [name, manifest] of Object.entries(source.manifest?.layouts ?? {})) {
      const existing = drafts.get(name)
      if (existing && !files.some(f => f.name === name))
        drafts.set(name, await draftFor(name, undefined, source.origin, manifest, undefined, existing))
    }
    // Same for the official themes' catalog entries.
    for (const [name, meta] of Object.entries(themeCatalog ?? {})) {
      const existing = drafts.get(name)
      if (existing && !files.some(f => f.name === name))
        drafts.set(name, await draftFor(name, undefined, source.origin, source.manifest?.layouts?.[name], meta, existing))
    }
  }

  return sortLayouts([...drafts].map(([name, draft]) => toInfo(name, draft, locale)))
}
