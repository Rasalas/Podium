/**
 * Editing text the canvas cannot treat as a markdown block: HTML in the slide, a heading with
 * an icon in it, text a layout shows from the slide's settings (a kicker, a footer).
 *
 * The canvas only knows what the browser rendered: one text node before and after the edit.
 * This module finds where that text comes from, in the slide's content, its frontmatter or the
 * deck's headmatter, and changes just that. When the place is not certain it changes nothing,
 * because a wrong guess would silently edit a different sentence.
 */
import type { TextEdit } from '../../shared/types'
import type { Unit } from './source'
import YAML, { isMap, isScalar, isSeq } from 'yaml'
import { findBlock, normalizeText, parseContent } from './blocks'
import { setUnitContent, unitContent } from './source'

export class TextEditError extends Error {}

const NOT_FOUND = 'Dieser Text kommt nicht aus der Folie selbst, sondern aus der Vorlage. Hier lässt er sich nicht ändern.'
const AMBIGUOUS = 'Dieser Text steht mehrfach in der Folie, deshalb ist nicht sicher, welche Stelle gemeint ist. Bitte ändere ihn im Quelltext.'

interface Span { start: number, end: number }

/** What the browser shows → how it may be written in the source. */
const VARIANTS: Record<string, string> = {
  '"': '(?:"|&quot;|[“”„])',
  '“': '(?:“|"|&ldquo;)',
  '”': '(?:”|"|&rdquo;)',
  '„': '(?:„|"|&bdquo;)',
  '\'': '(?:\'|&#39;|&apos;|[‘’])',
  '’': '(?:’|\'|&rsquo;)',
  '‘': '(?:‘|\'|&lsquo;)',
  '–': '(?:–|--|&ndash;)',
  '—': '(?:—|---|&mdash;)',
  '…': '(?:…|\\.\\.\\.|&hellip;)',
  '&': '(?:&amp;|&)',
  '<': '(?:&lt;|<)',
  '>': '(?:&gt;|>)',
  '·': '(?:·|&middot;)',
  '©': '(?:©|&copy;|\\(c\\))',
}

/** Regex source matching `text` in a source file: any whitespace run for a space, entities for special characters. */
function tolerant(text: string): string {
  let out = ''
  for (const char of text) {
    if (char === ' ')
      out += '(?:\\s|&nbsp;)+'
    else if (VARIANTS[char])
      out += VARIANTS[char]
    else
      out += char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  return out
}

/** Parts of the content that never show up as text: tags, comments, code fences, link targets. */
function hiddenSpans(content: string): Span[] {
  const spans: Span[] = []
  const patterns = [
    /<!--[\s\S]*?-->/g,
    /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm,
    /<\/?[a-z][^<>]*>/gi,
    /\]\([^)\n]*\)/g,
    /\{\{[\s\S]*?\}\}/g,
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern))
      spans.push({ start: match.index, end: match.index + match[0].length })
  }
  return spans
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end
const RE_WORD = /[\p{L}\p{N}]/u
/** Characters that end a text node on its left: a tag, a markdown marker, an opening quote or bracket. */
const LEFT_DELIMITERS = new Set([...'>*_~`|#-+.):"\'([{!'])
const RIGHT_DELIMITERS = new Set([...'<*_~`|[({"\'!]'])

/**
 * Does the match stand on its own, the way a whole text node does? A node never starts or ends
 * in the middle of a sentence, so "Set" must not match inside "Das Set steht".
 */
function standsAlone(content: string, span: Span): boolean {
  let i = span.start - 1
  while (i >= 0 && (content[i] === ' ' || content[i] === '\t'))
    i--
  const leftOk = i < 0 || content[i] === '\n' || LEFT_DELIMITERS.has(content[i])
  let j = span.end
  while (j < content.length && (content[j] === ' ' || content[j] === '\t'))
    j++
  const rightOk = j >= content.length || content[j] === '\n' || RIGHT_DELIMITERS.has(content[j])
  return leftOk && rightOk
}

function wordBounded(content: string, span: Span): boolean {
  const before = content[span.start - 1]
  const after = content[span.end]
  const first = content[span.start]
  const last = content[span.end - 1]
  // Only letters next to letters glue a word together.
  const glued = (a: string | undefined, b: string | undefined) => !!a && !!b && RE_WORD.test(a) && RE_WORD.test(b)
  return !glued(before, first) && !glued(last, after)
}

function findAll(content: string, text: string, within: Span, accept: (span: Span) => boolean): Span[] {
  if (!text)
    return []
  const hidden = hiddenSpans(content)
  const found: Span[] = []
  for (const match of content.matchAll(new RegExp(tolerant(text), 'gu'))) {
    const span = { start: match.index, end: match.index + match[0].length }
    if (span.start < within.start || span.end > within.end || !match[0].length)
      continue
    if (hidden.some(h => overlaps(h, span)) || !accept(span))
      continue
    found.push(span)
  }
  return found
}

/** `<` typed by the user must stay text, not start a tag. */
function escapeForContent(text: string): string {
  return text.replace(/</g, '&lt;')
}

function lineSpan(lines: string[], line0: number, line1: number): Span {
  let start = 0
  for (let i = 0; i < line0; i++)
    start += lines[i].length + 1
  let end = start
  for (let i = line0; i < line1 && i < lines.length; i++)
    end += lines[i].length + 1
  return { start, end: Math.max(start, end - 1) }
}

/**
 * When the whole text node is not in the source as shown (an interpolation, an unusual entity),
 * look for just the changed words, with as little context as makes them unique.
 */
function changedPart(content: string, before: string, after: string, within: Span): { span: Span, text: string } | undefined {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before.at(-1 - suffix) === after.at(-1 - suffix))
    suffix++
  // Grow to whole words, then word by word, until the old words occur exactly once.
  let from = prefix
  let to = before.length - suffix
  const growLeft = () => {
    while (from > 0 && before[from - 1] !== ' ')
      from--
  }
  const growRight = () => {
    while (to < before.length && before[to] !== ' ')
      to++
  }
  growLeft()
  growRight()
  for (let round = 0; round < 6; round++) {
    const old = before.slice(from, to)
    if (old.trim()) {
      const matches = findAll(content, old, within, span => wordBounded(content, span))
      if (matches.length === 1)
        return { span: matches[0], text: after.slice(from, after.length - (before.length - to)) }
      if (matches.length === 0)
        return undefined
    }
    if (from === 0 && to === before.length)
      return undefined
    if (from > 0) {
      from--
      growLeft()
    }
    if (to < before.length) {
      to++
      growRight()
    }
  }
  return undefined
}

/** The new content, `undefined` when the text is not in it, or a TextEditError when the place is unclear. */
export function editTextInContent(content: string, edit: TextEdit): string | undefined {
  const before = normalizeText(edit.before)
  const after = normalizeText(edit.after)
  if (!before || before === after)
    return undefined
  const parsed = parseContent(content)
  const everything: Span = { start: 0, end: content.length }
  const apply = (span: Span, text: string) => content.slice(0, span.start) + escapeForContent(text) + content.slice(span.end)

  if (edit.block) {
    const block = findBlock(parsed, edit.block)
    const within = lineSpan(parsed.lines, block.line0, block.line1)
    let matches = findAll(content, before, within, span => standsAlone(content, span))
    if (!matches.length)
      matches = findAll(content, before, within, span => wordBounded(content, span))
    const hit = matches.length === edit.total ? matches[edit.occurrence] : (matches.length === 1 ? matches[0] : undefined)
    if (hit)
      return apply(hit, after)
    if (matches.length > 1)
      throw new TextEditError(AMBIGUOUS)
    const part = changedPart(content, before, after, within)
    return part ? apply(part.span, part.text) : undefined
  }

  // Text outside the markdown blocks the canvas edits on its own: leave those lines out.
  const blockSpans = parsed.blocks.map(block => lineSpan(parsed.lines, block.line0, block.line1))
  const outsideBlocks = (span: Span) => !blockSpans.some(b => overlaps(b, span))
  const matches = findAll(content, before, everything, span => standsAlone(content, span) && outsideBlocks(span))
  if (matches.length === 1)
    return apply(matches[0], after)
  if (matches.length > 1) {
    if (matches.length === edit.total)
      return apply(matches[edit.occurrence], after)
    throw new TextEditError(AMBIGUOUS)
  }
  return undefined
}

/** Paths of string values in a YAML document that show as `text`. */
function yamlPaths(doc: YAML.Document | undefined, text: string): (string | number)[][] {
  const found: (string | number)[][] = []
  const visit = (node: unknown, path: (string | number)[]) => {
    if (isScalar(node)) {
      if (typeof node.value === 'string' && normalizeText(node.value) === text)
        found.push(path)
    }
    else if (isMap(node)) {
      for (const pair of node.items) {
        if (isScalar(pair.key))
          visit(pair.value, [...path, String(pair.key.value)])
      }
    }
    else if (isSeq(node)) {
      node.items.forEach((item, index) => visit(item, [...path, index]))
    }
  }
  visit(doc?.contents, [])
  return found
}

function setYamlText(unit: Unit, path: (string | number)[], text: string): void {
  const node = unit.fm!.doc.getIn(path, true)
  // Keeping the node keeps its quoting and comment.
  if (isScalar(node))
    node.value = text
  else
    unit.fm!.doc.setIn(path, text)
  unit.fm!.dirty = true
  unit.dirty = true
}

/**
 * Apply a text edit from the canvas to a slide. `head` is the deck's first unit when the slide
 * is a different one: layouts also show deck-wide settings such as a footer.
 */
export function editTextInUnit(unit: Unit, head: Unit | undefined, edit: TextEdit): void {
  const content = unitContent(unit)
  const next = editTextInContent(content, edit)
  if (next !== undefined) {
    setUnitContent(unit, next)
    return
  }
  if (!edit.block) {
    const before = normalizeText(edit.before)
    const after = normalizeText(edit.after)
    const own = yamlPaths(unit.fm?.doc, before)
    const deck = head ? yamlPaths(head.fm?.doc, before) : []
    // The slide's own setting wins over a deck-wide one of the same text.
    const [target, paths] = own.length ? [unit, own] as const : [head, deck] as const
    if (target && paths.length === 1) {
      setYamlText(target, paths[0], after)
      return
    }
    if (paths.length > 1)
      throw new TextEditError(AMBIGUOUS)
    // Last resort: the changed words alone, anywhere in the slide's content.
    const part = changedPart(content, before, after, { start: 0, end: content.length })
    if (part) {
      setUnitContent(unit, content.slice(0, part.span.start) + escapeForContent(part.text) + content.slice(part.span.end))
      return
    }
  }
  throw new TextEditError(NOT_FOUND)
}
