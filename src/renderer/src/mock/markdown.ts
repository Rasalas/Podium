// A deliberately tiny markdown model for the mock backend. It only needs to be good
// enough to exercise the editor UI in a browser; the real app uses Slidev's parser.
import type { BlockRef } from '@shared/types'

export interface MdBlock {
  /** Lines [start, end) in the content. */
  start: number
  end: number
  kind: 'heading' | 'p' | 'li' | 'oli' | 'quote' | 'code' | 'table' | 'image' | 'html' | 'slot'
  /** Rendered tag for editable blocks (h1..h6, p, li). */
  tag?: string
  /** Line prefix kept on edit, e.g. "## " or "- ". */
  prefix: string
  /** Inline markdown of editable blocks. */
  markdown: string
  slot: string
}

const EDITABLE = new Set(['heading', 'p', 'li', 'oli', 'quote'])

export function parseBlocks(content: string): MdBlock[] {
  const lines = content.split('\n')
  const blocks: MdBlock[] = []
  let slot = 'default'
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) {
      i++
      continue
    }
    const slotMatch = /^::(\w[\w-]*)::$/.exec(trimmed)
    if (slotMatch) {
      slot = slotMatch[1]
      blocks.push({ start: i, end: i + 1, kind: 'slot', prefix: '', markdown: '', slot })
      i++
      continue
    }
    if (trimmed.startsWith('```')) {
      let j = i + 1
      while (j < lines.length && !lines[j].trim().startsWith('```')) j++
      blocks.push({ start: i, end: Math.min(j + 1, lines.length), kind: 'code', prefix: '', markdown: '', slot })
      i = j + 1
      continue
    }
    if (trimmed.startsWith('<')) {
      let j = i + 1
      while (j < lines.length && lines[j].trim()) j++
      blocks.push({ start: i, end: j, kind: 'html', prefix: '', markdown: '', slot })
      i = j
      continue
    }
    if (trimmed.startsWith('|')) {
      let j = i + 1
      while (j < lines.length && lines[j].trim().startsWith('|')) j++
      blocks.push({ start: i, end: j, kind: 'table', prefix: '', markdown: '', slot })
      i = j
      continue
    }
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(trimmed)) {
      blocks.push({ start: i, end: i + 1, kind: 'image', prefix: '', markdown: trimmed, slot })
      i++
      continue
    }
    let m = /^(#{1,6})\s+(.*)$/.exec(line)
    if (m) {
      blocks.push({ start: i, end: i + 1, kind: 'heading', tag: `h${m[1].length}`, prefix: `${m[1]} `, markdown: m[2], slot })
      i++
      continue
    }
    m = /^(\s*[-*]\s+)(.*)$/.exec(line)
    if (m) {
      blocks.push({ start: i, end: i + 1, kind: 'li', tag: 'li', prefix: m[1], markdown: m[2], slot })
      i++
      continue
    }
    m = /^(\s*\d+\.\s+)(.*)$/.exec(line)
    if (m) {
      blocks.push({ start: i, end: i + 1, kind: 'oli', tag: 'li', prefix: m[1], markdown: m[2], slot })
      i++
      continue
    }
    m = /^(>\s?)(.*)$/.exec(line)
    if (m) {
      blocks.push({ start: i, end: i + 1, kind: 'quote', tag: 'p', prefix: m[1], markdown: m[2], slot })
      i++
      continue
    }
    blocks.push({ start: i, end: i + 1, kind: 'p', tag: 'p', prefix: '', markdown: line.trim(), slot })
    i++
  }
  return blocks
}

export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Editable blocks with the BlockRef the canvas would report for them. */
export function blockRefs(content: string): { block: MdBlock, ref: BlockRef }[] {
  const out: { block: MdBlock, ref: BlockRef }[] = []
  const byTag = new Map<string, number>()
  const byTagText = new Map<string, number>()
  for (const block of parseBlocks(content)) {
    if (!EDITABLE.has(block.kind) || !block.tag)
      continue
    const text = plainText(block.markdown)
    const tagIndex = byTag.get(block.tag) ?? 0
    const key = `${block.tag}\u0000${text}`
    const occurrence = byTagText.get(key) ?? 0
    byTag.set(block.tag, tagIndex + 1)
    byTagText.set(key, occurrence + 1)
    out.push({ block, ref: { tag: block.tag, text, occurrence, tagIndex } })
  }
  return out
}

export function findBlock(content: string, ref: BlockRef): MdBlock | undefined {
  const refs = blockRefs(content)
  const exact = refs.find(r => r.ref.tag === ref.tag && r.ref.text === ref.text && r.ref.occurrence === ref.occurrence)
  if (exact)
    return exact.block
  return refs.find(r => r.ref.tag === ref.tag && r.ref.tagIndex === ref.tagIndex)?.block
}

export function refForLine(content: string, line: number): BlockRef | undefined {
  return blockRefs(content).find(r => r.block.start === line)?.ref
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function inlineToHtml(markdown: string): string {
  return escapeHtml(markdown)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2">$1</a>')
}
