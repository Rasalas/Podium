// In-memory deck for the mock backend. Applies DeckOps for real so the editor can be exercised.
import type { BlockKind, BlockRef, DeckOp, DeckSnapshot, Editability, OpResult, SlideSnapshot } from '@shared/types'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { findBlock, parseBlocks, plainText, refForLine } from './markdown'

export interface MockSlide {
  uid: number
  frontmatter: Record<string, unknown>
  content: string
  note: string
}

interface State {
  headmatter: Record<string, unknown>
  slides: MockSlide[]
}

let uidCounter = 1
export const nextUid = () => uidCounter++

export function hash(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

const STARTERS: Partial<Record<string, string>> = {
  'default': '# Neue Folie\n\n- Erster Punkt\n- Zweiter Punkt',
  'cover': '# Titel der Präsentation\n\nUntertitel',
  'center': '# Eine klare Aussage',
  'section': '# Neuer Abschnitt',
  'two-cols': '# Links\n\nText links\n\n::right::\n\n# Rechts\n\nText rechts',
  'two-cols-header': '# Überschrift\n\n::left::\n\nText links\n\n::right::\n\nText rechts',
  'image-right': '# Überschrift\n\nText neben dem Bild',
  'image-left': '# Überschrift\n\nText neben dem Bild',
  'quote': '> Ein gutes Zitat\n\nName',
  'fact': '# 100 %\n\nEine wichtige Zahl',
  'statement': '# Eine starke Aussage',
  'end': '# Vielen Dank',
}

export function starterFor(layout: string): string {
  return STARTERS[layout] ?? '# Neue Folie'
}

function blockText(kind: BlockKind, src?: string, text?: string): string {
  switch (kind) {
    case 'heading': return `## ${text ?? 'Überschrift'}`
    case 'text': return text ?? 'Neuer Text'
    case 'list': return `- ${text ?? 'Neuer Punkt'}`
    case 'numbered-list': return `1. ${text ?? 'Neuer Punkt'}`
    case 'image': return `![${text ?? ''}](${src ?? '/images/bild.png'})`
    case 'code': return '```js\nconsole.log(\'Hallo\')\n```'
    case 'table': return '| Spalte 1 | Spalte 2 |\n| --- | --- |\n| Wert | Wert |'
    case 'quote': return `> ${text ?? 'Zitat'}`
  }
}

export class MockDeck {
  state: State
  revision = 1
  cause: DeckSnapshot['cause'] = 'load'
  private undoStack: string[] = []
  private redoStack: string[] = []

  constructor(
    readonly deckId: string,
    readonly dir: string,
    headmatter: Record<string, unknown>,
    slides: Omit<MockSlide, 'uid'>[],
  ) {
    this.state = { headmatter, slides: slides.map(s => ({ ...s, uid: nextUid() })) }
  }

  private checkpoint() {
    this.undoStack.push(JSON.stringify(this.state))
    if (this.undoStack.length > 100)
      this.undoStack.shift()
    this.redoStack = []
  }

  private slide(no: number): MockSlide {
    const slide = this.state.slides[no - 1]
    if (!slide)
      throw new Error(`Folie ${no} gibt es nicht`)
    return slide
  }

  layoutOf(index: number): string {
    const fm = this.state.slides[index].frontmatter
    return typeof fm.layout === 'string' ? fm.layout : index === 0 ? 'cover' : 'default'
  }

  snapshot(): DeckSnapshot {
    const { headmatter } = this.state
    const theme = typeof headmatter.theme === 'string' ? headmatter.theme : 'default'
    const ratio = headmatter.aspectRatio === '4/3' ? 4 / 3 : 16 / 9
    const width = 980
    const slides: SlideSnapshot[] = this.state.slides.map((s, i) => {
      const blocks = parseBlocks(s.content)
      const firstHeading = blocks.find(b => b.kind === 'heading')
      const codeBlocks = blocks.filter(b => b.kind === 'html').length
      const editable = blocks.filter(b => b.kind !== 'html' && b.kind !== 'slot').length
      const editability: Editability = codeBlocks === 0 ? 'simple' : editable === 0 ? 'code' : 'mixed'
      const frontmatterRaw = Object.keys(s.frontmatter).length ? stringifyYaml(s.frontmatter).trimEnd() : ''
      const slots = this.slotsOf(s.content)
      return {
        no: i + 1,
        id: `s${s.uid}`,
        title: firstHeading ? plainText(firstHeading.markdown) : (/<h1>(.*?)<\/h1>/.exec(s.content)?.[1] ?? ''),
        layout: this.layoutOf(i),
        frontmatter: structuredClone(s.frontmatter),
        frontmatterRaw,
        content: s.content,
        note: s.note,
        slots,
        filepath: `${this.dir}/slides.md`,
        imported: false,
        revision: hash(JSON.stringify([s.frontmatter, s.content, theme, headmatter.aspectRatio ?? ''])),
        editability,
      }
    })
    return {
      deckId: this.deckId,
      dir: this.dir,
      entry: `${this.dir}/slides.md`,
      title: typeof headmatter.title === 'string' ? headmatter.title : 'Präsentation',
      headmatter: structuredClone(headmatter),
      theme,
      addons: Array.isArray(headmatter.addons) ? headmatter.addons.map(String) : [],
      canvas: { width, height: Math.round(width / ratio) },
      slides,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      revision: this.revision,
      cause: this.cause,
    }
  }

  private slotsOf(content: string) {
    const out: { name: string, content: string }[] = []
    let name = 'default'
    let buf: string[] = []
    for (const line of content.split('\n')) {
      const m = /^::(\w[\w-]*)::$/.exec(line.trim())
      if (m) {
        out.push({ name, content: buf.join('\n').trim() })
        name = m[1]
        buf = []
      }
      else {
        buf.push(line)
      }
    }
    out.push({ name, content: buf.join('\n').trim() })
    return out
  }

  private bump(cause: DeckSnapshot['cause']) {
    this.revision++
    this.cause = cause
  }

  /** A change "from outside", as an agent or text editor would make it. */
  external(mutate: (state: State) => void) {
    this.checkpoint()
    mutate(this.state)
    this.bump('external')
    return this.snapshot()
  }

  undo(): OpResult {
    const prev = this.undoStack.pop()
    if (!prev)
      throw new Error('Nichts zum Rückgängigmachen')
    this.redoStack.push(JSON.stringify(this.state))
    this.state = JSON.parse(prev) as State
    this.bump('undo')
    return { snapshot: this.snapshot() }
  }

  redo(): OpResult {
    const next = this.redoStack.pop()
    if (!next)
      throw new Error('Nichts zum Wiederholen')
    this.undoStack.push(JSON.stringify(this.state))
    this.state = JSON.parse(next) as State
    this.bump('redo')
    return { snapshot: this.snapshot() }
  }

  apply(op: DeckOp): OpResult {
    const before = JSON.stringify(this.state)
    let select: number | undefined
    let focusBlock: BlockRef | undefined
    // Validate before touching history so a rejected op leaves no undo entry behind.
    if (op.type === 'updateSlide' && op.frontmatterRaw !== undefined) {
      const parsed: unknown = op.frontmatterRaw.trim() ? parseYaml(op.frontmatterRaw) : {}
      if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed)))
        throw new Error('Die Einstellungen müssen aus Schlüssel: Wert-Zeilen bestehen')
    }
    this.checkpoint()
    try {
      switch (op.type) {
        case 'updateSlide': {
          const s = this.slide(op.no)
          if (op.content !== undefined)
            s.content = op.content
          if (op.note !== undefined)
            s.note = op.note
          if (op.frontmatterRaw !== undefined) {
            s.frontmatter = (op.frontmatterRaw.trim() ? parseYaml(op.frontmatterRaw) : {}) ?? {}
          }
          else if (op.frontmatter) {
            for (const [k, v] of Object.entries(op.frontmatter)) {
              if (v === null)
                delete s.frontmatter[k]
              else
                s.frontmatter[k] = v
            }
          }
          break
        }
        case 'setSlot': {
          const s = this.slide(op.no)
          const slots = this.slotsOf(s.content).map(sl => sl.name === op.slot ? { ...sl, content: op.content } : sl)
          if (!slots.some(sl => sl.name === op.slot))
            slots.push({ name: op.slot, content: op.content })
          s.content = slots.map(sl => sl.name === 'default' ? sl.content : `::${sl.name}::\n\n${sl.content}`).join('\n\n')
          break
        }
        case 'setLayout': {
          const s = this.slide(op.no)
          if (op.layout === (op.no === 1 ? 'cover' : 'default'))
            delete s.frontmatter.layout
          else
            s.frontmatter.layout = op.layout
          if (op.layout.startsWith('two-cols') && !s.content.includes('::right::'))
            s.content += '\n\n::right::\n\nText rechts'
          break
        }
        case 'insertSlide': {
          const frontmatter: Record<string, unknown> = { ...op.frontmatter }
          if (op.layout && op.layout !== 'default')
            frontmatter.layout = op.layout
          this.state.slides.splice(op.after, 0, {
            uid: nextUid(),
            frontmatter,
            content: op.content ?? starterFor(op.layout ?? 'default'),
            note: op.note ?? '',
          })
          select = op.after + 1
          break
        }
        case 'duplicateSlide': {
          const s = this.slide(op.no)
          this.state.slides.splice(op.no, 0, { ...structuredClone(s), uid: nextUid() })
          select = op.no + 1
          break
        }
        case 'removeSlides': {
          const nos = new Set(op.nos)
          if (nos.size >= this.state.slides.length)
            throw new Error('Mindestens eine Folie muss bleiben')
          this.state.slides = this.state.slides.filter((_, i) => !nos.has(i + 1))
          select = Math.min(Math.min(...op.nos), this.state.slides.length)
          break
        }
        case 'moveSlide': {
          const [s] = this.state.slides.splice(op.from - 1, 1)
          if (!s)
            throw new Error(`Folie ${op.from} gibt es nicht`)
          this.state.slides.splice(op.to - 1, 0, s)
          select = op.to
          break
        }
        case 'editBlock':
        case 'splitListItem':
        case 'removeBlock': {
          const s = this.slide(op.no)
          const block = findBlock(s.content, op.block)
          if (!block)
            throw new Error('Der Text wurde in der Datei nicht gefunden')
          const lines = s.content.split('\n')
          if (op.type === 'removeBlock') {
            lines.splice(block.start, block.end - block.start)
          }
          else {
            lines[block.start] = block.prefix + op.markdown
            if (op.type === 'splitListItem') {
              const prefix = block.kind === 'oli' ? block.prefix.replace(/\d+/, n => String(Number(n) + 1)) : block.prefix
              lines.splice(block.start + 1, 0, prefix + op.newItem)
            }
          }
          s.content = lines.join('\n')
          if (op.type === 'splitListItem')
            focusBlock = refForLine(s.content, block.start + 1)
          break
        }
        case 'insertBlock': {
          const s = this.slide(op.no)
          const text = blockText(op.kind, op.src, op.text)
          let lines = s.content.split('\n')
          let at = lines.length
          if (op.after) {
            const block = findBlock(s.content, op.after)
            if (block)
              at = block.end
          }
          else if (op.slot && op.slot !== 'default') {
            const marker = lines.findIndex(l => l.trim() === `::${op.slot}::`)
            if (marker >= 0) {
              const next = lines.findIndex((l, i) => i > marker && /^::\w[\w-]*::$/.test(l.trim()))
              at = next >= 0 ? next : lines.length
            }
          }
          else {
            const firstSlot = lines.findIndex(l => /^::\w[\w-]*::$/.test(l.trim()))
            if (firstSlot >= 0)
              at = firstSlot
          }
          while (at > 0 && !lines[at - 1].trim()) at--
          const padBefore = at > 0 ? [''] : []
          const padAfter = at < lines.length && lines[at].trim() ? [''] : []
          const newLine = at + padBefore.length
          lines = [...lines.slice(0, at), ...padBefore, ...text.split('\n'), ...padAfter, ...lines.slice(at)]
          s.content = lines.join('\n')
          focusBlock = refForLine(s.content, newLine)
          break
        }
        case 'setHeadmatter': {
          for (const [k, v] of Object.entries(op.patch)) {
            if (v === null)
              delete this.state.headmatter[k]
            else
              this.state.headmatter[k] = v
          }
          break
        }
      }
    }
    catch (error) {
      this.state = JSON.parse(before) as State
      this.undoStack.pop()
      throw error
    }
    this.bump('app')
    return { snapshot: this.snapshot(), select, focusBlock }
  }
}
