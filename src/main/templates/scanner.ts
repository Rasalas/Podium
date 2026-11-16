/**
 * Best-effort reading of a layout's .vue file: which slots it has and which props it reads.
 * No Vue compiler here on purpose, plain text scanning is enough for layouts and keeps
 * this module free of dependencies.
 */
import type { FieldType, LayoutField, LayoutSlot, Locale } from '../../shared/types'
import type { CatalogField, CatalogSlot } from './types'
import { localize } from './types'

export type PropKind = 'string' | 'boolean' | 'number' | 'other'

export interface ScannedProp {
  key: string
  kind: PropKind
}

export interface ScannedLayout {
  slots: string[]
  props: ScannedProp[]
}

const OPEN_TO_CLOSE: Record<string, string> = { '{': '}', '(': ')', '[': ']', '<': '>' }

/** Remove comments so they do not confuse the scanners. Keeps strings intact. */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '"' || c === '\'' || c === '`') {
      const end = skipString(src, i)
      out += src.slice(i, end)
      i = end
    }
    else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++
    }
    else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 2
    }
    else {
      out += c
      i++
    }
  }
  return out
}

function skipString(src: string, start: number): number {
  const quote = src[start]
  let i = start + 1
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\')
      i++
    i++
  }
  return i + 1
}

/** Text between the bracket at `start` and its partner, exclusive. Undefined if unbalanced. */
function readBalanced(src: string, start: number): string | undefined {
  const open = src[start]
  const close = OPEN_TO_CLOSE[open]
  if (!close)
    return undefined
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === '\'' || c === '`') {
      i = skipString(src, i) - 1
      continue
    }
    if (open === '<' && c === '=' && src[i + 1] === '>') {
      i++
      continue
    }
    if (c === open)
      depth++
    else if (c === close) {
      depth--
      if (depth === 0)
        return src.slice(start + 1, i)
    }
  }
  return undefined
}

/** Split at commas (and optionally semicolons and newlines) that are not nested. */
function splitTopLevel(body: string, separators: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '"' || c === '\'' || c === '`') {
      const end = skipString(body, i)
      current += body.slice(i, end)
      i = end - 1
      continue
    }
    if (c === '=' && body[i + 1] === '>') {
      current += '=>'
      i++
      continue
    }
    if ('{[(<'.includes(c))
      depth++
    else if ('}])>'.includes(c))
      depth--
    if (depth === 0 && separators.includes(c)) {
      parts.push(current)
      current = ''
    }
    else {
      current += c
    }
  }
  parts.push(current)
  return parts.map(p => p.trim()).filter(Boolean)
}

function kindFromRuntimeType(text: string): PropKind {
  const m = text.match(/\b(String|Boolean|Number)\b/)
  if (!m)
    return 'other'
  return m[1].toLowerCase() as PropKind
}

function kindFromTsType(text: string): PropKind {
  const t = text.trim()
  if (/^boolean\b/.test(t))
    return 'boolean'
  if (/^number\b/.test(t))
    return 'number'
  if (/^string\b/.test(t) || /^['"`]/.test(t))
    return 'string'
  return 'other'
}

function parseRuntimeProps(body: string): ScannedProp[] {
  const props: ScannedProp[] = []
  for (const entry of splitTopLevel(body, ',')) {
    const m = entry.match(/^['"]?([\w$-]+)['"]?\s*(?::\s*([\s\S]*))?$/)
    if (!m)
      continue
    const value = (m[2] ?? '').trim()
    let kind: PropKind = 'other'
    if (value.startsWith('{')) {
      const typeMatch = value.match(/\btype\s*:\s*([^,}]+)/)
      kind = typeMatch ? kindFromRuntimeType(typeMatch[1]) : 'other'
    }
    else {
      kind = kindFromRuntimeType(value)
    }
    props.push({ key: m[1], kind })
  }
  return props
}

function parseTypeLiteral(body: string): ScannedProp[] {
  const props: ScannedProp[] = []
  for (const entry of splitTopLevel(body, ',;\n')) {
    const m = entry.match(/^(?:readonly\s+)?['"]?([\w$-]+)['"]?\s*\??\s*:\s*([\s\S]+)$/)
    if (m)
      props.push({ key: m[1], kind: kindFromTsType(m[2]) })
  }
  return props
}

function scanProps(script: string): ScannedProp[] {
  const code = stripComments(script)
  const at = code.search(/\bdefineProps\b/)
  if (at !== -1) {
    let i = at + 'defineProps'.length
    while (/\s/.test(code[i] ?? ''))
      i++
    if (code[i] === '<') {
      const generic = readBalanced(code, i)
      if (generic === undefined)
        return []
      const trimmed = generic.trim()
      if (trimmed.startsWith('{'))
        return parseTypeLiteral(readBalanced(trimmed, 0) ?? '')
      // Reference to a named interface or type alias declared in the same file.
      const name = trimmed.match(/^[\w$]+/)?.[0]
      if (name) {
        const decl = code.match(new RegExp(`(?:interface\\s+${name}\\b[^{]*|type\\s+${name}\\s*=\\s*)\\{`))
        if (decl && decl.index !== undefined)
          return parseTypeLiteral(readBalanced(code, decl.index + decl[0].length - 1) ?? '')
      }
      return []
    }
    if (code[i] === '(') {
      const args = readBalanced(code, i)?.trim() ?? ''
      if (args.startsWith('{'))
        return parseRuntimeProps(readBalanced(args, 0) ?? '')
      if (args.startsWith('['))
        return splitTopLevel(readBalanced(args, 0) ?? '', ',').map(s => ({ key: s.replace(/^['"]|['"]$/g, ''), kind: 'other' as const }))
    }
    return []
  }
  // Options API: `props: { ... }` or `props: ['a', 'b']`
  const opt = code.match(/\bprops\s*:\s*([{[])/)
  if (opt && opt.index !== undefined) {
    const start = opt.index + opt[0].length - 1
    const inner = readBalanced(code, start) ?? ''
    return opt[1] === '{'
      ? parseRuntimeProps(inner)
      : splitTopLevel(inner, ',').map(s => ({ key: s.replace(/^['"]|['"]$/g, ''), kind: 'other' as const }))
  }
  return []
}

export function scanVue(source: string): ScannedLayout {
  const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const template = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '')

  const slots: string[] = []
  for (const m of template.matchAll(/<slot\b([^>]*?)\/?>/g)) {
    const attrs = m[1]
    if (/(?:^|\s)(?::|v-bind:)name\b/.test(attrs))
      continue
    const named = attrs.match(/(?:^|\s)name\s*=\s*["']([^"']+)["']/)
    const name = named ? named[1] : 'default'
    if (!slots.includes(name))
      slots.push(name)
  }
  // Default slot first, named ones in the order they appear.
  slots.sort((a, b) => Number(b === 'default') - Number(a === 'default'))

  const seen = new Set<string>()
  const props = scanProps(scripts).filter(p => !seen.has(p.key) && seen.add(p.key))
  return { slots, props }
}

// ---------------------------------------------------------------------------
// Turning scan results into picker data
// ---------------------------------------------------------------------------

/** "two-cols-header" and "backgroundSize" become "Two cols header" and "Background size". */
export function humanise(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const DE_WORDS: Record<string, string> = {
  default: 'Inhalt',
  left: 'Links',
  right: 'Rechts',
  top: 'Oben',
  bottom: 'Unten',
  header: 'Kopf',
  footer: 'Fuß',
  center: 'Mitte',
  title: 'Titel',
  content: 'Inhalt',
  image: 'Bild',
  background: 'Hintergrund',
  url: 'Adresse',
  color: 'Farbe',
  class: 'Zusatzklasse',
  scale: 'Größe',
  author: 'Autor',
  subtitle: 'Untertitel',
}

export function slotLabel(name: string, locale: Locale): string {
  if (locale === 'de' && DE_WORDS[name])
    return DE_WORDS[name]
  return name === 'default' ? 'Content' : humanise(name)
}

export function fieldLabel(key: string, locale: Locale): string {
  if (locale === 'de' && DE_WORDS[key])
    return DE_WORDS[key]
  return humanise(key)
}

export function fieldTypeFor(prop: ScannedProp): FieldType {
  const key = prop.key
  if (prop.kind === 'boolean')
    return 'boolean'
  if (prop.kind === 'number')
    return 'number'
  if (/(^|[a-z])(Image|Img|Photo|Picture)$|^(image|img|photo|picture|background|bg)$/i.test(key))
    return 'image'
  if (/(^|[a-z])(Url|Href|Link)$|^(url|href|link|src)$/i.test(key))
    return 'url'
  if (/(^|[a-z])(Color|Colour)$|^(color|colour)$/i.test(key))
    return 'color'
  return 'text'
}

export function scannedSlots(scan: ScannedLayout): CatalogSlot[] {
  return scan.slots.map(name => ({
    name,
    label: { de: slotLabel(name, 'de'), en: slotLabel(name, 'en') },
  }))
}

export function scannedFields(scan: ScannedLayout): CatalogField[] {
  return scan.props.map(p => ({
    key: p.key,
    type: fieldTypeFor(p),
    label: { de: fieldLabel(p.key, 'de'), en: fieldLabel(p.key, 'en') },
  }))
}

export function resolveSlots(slots: CatalogSlot[], locale: Locale): LayoutSlot[] {
  return slots.map(s => ({ name: s.name, label: localize(s.label, locale) }))
}

export function resolveFields(fields: CatalogField[], locale: Locale): LayoutField[] {
  return fields.map((f) => {
    const out: LayoutField = { key: f.key, type: f.type, label: localize(f.label, locale) }
    if (f.description !== undefined)
      out.description = localize(f.description, locale)
    if (f.options)
      out.options = f.options.map(o => ({ value: o.value, label: localize(o.label, locale) }))
    if (f.default !== undefined)
      out.default = f.default
    return out
  })
}

/** Placeholder markdown for a layout we know nothing about but its slots. */
export function starterFromSlots(slots: string[], title: string, text: string): string {
  const parts: string[] = []
  if (slots.length === 0 || slots.includes('default'))
    parts.push(`# ${title}\n\n${text}`)
  for (const name of slots.filter(s => s !== 'default'))
    parts.push(`::${name}::\n\n${text}`)
  return parts.join('\n\n')
}
