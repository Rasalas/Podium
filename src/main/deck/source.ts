/**
 * Line-preserving model of one markdown file: a list of slide units.
 *
 * `@slidev/parser`'s `save()` re-stringifies slides (`prettifySlide` rewrites the raw of
 * every touched slide and `stringify` normalises separators), so instead we keep each
 * slide's original lines and only re-render a unit when it changed. Slide boundaries come
 * from `parseSync`, which is the same splitter `load()` uses, so unit indices equal
 * `SourceSlideInfo.index`.
 */
import { parseSync } from '@slidev/parser'
import YAML, { isMap, isScalar, type Pair } from 'yaml'
import { isDeckKey } from './keys'

export interface UnitFrontmatter {
  style: 'frontmatter' | 'yaml'
  /** Original lines including the fences, used for an untouched block and for its fence style. */
  lines: string[]
  doc: YAML.Document
  dirty: boolean
}

export interface Unit {
  id: string
  /** Lines before the slide proper: a bare `---` separator (and leading blanks for yaml-style frontmatter). */
  sep: string[]
  fm?: UnitFrontmatter
  body: string[]
  /** Lines as read from disk; undefined for new units. */
  orig?: string[]
  origPos: number
  wasLast: boolean
  dirty: boolean
}

export interface SourceFile {
  path: string
  bom: boolean
  eol: '\n' | '\r\n'
  units: Unit[]
  /** Lines after the last slide (e.g. a trailing `---`). */
  tail: string[]
}

let idCounter = 0
export function newUnitId(): string {
  idCounter++
  return `s${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function parseSourceFile(path: string, text: string): SourceFile {
  const bom = text.startsWith('﻿')
  if (bom)
    text = text.slice(1)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const md = parseSync(normalized, path)
  const units: Unit[] = []
  let segStart = 0
  md.slides.forEach((slide, k) => {
    const end = slide.end
    let sep = lines.slice(segStart, slide.start)
    let fm: UnitFrontmatter | undefined
    let body: string[]
    if (slide.frontmatterStyle === 'frontmatter' && slide.frontmatterDoc) {
      const contentStart = Math.min(slide.contentStart, end)
      fm = { style: 'frontmatter', lines: lines.slice(slide.start, contentStart), doc: slide.frontmatterDoc as YAML.Document, dirty: false }
      body = lines.slice(contentStart, end)
    }
    else if (slide.frontmatterStyle === 'yaml' && slide.frontmatterDoc) {
      const region = lines.slice(slide.start, end)
      let open = 0
      while (open < region.length && region[open].trim() === '')
        open++
      let close = open + 1
      while (close < region.length && !region[close].trimStart().startsWith('```'))
        close++
      sep = [...sep, ...region.slice(0, open)]
      fm = { style: 'yaml', lines: region.slice(open, close + 1), doc: slide.frontmatterDoc as YAML.Document, dirty: false }
      body = region.slice(close + 1)
    }
    else {
      body = lines.slice(slide.start, end)
    }
    units.push({
      id: newUnitId(),
      sep,
      fm,
      body,
      orig: lines.slice(segStart, end),
      origPos: k,
      wasLast: k === md.slides.length - 1,
      dirty: false,
    })
    segStart = end
  })
  return { path, bom, eol, units, tail: lines.slice(segStart) }
}

function renderFrontmatter(fm: UnitFrontmatter): string[] {
  const yaml = fm.doc.toString().replace(/\s+$/, '').split('\n')
  while (yaml.length && yaml[0].trim() === '')
    yaml.shift()
  const open = fm.lines[0] ?? (fm.style === 'yaml' ? '```yaml' : '---')
  const close = fm.lines.length > 1 ? fm.lines.at(-1)! : (fm.style === 'yaml' ? '```' : '---')
  return [open, ...yaml, close]
}

function isBareSeparator(line: string | undefined): boolean {
  return !!line && line.startsWith('---')
}

function renderUnit(unit: Unit, pos: number): string[] {
  const fmLines = unit.fm ? (unit.fm.dirty || !unit.fm.lines.length ? renderFrontmatter(unit.fm) : unit.fm.lines) : []
  const samePos = pos === unit.origPos && !!unit.orig
  if (unit.fm?.style === 'frontmatter') {
    // The opening `---` doubles as the slide separator, so a former bare separator goes.
    const keepSep = samePos && !unit.sep.some(l => l.startsWith('---'))
    return [...(keepSep ? unit.sep : []), ...fmLines, ...unit.body]
  }
  let rest = [...fmLines, ...unit.body]
  if (pos === 0) {
    if (samePos)
      return [...unit.sep, ...rest]
    while (rest.length > 1 && rest[0].trim() === '')
      rest.shift()
    return rest.length ? rest : ['']
  }
  const sep = samePos && isBareSeparator(unit.sep.find(l => l.trim() !== '')) ? unit.sep : ['---']
  // A bare separator followed by a non-blank line would start a frontmatter block.
  const sepLine = sep.findLast(l => l.trim() !== '') ?? '---'
  if (sepLine[3] !== '-' && (rest.length === 0 || rest[0].trim() !== ''))
    rest = ['', ...rest]
  return [...sep, ...rest]
}

export function serializeSourceFile(file: SourceFile): string {
  const out: string[] = []
  const n = file.units.length
  file.units.forEach((unit, pos) => {
    const untouched = !unit.dirty && !unit.fm?.dirty && unit.orig && pos === unit.origPos
    const lines = untouched ? [...unit.orig!] : renderUnit(unit, pos)
    if (lines.length === 0)
      lines.push('')
    const moved = !unit.orig || pos !== unit.origPos || unit.dirty || unit.wasLast
    if (pos < n - 1 && moved && lines.at(-1)!.trim() !== '')
      lines.push('')
    out.push(...lines)
  })
  out.push(...file.tail)
  if (n > 0 && file.tail.length === 0 && out.at(-1) !== '' && file.units.at(-1)!.dirty) {
    // A rewritten last slide keeps the file ending with a newline.
    out.push('')
  }
  let text = out.join('\n')
  if (file.eol === '\r\n')
    text = text.replace(/\n/g, '\r\n')
  return (file.bom ? '﻿' : '') + text
}

// ---------------------------------------------------------------------------
// Body: content and note
// ---------------------------------------------------------------------------

export interface BodyParts {
  lead: string
  content: string
  gap: string
  noteRaw: string
  trail: string
}

const RE_COMMENT = /<!--([\s\S]*?)-->/g

/** Same content/note split as `parseSlide` in @slidev/parser. */
export function splitBody(text: string): BodyParts {
  const startTrimmed = text.trimStart()
  const lead = text.slice(0, text.length - startTrimmed.length)
  const core = startTrimmed.trimEnd()
  const trail = startTrimmed.slice(core.length)
  const comments = Array.from(core.matchAll(RE_COMMENT))
  const last = comments.at(-1)
  if (last && last.index + last[0].length >= core.length) {
    const before = core.slice(0, last.index)
    const content = before.trimEnd()
    return { lead, content, gap: before.slice(content.length), noteRaw: last[0], trail }
  }
  return { lead, content: core, gap: '', noteRaw: '', trail }
}

function joinBody(parts: BodyParts): string[] {
  let text = parts.lead + parts.content
  if (parts.noteRaw)
    text += (parts.content ? parts.gap : '') + parts.noteRaw
  text += parts.trail
  return text.split('\n')
}

function freshParts(parts: BodyParts): BodyParts {
  if (parts.content || parts.noteRaw)
    return parts
  return { ...parts, lead: '\n', trail: '\n' }
}

export function unitContent(unit: Unit): string {
  return splitBody(unit.body.join('\n')).content
}

export function setUnitContent(unit: Unit, content: string): void {
  const parts = freshParts(splitBody(unit.body.join('\n')))
  const next = content.replace(/\r\n/g, '\n').replace(/^\s*\n/, '').trimEnd()
  if (next === parts.content)
    return
  if (!parts.content && parts.noteRaw && !parts.gap)
    parts.gap = '\n\n'
  parts.content = next
  unit.body = joinBody(parts)
  unit.dirty = true
}

export function setUnitNote(unit: Unit, note: string): void {
  const parts = freshParts(splitBody(unit.body.join('\n')))
  const text = note.replace(/\r\n/g, '\n').trim().replace(/-->/g, '-- >')
  const old = parts.noteRaw ? parts.noteRaw.slice(4, -3).trim() : ''
  if (old === text)
    return
  if (!text)
    parts.noteRaw = ''
  else {
    const block = text.includes('\n') || /^<!--\s*\n/.test(parts.noteRaw)
    parts.noteRaw = block ? `<!--\n${text}\n-->` : `<!-- ${text} -->`
    if (!parts.gap)
      parts.gap = '\n\n'
  }
  unit.body = joinBody(parts)
  unit.dirty = true
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export function pairKey(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key)
}

function pairsOf(doc: YAML.Document | undefined): Pair[] {
  return doc && isMap(doc.contents) ? (doc.contents.items as Pair[]) : []
}

export function frontmatterOf(unit: Unit): Record<string, unknown> {
  const json = unit.fm?.doc.toJSON()
  return json && typeof json === 'object' && !Array.isArray(json) ? json : {}
}

export function parseYamlMap(raw: string): YAML.Document {
  const doc = YAML.parseDocument(raw)
  if (doc.errors.length)
    throw new Error(`Die Folien-Einstellungen (YAML) sind fehlerhaft: ${doc.errors[0].message.split('\n')[0]}`)
  if (doc.contents !== null && !isMap(doc.contents))
    throw new Error('Die Folien-Einstellungen müssen aus Einträgen der Form "name: wert" bestehen.')
  return doc
}

/** Replace the unit's frontmatter document. An empty map removes the block. */
export function setUnitDoc(unit: Unit, doc: YAML.Document | undefined): void {
  unit.dirty = true
  if (!doc || pairsOf(doc).length === 0) {
    unit.fm = undefined
    return
  }
  unit.fm = { style: unit.fm?.style ?? 'frontmatter', lines: unit.fm?.lines ?? [], doc, dirty: true }
}

function ensureDoc(unit: Unit): YAML.Document {
  if (!unit.fm)
    unit.fm = { style: 'frontmatter', lines: [], doc: new YAML.Document({}), dirty: true }
  if (!isMap(unit.fm.doc.contents))
    unit.fm.doc.contents = unit.fm.doc.createNode({}) as any
  return unit.fm.doc
}

export function patchUnitFrontmatter(unit: Unit, patch: Record<string, unknown>): boolean {
  const current = frontmatterOf(unit)
  let changed = false
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) {
      if (unit.fm && unit.fm.doc.has(key)) {
        unit.fm.doc.delete(key)
        changed = true
      }
    }
    else if (JSON.stringify(current[key]) !== JSON.stringify(value)) {
      const doc = ensureDoc(unit)
      doc.set(key, doc.createNode(value))
      changed = true
    }
  }
  if (!changed)
    return false
  unit.dirty = true
  if (unit.fm) {
    unit.fm.dirty = true
    if (pairsOf(unit.fm.doc).length === 0)
      unit.fm = undefined
  }
  return true
}

function filteredDoc(doc: YAML.Document, keep: (key: string) => boolean): YAML.Document {
  const clone = doc.clone()
  if (isMap(clone.contents))
    clone.contents.items = (clone.contents.items as Pair[]).filter(p => keep(pairKey(p)))
  return clone
}

/** Deck-level part of the entry's first frontmatter block. */
export function deckDoc(doc: YAML.Document): YAML.Document {
  return filteredDoc(doc, isDeckKey)
}

/** Slide-level part of the entry's first frontmatter block. */
export function slideDoc(doc: YAML.Document): YAML.Document {
  return filteredDoc(doc, key => !isDeckKey(key))
}

export function hasDeckKeys(doc: YAML.Document | undefined): boolean {
  return pairsOf(doc).some(p => isDeckKey(pairKey(p)))
}

export function docToRaw(doc: YAML.Document): string {
  return pairsOf(doc).length ? doc.toString().replace(/\s+$/, '') : ''
}

/**
 * Combine the deck-level keys of `deck` with the slide-level frontmatter `slide` into one
 * first block. Deck keys come first; a deck key in `slide` that `deck` already has loses.
 */
export function mergeHeadmatter(deck: YAML.Document, slide: YAML.Document | undefined): YAML.Document {
  const merged = deckDoc(deck)
  if (!isMap(merged.contents))
    merged.contents = merged.createNode({}) as any
  const items = (merged.contents as YAML.YAMLMap).items as Pair[]
  for (const pair of pairsOf(slide)) {
    const key = pairKey(pair)
    const existing = items.findIndex(p => pairKey(p) === key)
    if (existing >= 0) {
      if (isDeckKey(key))
        continue
      items.splice(existing, 1)
    }
    items.push(pair.clone() as Pair)
  }
  return merged
}

/**
 * Keep the deck configuration in the entry file's first block after the first unit
 * changed (insert at the start, move, remove). `oldFirst` is the unit that held the
 * headmatter before; it may have been removed from the file already.
 */
export function moveHeadmatter(file: SourceFile, oldFirst: Unit | undefined): void {
  const newFirst = file.units[0]
  if (!oldFirst || oldFirst === newFirst || !oldFirst.fm || !hasDeckKeys(oldFirst.fm.doc))
    return
  const original = oldFirst.fm.doc
  if (file.units.includes(oldFirst))
    setUnitDoc(oldFirst, slideDoc(original))
  if (newFirst)
    setUnitDoc(newFirst, mergeHeadmatter(original, newFirst.fm?.doc))
}
