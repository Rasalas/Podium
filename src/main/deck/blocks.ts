/**
 * Markdown blocks inside one slide's content: the same blocks the launcher tags on the
 * canvas (`podiumBlocks` in launcher/launcher.mjs), slots, editability, and the line
 * edits behind editBlock / splitListItem / removeBlock / insertBlock / setSlot.
 *
 * All functions work on the slide content (markdown without frontmatter and note) and
 * return new content. Lines that are not touched stay byte-identical.
 */
import type { BlockKind, BlockRef, Editability, SlotContent } from '../../shared/types'
import MarkdownItCtor, { type MarkdownIt, type StateBlock, type Token } from 'markdown-it'

// Same marker syntax and rule placement as Slidev's slot sugar (node/syntax/slot-sugar.ts).
const RE_SLOT_MARKER = /^::\s*([\w.\-:]+)\s*::\s*$/

function slotSugar(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'slot_marker', (state: StateBlock, startLine: number, _endLine: number, silent: boolean) => {
    if (state.sCount[startLine] - state.blkIndent > 0)
      return false
    const pos = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]
    const match = state.src.slice(pos, max).match(RE_SLOT_MARKER)
    if (!match)
      return false
    if (silent)
      return true
    const token = state.push('slot_marker', '', 0)
    token.meta = { slotName: match[1] }
    token.map = [startLine, startLine + 1]
    state.line = startLine + 1
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}

const md = new MarkdownItCtor({ html: true, linkify: true })
md.use(slotSugar)

// Same list as PLAIN_INLINE in launcher/launcher.mjs.
const PLAIN_INLINE = new Set([
  'text',
  'softbreak',
  'hardbreak',
  'strong_open',
  'strong_close',
  'em_open',
  'em_close',
  's_open',
  's_close',
  'code_inline',
  'link_open',
  'link_close',
])

const RE_TASK = /^\[[ xX]\]\s+/

function isPlainInline(children: Token[] | null): boolean {
  // An empty block (a heading or item the user has not typed into yet) is editable.
  if (!children?.length)
    return true
  return children.every(child => PLAIN_INLINE.has(child.type) && !(child.type === 'text' && /\{\{|\}\}/.test(child.content)))
}

export type BlockTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'li'

export interface Block {
  tag: BlockTag
  /** Rendered plain text, whitespace collapsed. */
  text: string
  /** Content-relative line range [line0, line1). */
  line0: number
  line1: number
  editable: boolean
  /** Open tokens of the containers, outermost first. */
  ancestors: Token[]
  open: Token
  /** Undefined for an empty list item ("- "), which has no paragraph. */
  inline?: Token
  /** Index of `open` in the token stream. */
  index: number
  slot: string
}

export interface SlotRange {
  name: string
  /** Line of the `::name::` marker, -1 for the default slot. */
  marker: number
  /** Content lines [start, end). */
  start: number
  end: number
}

export interface ParsedContent {
  lines: string[]
  tokens: Token[]
  blocks: Block[]
  slots: SlotRange[]
}

export function normalizeText(text: string): string {
  return text.replace(/[\s ]+/g, ' ').trim()
}

/** The text a browser shows for these inline tokens. */
export function inlineText(children: Token[] | null): string {
  let out = ''
  for (const child of children ?? []) {
    if (child.type === 'text' || child.type === 'code_inline')
      out += child.content
    else if (child.type === 'softbreak' || child.type === 'hardbreak')
      out += ' '
  }
  return normalizeText(out)
}

export function splitLines(content: string): string[] {
  return content.split('\n')
}

export function parseContent(content: string): ParsedContent {
  const lines = splitLines(content)
  const tokens = md.parse(content, {})
  const slots: SlotRange[] = [{ name: 'default', marker: -1, start: 0, end: lines.length }]
  for (const token of tokens) {
    if (token.type === 'slot_marker' && token.map) {
      const line = token.map[0]
      slots[slots.length - 1].end = line
      slots.push({ name: String(token.meta?.slotName), marker: line, start: line + 1, end: lines.length })
    }
  }
  const slotAt = (line: number) => {
    let name = 'default'
    for (const slot of slots) {
      if (slot.marker >= 0 && slot.marker < line)
        name = slot.name
    }
    return name
  }

  const blocks: Block[] = []
  const stack: Token[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.nesting === -1) {
      stack.pop()
      continue
    }
    if (token.type === 'list_item_open' && tokens[i + 1]?.type === 'list_item_close' && token.map) {
      // "- " has no paragraph token; the launcher renders an empty editable span for it.
      const line = token.map[0]
      blocks.push({ tag: 'li', text: '', line0: line, line1: line + 1, editable: true, ancestors: [...stack, token], open: token, index: i, slot: slotAt(line) })
    }
    if (token.type === 'inline' && i > 0) {
      const open = tokens[i - 1]
      // stack ends with `open` itself (pushed below); ancestors are the ones before it.
      const ancestors = stack.slice(0, -1)
      const parent = ancestors.at(-1)
      let tag: BlockTag | undefined
      if (open.type === 'heading_open' && open.markup.startsWith('#'))
        tag = open.tag as BlockTag
      else if (open.type === 'paragraph_open') {
        if (parent?.type === 'list_item_open')
          tag = 'li'
        else if (!parent || parent.type === 'blockquote_open')
          tag = 'p'
      }
      if (tag && open.map) {
        let text = inlineText(token.children)
        let editable = isPlainInline(token.children)
        if (tag === 'li' && parent?.map?.[0] === open.map[0] && RE_TASK.test(token.content)) {
          // Slidev renders task-list checkboxes: the text after "[ ] " is what the canvas sees.
          text = normalizeText(text.replace(RE_TASK, ''))
          editable = false
        }
        blocks.push({ tag, text, line0: open.map[0], line1: open.map[1], editable, ancestors, open, inline: token, index: i - 1, slot: slotAt(open.map[0]) })
      }
    }
    if (token.nesting === 1)
      stack.push(token)
  }
  return { lines, tokens, blocks, slots }
}

/** The block the canvas means. Text match first, then position among blocks with the same tag. */
export function findBlock(parsed: ParsedContent, ref: BlockRef): Block {
  const tag = ref.tag.toLowerCase()
  const sameTag = parsed.blocks.filter(b => b.tag === tag)
  const text = normalizeText(ref.text ?? '')
  const sameText = sameTag.filter(b => b.text === text)
  const found = sameText[ref.occurrence] ?? (sameText.length === 1 ? sameText[0] : undefined) ?? sameTag[ref.tagIndex]
  if (!found)
    throw new Error(`Der Textblock wurde auf der Folie nicht gefunden (${tag} "${ref.text}"). Die Datei wurde vermutlich gerade geändert.`)
  return found
}

/** BlockRef of the block that starts at `line`, as the canvas would describe it. */
export function refForLine(content: string, line: number): BlockRef | undefined {
  const { blocks } = parseContent(content)
  const block = blocks.find(b => b.line0 === line)
  if (!block)
    return undefined
  let occurrence = 0
  let tagIndex = 0
  for (const b of blocks) {
    if (b === block)
      break
    if (b.tag === block.tag) {
      tagIndex++
      if (b.text === block.text)
        occurrence++
    }
  }
  return { tag: block.tag, text: block.text, occurrence, tagIndex }
}

// ---------------------------------------------------------------------------
// Slots and editability
// ---------------------------------------------------------------------------

function slotText(lines: string[], slot: SlotRange): string {
  return lines.slice(slot.start, slot.end).join('\n').trim()
}

export function slotsOf(content: string): SlotContent[] {
  const { lines, slots } = parseContent(content)
  return slots.map(slot => ({ name: slot.name, content: slotText(lines, slot) }))
}

const HARMLESS_BLOCKS = new Set(['fence', 'code_block', 'hr', 'table_open', 'blockquote_open'])

export function editabilityOf(content: string): Editability {
  const { tokens, blocks } = parseContent(content)
  const editable = blocks.filter(b => b.editable).length
  let other = 0
  let html = false
  const blockInlines = new Set(blocks.map(b => b.inline))
  const stack: Token[] = []
  for (const token of tokens) {
    if (token.nesting === -1) {
      stack.pop()
      continue
    }
    if (token.type === 'html_block')
      html = true
    else if (token.type === 'inline') {
      const children = token.children ?? []
      if (children.some(c => c.type === 'html_inline' || (c.type === 'text' && /\{\{|\}\}/.test(c.content))))
        html = true
      const parent = stack.at(-1)
      const inTable = stack.some(t => t.type === 'table_open')
      const onlyImages = children.length > 0 && children.every(c => c.type === 'image' || c.type === 'softbreak' || (c.type === 'text' && !c.content.trim()))
      if (blockInlines.has(token)) {
        if (!blocks.find(b => b.inline === token)!.editable && !onlyImages)
          other++
      }
      else if (!inTable && !onlyImages && parent && !HARMLESS_BLOCKS.has(parent.type)) {
        // Setext headings, paragraphs in odd containers: markdown the canvas leaves alone.
        other++
      }
    }
    if (token.nesting === 1)
      stack.push(token)
  }
  if (!html && other === 0)
    return 'simple'
  if (editable === 0 && html)
    return 'code'
  return 'mixed'
}

// ---------------------------------------------------------------------------
// Line prefixes: blockquote markers, list markers, checkboxes, heading markers
// ---------------------------------------------------------------------------

type PartKind = 'quote' | 'marker' | 'space' | 'check' | 'heading'

interface Prefix {
  /** Text before the inline content on the block's first line. */
  first: string
  /** Prefix for continuation lines of the same block. */
  cont: string
  /** Prefix for a new sibling list item (only for list items on their marker line). */
  sibling?: string
  /** Closing `###` of an ATX heading, kept as is. */
  closing: string
  rest: string
}

function prefixOf(block: Block, line: string): Prefix {
  const parts: { re: string, kind: PartKind }[] = []
  const item = block.ancestors.at(-1)?.type === 'list_item_open' ? block.ancestors.at(-1) : undefined
  for (const anc of block.ancestors) {
    if (anc.type === 'blockquote_open')
      parts.push({ re: '[ \\t]*>[ \\t]?', kind: 'quote' })
    else if (anc.type === 'list_item_open' && anc.map?.[0] === block.line0)
      parts.push({ re: '[ \\t]*(?:[-*+]|\\d{1,9}[.)])(?:[ \\t]+|$)', kind: 'marker' })
  }
  parts.push({ re: '[ \\t]*', kind: 'space' })
  if (block.tag === 'li' && item?.map?.[0] === block.line0)
    parts.push({ re: '(?:\\[[ xX]\\][ \\t]+)?', kind: 'check' })
  if (block.tag.startsWith('h'))
    parts.push({ re: '#{1,6}(?:[ \\t]+|$)', kind: 'heading' })
  const re = new RegExp(`^${parts.map(p => `(${p.re})`).join('')}`)
  const match = line.match(re)
  if (!match) {
    const generic = line.match(/^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(?:#{1,6}[ \t]+)?/)![0]
    return { first: generic, cont: generic.replace(/[^ \t>]/g, ' '), closing: '', rest: line.slice(generic.length) }
  }
  const groups = match.slice(1)
  const lastMarker = parts.map(p => p.kind).lastIndexOf('marker')
  let cont = ''
  let sibling = ''
  groups.forEach((g, i) => {
    const kind = parts[i].kind
    if (kind === 'quote' || kind === 'space') {
      cont += g
      sibling += g
    }
    else if (kind === 'marker') {
      cont += ' '.repeat(g.length)
      sibling += i === lastMarker ? g : ' '.repeat(g.length)
    }
    else if (kind === 'check') {
      if (g)
        sibling += '[ ] '
    }
  })
  let rest = line.slice(match[0].length)
  let closing = ''
  if (block.tag.startsWith('h')) {
    const close = rest.match(/[ \t]+#+[ \t]*$/)
    if (close && close.index! > 0) {
      closing = close[0]
      rest = rest.slice(0, close.index)
    }
  }
  return { first: match[0], cont, sibling: lastMarker >= 0 ? sibling : undefined, closing, rest }
}

/**
 * Keep typed text from turning into different markdown: a paragraph line starting with
 * "# ", "- ", "1. ", "> ", a fence, `---` (slide separator) or `::x::` (slot marker).
 */
export function escapeLineStart(line: string): string {
  if (/^#{1,6}(?:\s|$)/.test(line) || /^[-+*](?:\s|$)/.test(line) || /^>/.test(line) || /^(?:```|~~~)/.test(line)
    || /^[-=_*]{3,}\s*$/.test(line) || RE_SLOT_MARKER.test(line) || /^---/.test(line))
    return `\\${line}`
  const ordered = line.match(/^(\d{1,9})([.)])(\s|$)/)
  if (ordered)
    return `${ordered[1]}\\${line.slice(ordered[1].length)}`
  return line
}

function inlineLines(markdown: string): string[] {
  const lines = markdown.replace(/\r/g, '').replace(/\s+$/, '').split('\n').map(l => l.replace(/^[ \t]+/, ''))
  return lines.map(escapeLineStart)
}

/**
 * Prefix plus text. A marker written without a space ("-", "##") gets one before text;
 * an empty list item or heading keeps its marker followed by one space ("- ", "## ").
 */
function joinPrefix(block: Block, prefix: string, text: string): string {
  const marker = block.tag !== 'p'
  if (!text)
    return marker && /[-*+.)#\]]$/.test(prefix.trimEnd()) ? `${prefix.trimEnd()} ` : prefix.replace(/[ \t]+$/, '')
  if (marker && prefix && !/[ \t]$/.test(prefix))
    return `${prefix} ${text}`
  return `${prefix}${text}`
}

function blockLinesFor(block: Block, line: string, markdown: string): string[] {
  const prefix = prefixOf(block, line)
  if (block.tag.startsWith('h')) {
    const text = markdown.replace(/\s*\n\s*/g, ' ').trim()
    return [`${joinPrefix(block, prefix.first, text)}${text ? prefix.closing : ''}`]
  }
  const [first, ...rest] = inlineLines(markdown)
  return [joinPrefix(block, prefix.first, first), ...rest.map(l => `${prefix.cont}${l}`)]
}

function isBlank(line: string | undefined): boolean {
  return line !== undefined && line.trim() === ''
}

function lastNonBlank(lines: string[], from: number, to: number): number {
  let end = to
  while (end > from && isBlank(lines[end - 1]))
    end--
  return end
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export interface EditResult {
  content: string
  /** Content line where the block to focus starts. */
  focusLine?: number
}

export function editBlockContent(content: string, ref: BlockRef, markdown: string): string {
  const parsed = parseContent(content)
  const block = findBlock(parsed, ref)
  const lines = [...parsed.lines]
  lines.splice(block.line0, block.line1 - block.line0, ...blockLinesFor(block, lines[block.line0], markdown))
  return lines.join('\n')
}

function listItemOf(block: Block): Token | undefined {
  const parent = block.ancestors.at(-1)
  return parent?.type === 'list_item_open' ? parent : undefined
}

function listOf(parsed: ParsedContent, item: Token): { list: Token, items: Token[] } {
  const index = parsed.tokens.indexOf(item)
  let listIndex = index - 1
  while (listIndex >= 0 && !(parsed.tokens[listIndex].nesting === 1 && parsed.tokens[listIndex].level === item.level - 1))
    listIndex--
  const list = parsed.tokens[listIndex]
  const items: Token[] = []
  for (let i = listIndex + 1; i < parsed.tokens.length; i++) {
    const t = parsed.tokens[i]
    if (t.level === list.level && t.nesting === -1)
      break
    if (t.type === 'list_item_open' && t.level === item.level)
      items.push(t)
  }
  return { list, items }
}

function isLoose(parsed: ParsedContent, list: Token): boolean {
  const start = parsed.tokens.indexOf(list)
  for (let i = start + 1; i < parsed.tokens.length; i++) {
    const t = parsed.tokens[i]
    if (t.level === list.level && t.nesting === -1)
      break
    if (t.type === 'paragraph_open' && t.level === list.level + 2 && !t.hidden)
      return true
  }
  return false
}

function increasingNumbers(items: Token[]): boolean {
  const numbers = items.map(i => Number.parseInt(i.info, 10))
  return numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1) && numbers.length > 1
}

/**
 * Add a sibling list item after `item` with text `text`. Works on `lines` already shifted
 * by `delta` lines (edits made inside the item before). Returns the new item's line.
 */
function addSiblingItem(parsed: ParsedContent, lines: string[], block: Block, item: Token, text: string, delta: number): number {
  const { list, items } = listOf(parsed, item)
  const markerLine = parsed.lines[item.map![0]]
  const itemBlock = parsed.blocks.find(b => b.line0 === item.map![0] && b.tag === 'li') ?? block
  const prefix = prefixOf(itemBlock, markerLine)
  let sibling = prefix.sibling ?? markerLine.match(/^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+/)?.[0] ?? '- '
  const ordered = list.type === 'ordered_list_open'
  const renumber = ordered && increasingNumbers(items)
  if (ordered) {
    const current = Number.parseInt(item.info, 10)
    const next = renumber ? current + 1 : current
    sibling = sibling.replace(/\d{1,9}(?=[.)][ \t]*(?:\[ \] )?$)/, String(next))
  }
  const end = lastNonBlank(parsed.lines, item.map![0], item.map![1]) + delta
  const loose = isLoose(parsed, list)
  const [first, ...rest] = inlineLines(text)
  const cont = sibling.replace(/[^ \t>]/g, ' ')
  const newLines = [`${sibling}${first}`.replace(/[ \t]+$/, m => (first ? m : (sibling.endsWith(' ') ? ' ' : m))), ...rest.map(l => `${cont}${l}`)]
  const insert = loose ? ['', ...newLines] : newLines
  lines.splice(end, 0, ...insert)
  if (renumber) {
    const after = items.slice(items.indexOf(item) + 1)
    for (const sib of after) {
      const at = sib.map![0] + delta + insert.length
      const n = Number.parseInt(sib.info, 10)
      lines[at] = lines[at].replace(/^([ \t>]*)(\d{1,9})(?=[.)])/, (_m, p: string) => `${p}${n + 1}`)
    }
  }
  return end + (loose ? 1 : 0)
}

export function splitListItemContent(content: string, ref: BlockRef, markdown: string, newItem: string): EditResult {
  const parsed = parseContent(content)
  const block = findBlock(parsed, ref)
  const item = listItemOf(block)
  if (block.tag !== 'li' || !item)
    throw new Error('Nur Aufzählungspunkte lassen sich so teilen.')
  const lines = [...parsed.lines]
  const replacement = blockLinesFor(block, lines[block.line0], markdown)
  lines.splice(block.line0, block.line1 - block.line0, ...replacement)
  const delta = replacement.length - (block.line1 - block.line0)
  const focusLine = addSiblingItem(parsed, lines, block, item, newItem, delta)
  return { content: lines.join('\n'), focusLine }
}

function cleanupBlankLines(lines: string[], at: number): void {
  // Leave one blank line between blocks and none at the start or the end.
  if (at < lines.length && isBlank(lines[at]) && (at === 0 || isBlank(lines[at - 1])))
    lines.splice(at, 1)
  else if (at === lines.length) {
    while (lines.length > 0 && isBlank(lines.at(-1)))
      lines.pop()
  }
}

export function removeBlockContent(content: string, ref: BlockRef): string {
  const parsed = parseContent(content)
  const block = findBlock(parsed, ref)
  let start = block.line0
  let end = block.line1
  const parent = block.ancestors.at(-1)
  if (block.tag === 'li' && parent && parent.map?.[0] === block.line0) {
    const { list, items } = listOf(parsed, parent)
    const range = items.length === 1 ? list.map! : parent.map!
    start = range[0]
    end = lastNonBlank(parsed.lines, range[0], range[1])
    if (items.length > 1 && items.at(-1) === parent) {
      // Last item of a loose list: drop the blank line before it instead of after it.
      while (start > 0 && isBlank(parsed.lines[start - 1]) && start - 1 >= list.map![0])
        start--
    }
  }
  else if (block.tag === 'p' && parent?.type === 'blockquote_open') {
    const children = parsed.tokens.filter(t => t.level === parent.level + 1 && t.nesting === 1 && t.map && t.map[0] >= parent.map![0] && t.map[1] <= parent.map![1])
    if (children.length === 1) {
      start = parent.map![0]
      end = lastNonBlank(parsed.lines, parent.map![0], parent.map![1])
    }
  }
  const lines = [...parsed.lines]
  lines.splice(start, end - start)
  cleanupBlankLines(lines, start)
  return lines.join('\n')
}

const DEFAULT_TEXT: Record<BlockKind, string> = {
  'heading': 'Überschrift',
  'text': 'Text',
  'list': 'Punkt',
  'numbered-list': 'Punkt',
  'quote': 'Zitat',
  'image': '',
  'code': '',
  'table': '',
}

function newBlockLines(kind: BlockKind, text: string | undefined, src: string | undefined): string[] {
  const value = text ?? DEFAULT_TEXT[kind]
  const [first, ...rest] = inlineLines(value)
  switch (kind) {
    case 'heading':
      return [`## ${value.replace(/\s*\n\s*/g, ' ').trim()}`]
    case 'text':
      return [first, ...rest]
    case 'list':
      return [`- ${first}`, ...rest.map(l => `  ${l}`)]
    case 'numbered-list':
      return [`1. ${first}`, ...rest.map(l => `   ${l}`)]
    case 'quote':
      return [`> ${first}`, ...rest.map(l => `> ${l}`)]
    case 'image':
      return [`![](${src ?? ''})`]
    case 'code':
      return ['```', ...(text ? text.replace(/\r/g, '').split('\n') : ['']), '```']
    case 'table':
      return ['| Spalte 1 | Spalte 2 |', '| --- | --- |', '|   |   |']
  }
}

const EDITABLE_KINDS = new Set<BlockKind>(['heading', 'text', 'list', 'numbered-list', 'quote'])

export function insertBlockContent(content: string, options: { kind: BlockKind, slot?: string, after?: BlockRef, text?: string, src?: string }): EditResult {
  const parsed = parseContent(content)
  const lines = [...parsed.lines]
  const block = newBlockLines(options.kind, options.text, options.src)
  const focus = EDITABLE_KINDS.has(options.kind)
  if (lines.length === 1 && lines[0].trim() === '' && !options.after && (options.slot ?? 'default') === 'default')
    return { content: block.join('\n'), focusLine: focus ? 0 : undefined }

  if (options.after) {
    const anchor = findBlock(parsed, options.after)
    const item = listItemOf(anchor)
    if (item && item.map?.[0] === anchor.line0 && (options.kind === 'list' || options.kind === 'numbered-list')) {
      const { list } = listOf(parsed, item)
      if ((list.type === 'ordered_list_open') === (options.kind === 'numbered-list')) {
        const line = addSiblingItem(parsed, lines, anchor, item, options.text ?? DEFAULT_TEXT[options.kind], 0)
        return { content: lines.join('\n'), focusLine: line }
      }
    }
    const outer = anchor.ancestors[0] ?? anchor.open
    const end = lastNonBlank(parsed.lines, outer.map![0], outer.map![1])
    const insert = ['', ...block]
    if (end < lines.length && !isBlank(lines[end]))
      insert.push('')
    lines.splice(end, 0, ...insert)
    return { content: lines.join('\n'), focusLine: focus ? end + 1 : undefined }
  }

  const name = options.slot ?? 'default'
  const slot = parsed.slots.find(s => s.name === name)
  if (!slot) {
    const end = lastNonBlank(lines, 0, lines.length)
    const insert = [...(end > 0 ? [''] : []), `::${name}::`, '', ...block]
    lines.splice(end, lines.length - end, ...insert)
    return { content: lines.join('\n'), focusLine: focus ? end + insert.length - block.length : undefined }
  }
  const last = lastNonBlank(lines, slot.start, slot.end)
  const hasContent = last > slot.start
  const at = hasContent ? last : slot.start
  const lead = hasContent || slot.marker >= 0 ? [''] : []
  const insert = [...lead, ...block]
  if (at < lines.length && !isBlank(lines[at]))
    insert.push('')
  lines.splice(at, 0, ...insert)
  return { content: lines.join('\n'), focusLine: focus ? at + lead.length : undefined }
}

export function setSlotContent(content: string, name: string, text: string): string {
  const parsed = parseContent(content)
  const lines = [...parsed.lines]
  const body = text.replace(/\r/g, '').trim()
  const bodyLines = body ? body.split('\n') : []
  const slot = parsed.slots.find(s => s.name === name)
  if (!slot) {
    const end = lastNonBlank(lines, 0, lines.length)
    lines.splice(end, lines.length - end, ...(end > 0 ? [''] : []), `::${name}::`, ...(bodyLines.length ? ['', ...bodyLines] : []))
    return lines.join('\n')
  }
  const followed = slot.end < lines.length
  const replacement = slot.marker >= 0
    ? [...(bodyLines.length ? ['', ...bodyLines] : []), ...(followed ? [''] : [])]
    : [...bodyLines, ...(followed && bodyLines.length ? [''] : [])]
  lines.splice(slot.start, slot.end - slot.start, ...replacement)
  return lines.join('\n')
}
