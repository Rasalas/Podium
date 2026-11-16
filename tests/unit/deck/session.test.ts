import type { DeckSession } from '../../../src/main/contracts'
import type { DeckSnapshot } from '../../../src/shared/types'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDeck, openDeck } from '../../../src/main/deck'

const FIXTURES = resolve(import.meta.dirname, '../../fixtures')

let root: string
let sessions: DeckSession[] = []
let changes: DeckSnapshot[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'podium-deck-'))
  sessions = []
  changes = []
})

afterEach(async () => {
  for (const s of sessions)
    await s.close().catch(() => {})
  await rm(root, { recursive: true, force: true })
})

const options = () => ({ workDir: join(root, 'work'), onChange: (s: DeckSnapshot) => void changes.push(s) })

async function deckFrom(markdown: string, extra: Record<string, string> = {}): Promise<{ deck: DeckSession, dir: string, file: string }> {
  const dir = join(root, `deck-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'slides.md'), markdown)
  for (const [name, content] of Object.entries(extra)) {
    await mkdir(join(dir, name, '..'), { recursive: true })
    await writeFile(join(dir, name), content)
  }
  const deck = await openDeck(dir, options())
  sessions.push(deck)
  return { deck, dir, file: join(dir, 'slides.md') }
}

async function fixture(name: string): Promise<{ deck: DeckSession, dir: string, file: string }> {
  const dir = join(root, name)
  await cp(join(FIXTURES, name), dir, { recursive: true })
  const deck = await openDeck(dir, options())
  sessions.push(deck)
  return { deck, dir, file: join(dir, 'slides.md') }
}

const read = (path: string) => readFile(path, 'utf8')
const lines = (...l: string[]) => `${l.join('\n')}\n`

function changedLines(a: string, b: string): number {
  const x = a.split('\n')
  const y = b.split('\n')
  let n = Math.abs(x.length - y.length)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i])
      n++
  }
  return n
}

async function waitFor(check: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout)
      throw new Error('timeout')
    await new Promise(r => setTimeout(r, 20))
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const SAMPLE = lines(
  '---',
  'theme: seriph',
  'title: Beispiel # Kommentar',
  'layout: center',
  'class: text-white',
  'fonts:',
  '  sans: Inter',
  'transition: fade',
  '---',
  '',
  '# Eins',
  '',
  'Erste Folie',
  '',
  '<!-- Notiz eins -->',
  '',
  '---',
  '',
  '# Zwei',
  '',
  '- a',
  '- b',
  '',
  '---',
  'layout: two-cols',
  '---',
  '',
  '# Drei',
  '',
  '::right::',
  '',
  'Rechts',
)

describe('loading', () => {
  it('reads the basic fixture', async () => {
    const { deck, dir } = await fixture('basic')
    const s = deck.snapshot()
    expect(s.cause).toBe('load')
    expect(s.dir).toBe(dir)
    expect(s.entry).toBe(join(dir, 'slides.md'))
    expect(s.title).toBe('Spike Deck')
    expect(s.theme).toBe('seriph')
    expect(s.addons).toEqual([])
    expect(s.headmatter).toEqual({ theme: 'seriph', title: 'Spike Deck' })
    expect(s.canvas).toEqual({ width: 980, height: 551 })
    expect(s.slides.map(x => x.layout)).toEqual(['cover', 'two-cols', 'center'])
    expect(s.slides[0].frontmatter).toEqual({})
    expect(s.slides[0].note).toBe('Notiz zur ersten Folie')
    expect(s.slides[0].content).toBe('# Hallo Podium\n\nErste Folie mit **fettem** Text')
    expect(s.slides[1].slots).toEqual([
      { name: 'default', content: '# Links\n\n- Punkt eins\n- Punkt zwei' },
      { name: 'right', content: '# Rechts\n\nText rechts' },
    ])
    expect(s.slides.every(x => x.editability === 'simple')).toBe(true)
    expect(s.canUndo).toBe(false)
    expect(s.deckId).toMatch(/^[0-9a-f]{12}$/)
  })

  it('splits the first block into headmatter and slide 1 frontmatter', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const s = deck.snapshot()
    expect(s.headmatter).toEqual({ theme: 'seriph', title: 'Beispiel', fonts: { sans: 'Inter' }, transition: 'fade' })
    expect(s.slides[0].frontmatter).toEqual({ layout: 'center', class: 'text-white' })
    expect(s.slides[0].frontmatterRaw).toBe('layout: center\nclass: text-white')
    expect(s.slides[0].layout).toBe('center')
    expect(s.slides[1].layout).toBe('default')
    expect(s.slides[2].frontmatterRaw).toBe('layout: two-cols')
  })

  it('uses defaults.layout, aspectRatio, canvasWidth and addons', async () => {
    const { deck } = await deckFrom(lines('---', 'aspectRatio: "4:3"', 'canvasWidth: 800', 'addons: [a, b]', 'defaults:', '  layout: center', '---', '', '# A', '', '---', '', '# B'))
    const s = deck.snapshot()
    expect(s.canvas).toEqual({ width: 800, height: 600 })
    expect(s.addons).toEqual(['a', 'b'])
    expect(s.slides.map(x => x.layout)).toEqual(['center', 'center'])
    expect(s.title).toBe('A')
  })

  it('opens a markdown file directly', async () => {
    const dir = join(root, 'direct')
    await mkdir(dir)
    await writeFile(join(dir, 'talk.md'), '# Hi\n')
    const deck = await openDeck(join(dir, 'talk.md'), options())
    sessions.push(deck)
    expect(deck.snapshot().entry).toBe(join(dir, 'talk.md'))
    expect(deck.snapshot().slides).toHaveLength(1)
  })

  it('throws a readable error for a folder without slides', async () => {
    await mkdir(join(root, 'empty'))
    await expect(openDeck(join(root, 'empty'), options())).rejects.toThrow(/slides\.md/)
  })

  it('keeps ids stable across edits and moves', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const ids = deck.snapshot().slides.map(s => s.id)
    expect(new Set(ids).size).toBe(3)
    await deck.apply({ type: 'editBlock', no: 2, block: { tag: 'h1', text: 'Zwei', occurrence: 0, tagIndex: 0 }, markdown: 'II' })
    expect(deck.snapshot().slides.map(s => s.id)).toEqual(ids)
    await deck.apply({ type: 'moveSlide', from: 3, to: 2 })
    expect(deck.snapshot().slides.map(s => s.id)).toEqual([ids[0], ids[2], ids[1]])
  })

  it('changes the revision only for the edited slide', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const before = deck.snapshot().slides.map(s => s.revision)
    await deck.apply({ type: 'editBlock', no: 2, block: { tag: 'li', text: 'a', occurrence: 0, tagIndex: 0 }, markdown: 'A' })
    const after = deck.snapshot().slides.map(s => s.revision)
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(after[2]).toBe(before[2])
    await deck.apply({ type: 'setHeadmatter', patch: { theme: 'default' } })
    expect(deck.snapshot().slides.map(s => s.revision).every((r, i) => r !== after[i])).toBe(true)
  })

  it('leaves hidden slides out like Slidev and still edits the right one', async () => {
    const { deck, file } = await deckFrom(lines('# A', '', '---', 'hide: true', '---', '', '# Versteckt', '', '---', '', '# C'))
    expect(deck.snapshot().slides.map(s => s.title)).toEqual(['A', 'C'])
    await deck.apply({ type: 'editBlock', no: 2, block: { tag: 'h1', text: 'C', occurrence: 0, tagIndex: 0 }, markdown: 'Neu' })
    expect(await read(file)).toBe(lines('# A', '', '---', 'hide: true', '---', '', '# Versteckt', '', '---', '', '# Neu'))
  })
})

describe('editing keeps the file formatting', () => {
  it('a one-word edit is a one-line diff', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    const before = await read(file)
    const result = await deck.apply({ type: 'editBlock', no: 1, block: { tag: 'p', text: 'Erste Folie', occurrence: 0, tagIndex: 0 }, markdown: 'Erstes Blatt' })
    const after = await read(file)
    expect(changedLines(before, after)).toBe(1)
    expect(after).toBe(before.replace('Erste Folie', 'Erstes Blatt'))
    expect(result.snapshot.cause).toBe('app')
    expect(result.snapshot.canUndo).toBe(true)
    expect(changes.at(-1)).toBe(result.snapshot)
  })

  it('keeps unusual formatting of untouched slides', async () => {
    const odd = '# A\n\n\n---\n\n# B   \n---\n\n\n\n# C   \n\n<!--\nnote\n-->\n'
    const { deck, file } = await deckFrom(odd)
    await deck.apply({ type: 'updateSlide', no: 3, note: 'neue Notiz' })
    expect(await read(file)).toBe('# A\n\n\n---\n\n# B   \n---\n\n\n\n# C   \n\n<!--\nneue Notiz\n-->\n')
  })

  it('preserves CRLF line endings and a BOM', async () => {
    const { deck, file } = await deckFrom('﻿# A\r\n\r\n---\r\n\r\n# B\r\n')
    await deck.apply({ type: 'editBlock', no: 2, block: { tag: 'h1', text: 'B', occurrence: 0, tagIndex: 0 }, markdown: 'Beh' })
    expect(await read(file)).toBe('﻿# A\r\n\r\n---\r\n\r\n# Beh\r\n')
  })

  it('keeps YAML comments when patching frontmatter', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await deck.apply({ type: 'setHeadmatter', patch: { theme: 'default' } })
    const text = await read(file)
    expect(text).toContain('title: Beispiel # Kommentar')
    expect(text).toContain('theme: default')
    expect(changedLines(SAMPLE, text)).toBe(1)
  })
})

describe('updateSlide, setLayout, setSlot', () => {
  it('updates content, frontmatter and note', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await deck.apply({ type: 'updateSlide', no: 2, content: '# Neu\n\nInhalt', frontmatter: { layout: 'center', class: 'x' }, note: 'Hallo' })
    const s = deck.snapshot().slides[1]
    expect(s.content).toBe('# Neu\n\nInhalt')
    expect(s.frontmatter).toEqual({ layout: 'center', class: 'x' })
    expect(s.note).toBe('Hallo')
    expect(await read(file)).toContain('---\nlayout: center\nclass: x\n---\n\n# Neu\n\nInhalt\n\n<!-- Hallo -->\n\n---\nlayout: two-cols')
    await deck.apply({ type: 'updateSlide', no: 2, frontmatter: { layout: null, class: null } })
    expect(deck.snapshot().slides[1].frontmatter).toEqual({})
    expect(await read(file)).toContain('<!-- Notiz eins -->\n\n---\n\n# Neu')
  })

  it('rejects invalid YAML without changing anything', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await expect(deck.apply({ type: 'updateSlide', no: 2, frontmatterRaw: 'layout: [' })).rejects.toThrow(/YAML/)
    expect(await read(file)).toBe(SAMPLE)
    expect(deck.snapshot().canUndo).toBe(false)
    // The session still works afterwards.
    await deck.apply({ type: 'setLayout', no: 2, layout: 'fact' })
    expect(deck.snapshot().slides[1].layout).toBe('fact')
  })

  it('frontmatterRaw on slide 1 keeps the deck keys', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await deck.apply({ type: 'updateSlide', no: 1, frontmatterRaw: 'layout: cover\nbackground: /images/a.png' })
    const s = deck.snapshot()
    expect(s.headmatter).toEqual({ theme: 'seriph', title: 'Beispiel', fonts: { sans: 'Inter' }, transition: 'fade' })
    expect(s.slides[0].frontmatter).toEqual({ layout: 'cover', background: '/images/a.png' })
    expect(await read(file)).toMatch(/^---\ntheme: seriph\ntitle: Beispiel # Kommentar\nfonts:\n {2}sans: Inter\ntransition: fade\nlayout: cover\nbackground: \/images\/a\.png\n---\n\n# Eins/)
  })

  it('frontmatterRaw replaces the frontmatter of other slides and can remove it', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await deck.apply({ type: 'updateSlide', no: 3, frontmatterRaw: '' })
    expect(deck.snapshot().slides[2].frontmatter).toEqual({})
    expect(await read(file)).toContain('- b\n\n---\n\n# Drei')
    await deck.apply({ type: 'updateSlide', no: 3, frontmatterRaw: 'layout: end # bye' })
    expect(await read(file)).toContain('- b\n\n---\nlayout: end # bye\n---\n\n# Drei')
  })

  it('setLayout writes the layout key', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await deck.apply({ type: 'setLayout', no: 2, layout: 'section' })
    expect(await read(file)).toContain('<!-- Notiz eins -->\n\n---\nlayout: section\n---\n\n# Zwei')
    await deck.apply({ type: 'setLayout', no: 1, layout: 'intro' })
    expect(deck.snapshot().slides[0].layout).toBe('intro')
    expect(deck.snapshot().headmatter.theme).toBe('seriph')
  })

  it('setSlot replaces or creates a slot', async () => {
    const { deck } = await deckFrom(SAMPLE)
    await deck.apply({ type: 'setSlot', no: 3, slot: 'right', content: 'Neu rechts' })
    expect(deck.snapshot().slides[2].slots).toEqual([{ name: 'default', content: '# Drei' }, { name: 'right', content: 'Neu rechts' }])
    await deck.apply({ type: 'setSlot', no: 2, slot: 'right', content: 'R' })
    expect(deck.snapshot().slides[1].content).toBe('# Zwei\n\n- a\n- b\n\n::right::\n\nR')
    await deck.apply({ type: 'setSlot', no: 3, slot: 'default', content: '# D' })
    expect(deck.snapshot().slides[2].content).toBe('# D\n\n::right::\n\nNeu rechts')
  })

  it('returns an unchanged snapshot for a no-op', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const result = await deck.apply({ type: 'setLayout', no: 3, layout: 'two-cols' })
    expect(result.snapshot.revision).toBe(deck.snapshot().revision)
    expect(result.snapshot.canUndo).toBe(false)
    expect(changes).toHaveLength(0)
  })
})

describe('slide structure', () => {
  it('inserts a slide after another one and selects it', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    const result = await deck.apply({ type: 'insertSlide', after: 2, layout: 'center', content: '# Neu', note: 'n' })
    expect(result.select).toBe(3)
    expect(result.snapshot.slides.map(s => s.title)).toEqual(['Beispiel', 'Zwei', 'Neu', 'Drei'])
    expect(await read(file)).toContain('- b\n\n---\nlayout: center\n---\n\n# Neu\n\n<!-- n -->\n\n---\nlayout: two-cols')
  })

  it('inserts at the end of a file without a final newline', async () => {
    const { deck, file } = await deckFrom('# A\n\n---\n\n# B')
    await deck.apply({ type: 'insertSlide', after: 2, content: '# C' })
    expect(await read(file)).toBe('# A\n\n---\n\n# B\n\n---\n\n# C\n')
  })

  it('inserts a new first slide and keeps the headmatter in the first block', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    const result = await deck.apply({ type: 'insertSlide', after: 0, content: '# Null' })
    expect(result.select).toBe(1)
    const s = result.snapshot
    expect(s.headmatter).toEqual({ theme: 'seriph', title: 'Beispiel', fonts: { sans: 'Inter' }, transition: 'fade' })
    expect(s.slides.map(x => x.content.split('\n')[0])).toEqual(['# Null', '# Eins', '# Zwei', '# Drei'])
    expect(s.slides[0].frontmatter).toEqual({})
    expect(s.slides[1].frontmatter).toEqual({ layout: 'center', class: 'text-white' })
    expect(s.slides[1].note).toBe('Notiz eins')
    expect(await read(file)).toMatch(/^---\ntheme: seriph\ntitle: Beispiel # Kommentar\nfonts:\n {2}sans: Inter\ntransition: fade\n---\n\n# Null\n\n---\nlayout: center\nclass: text-white\n---\n\n# Eins/)
  })

  it('duplicates slide 1 without the deck keys', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const result = await deck.apply({ type: 'duplicateSlide', no: 1 })
    expect(result.select).toBe(2)
    expect(result.snapshot.slides[1].frontmatter).toEqual({ layout: 'center', class: 'text-white' })
    expect(result.snapshot.slides[1].content).toBe(result.snapshot.slides[0].content)
    expect(result.snapshot.slides[1].note).toBe('Notiz eins')
    expect(result.snapshot.slides[1].id).not.toBe(result.snapshot.slides[0].id)
    expect(result.snapshot.headmatter.theme).toBe('seriph')
  })

  it('duplicates a slide without frontmatter', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await deck.apply({ type: 'duplicateSlide', no: 2 })
    expect(await read(file)).toContain('- a\n- b\n\n---\n\n# Zwei\n\n- a\n- b\n\n---\nlayout: two-cols')
  })

  it('removes several slides at once', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const result = await deck.apply({ type: 'removeSlides', nos: [2, 3] })
    expect(result.snapshot.slides).toHaveLength(1)
    expect(result.select).toBe(1)
  })

  it('removes slide 1 and moves the headmatter to the new first slide', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    const result = await deck.apply({ type: 'removeSlides', nos: [1] })
    expect(result.select).toBe(1)
    expect(result.snapshot.headmatter).toEqual({ theme: 'seriph', title: 'Beispiel', fonts: { sans: 'Inter' }, transition: 'fade' })
    expect(result.snapshot.slides[0].frontmatter).toEqual({})
    expect(await read(file)).toMatch(/^---\ntheme: seriph\ntitle: Beispiel # Kommentar\nfonts:\n {2}sans: Inter\ntransition: fade\n---\n\n# Zwei/)
  })

  it('refuses to remove the last remaining slide', async () => {
    const { deck } = await deckFrom(SAMPLE)
    await expect(deck.apply({ type: 'removeSlides', nos: [1, 2, 3] })).rejects.toThrow(/letzte Folie/)
    expect(deck.snapshot().slides).toHaveLength(3)
  })

  it('moves slide 1 to the end: deck keys stay, slide keys travel', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    const result = await deck.apply({ type: 'moveSlide', from: 1, to: 3 })
    expect(result.select).toBe(3)
    const s = result.snapshot
    expect(s.slides.map(x => x.content.split('\n')[0])).toEqual(['# Zwei', '# Drei', '# Eins'])
    expect(s.headmatter).toEqual({ theme: 'seriph', title: 'Beispiel', fonts: { sans: 'Inter' }, transition: 'fade' })
    expect(s.slides[0].frontmatter).toEqual({})
    expect(s.slides[2].frontmatter).toEqual({ layout: 'center', class: 'text-white' })
    expect(s.slides[2].note).toBe('Notiz eins')
    const text = await read(file)
    expect(text).toContain('Rechts\n\n---\nlayout: center\nclass: text-white\n---\n\n# Eins\n\nErste Folie\n\n<!-- Notiz eins -->\n')
    expect(text.startsWith('---\ntheme: seriph')).toBe(true)
  })

  it('moves the last slide to the front', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const result = await deck.apply({ type: 'moveSlide', from: 3, to: 1 })
    expect(result.select).toBe(1)
    const s = result.snapshot
    expect(s.slides.map(x => x.content.split('\n')[0])).toEqual(['# Drei', '# Eins', '# Zwei'])
    expect(s.slides[0].frontmatter).toEqual({ layout: 'two-cols' })
    expect(s.slides[0].layout).toBe('two-cols')
    expect(s.slides[1].frontmatter).toEqual({ layout: 'center', class: 'text-white' })
    expect(s.headmatter.theme).toBe('seriph')
  })

  it('moves a middle slide and keeps the others byte-identical', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await deck.apply({ type: 'moveSlide', from: 2, to: 3 })
    expect(await read(file)).toBe(lines(
      '---',
      'theme: seriph',
      'title: Beispiel # Kommentar',
      'layout: center',
      'class: text-white',
      'fonts:',
      '  sans: Inter',
      'transition: fade',
      '---',
      '',
      '# Eins',
      '',
      'Erste Folie',
      '',
      '<!-- Notiz eins -->',
      '',
      '---',
      'layout: two-cols',
      '---',
      '',
      '# Drei',
      '',
      '::right::',
      '',
      'Rechts',
      '',
      '---',
      '',
      '# Zwei',
      '',
      '- a',
      '- b',
    ))
  })

  it('round-trips a move', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await deck.apply({ type: 'moveSlide', from: 1, to: 2 })
    await deck.apply({ type: 'moveSlide', from: 2, to: 1 })
    const s = deck.snapshot()
    expect(s.slides[0].frontmatter).toEqual({ layout: 'center', class: 'text-white' })
    expect(s.headmatter.title).toBe('Beispiel')
    expect((await read(file)).split('\n').slice(9)).toEqual(SAMPLE.split('\n').slice(9))
  })
})

describe('slide 1 moves in the basic fixture', () => {
  it('moves a slide whose first block holds only deck keys', async () => {
    const { deck, file } = await fixture('basic')
    await deck.apply({ type: 'moveSlide', from: 2, to: 1 })
    const s = deck.snapshot()
    expect(s.headmatter).toEqual({ theme: 'seriph', title: 'Spike Deck' })
    expect(s.slides.map(x => x.layout)).toEqual(['two-cols', 'default', 'center'])
    expect(s.slides[0].frontmatter).toEqual({ layout: 'two-cols' })
    expect(s.slides[1].note).toBe('Notiz zur ersten Folie')
    expect(await read(file)).toMatch(/^---\ntheme: seriph\ntitle: Spike Deck\nlayout: two-cols\n---\n\n# Links[\s\S]*Text rechts\n\n---\n\n# Hallo Podium\n/)
    await deck.undo()
    expect(deck.snapshot().slides.map(x => x.layout)).toEqual(['cover', 'two-cols', 'center'])
  })

  it('a slide title does not override the deck title when it becomes first', async () => {
    const { deck, file } = await deckFrom(lines('---', 'title: Deck', '---', '', '# A', '', '---', 'title: Folie B', 'layout: center', '---', '', '# B'))
    await deck.apply({ type: 'moveSlide', from: 2, to: 1 })
    expect(deck.snapshot().title).toBe('Deck')
    expect(deck.snapshot().slides[0].frontmatter).toEqual({ layout: 'center' })
    expect((await read(file)).startsWith('---\ntitle: Deck\nlayout: center\n---\n\n# B')).toBe(true)
  })

  it('serialises concurrent ops', async () => {
    const { deck } = await deckFrom(SAMPLE)
    await Promise.all([
      deck.apply({ type: 'insertSlide', after: 3, content: '# Vier' }),
      deck.apply({ type: 'insertSlide', after: 4, content: '# Fünf' }),
      deck.apply({ type: 'editBlock', no: 2, block: { tag: 'h1', text: 'Zwei', occurrence: 0, tagIndex: 0 }, markdown: 'II' }),
    ])
    expect(deck.snapshot().slides.map(x => x.title)).toEqual(['Beispiel', 'II', 'Drei', 'Vier', 'Fünf'])
  })
})

describe('src: imports', () => {
  it('loads imported slides and edits them in their own file', async () => {
    const { deck, dir, file } = await fixture('deck/imports')
    const s = deck.snapshot()
    expect(s.title).toBe('Import-Deck')
    expect(s.slides.map(x => x.title)).toEqual(['Import-Deck', 'Extra eins', 'Extra zwei', 'Ende'])
    expect(s.slides[1].imported).toBe(true)
    expect(s.slides[1].filepath).toBe(join(dir, 'pages/extra.md'))
    expect(s.slides[0].frontmatter).toEqual({ layout: 'cover', class: 'text-center' })
    const entryBefore = await read(file)
    await deck.apply({ type: 'editBlock', no: 2, block: { tag: 'p', text: 'Aus der zweiten Datei', occurrence: 0, tagIndex: 0 }, markdown: 'Geändert' })
    expect(await read(file)).toBe(entryBefore)
    expect(await read(join(dir, 'pages/extra.md'))).toBe('# Extra eins\n\nGeändert\n\n---\nlayout: center\n---\n\n# Extra zwei\n')
    await deck.apply({ type: 'moveSlide', from: 3, to: 2 })
    expect(deck.snapshot().slides.map(x => x.title)).toEqual(['Import-Deck', 'Extra zwei', 'Extra eins', 'Ende'])
    await expect(deck.apply({ type: 'moveSlide', from: 2, to: 4 })).rejects.toThrow(/anderen Datei/)
    // An entry slide can move past the import: the `src:` slide moves in the entry file.
    await deck.apply({ type: 'moveSlide', from: 4, to: 2 })
    expect(deck.snapshot().slides.map(x => x.title)).toEqual(['Import-Deck', 'Ende', 'Extra zwei', 'Extra eins'])
    const inserted = await deck.apply({ type: 'insertSlide', after: 4, content: '# Drittes Extra' })
    expect(inserted.select).toBe(5)
    expect(await read(join(dir, 'pages/extra.md'))).toContain('# Drittes Extra')
  })

  it('reloads when an imported file changes on disk', async () => {
    const { deck, dir } = await fixture('deck/imports')
    await writeFile(join(dir, 'pages/extra.md'), '# Anders\n')
    await waitFor(() => changes.some(c => c.cause === 'external'))
    expect(deck.snapshot().slides.map(x => x.title)).toEqual(['Import-Deck', 'Anders', 'Ende'])
  })
})

describe('block ops through the session', () => {
  it('splits a list item and returns the focus block', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const result = await deck.apply({ type: 'splitListItem', no: 2, block: { tag: 'li', text: 'a', occurrence: 0, tagIndex: 0 }, markdown: 'a', newItem: 'neu' })
    expect(result.snapshot.slides[1].content).toBe('# Zwei\n\n- a\n- neu\n- b')
    expect(result.focusBlock).toEqual({ tag: 'li', text: 'neu', occurrence: 0, tagIndex: 1 })
  })

  it('Enter, Enter, type: empty items get the focus through the session', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    const first = await deck.apply({ type: 'splitListItem', no: 2, block: { tag: 'li', text: 'b', occurrence: 0, tagIndex: 1 }, markdown: 'b', newItem: '' })
    expect(first.focusBlock).toEqual({ tag: 'li', text: '', occurrence: 0, tagIndex: 2 })
    const second = await deck.apply({ type: 'splitListItem', no: 2, block: first.focusBlock!, markdown: '', newItem: '' })
    expect(second.focusBlock).toEqual({ tag: 'li', text: '', occurrence: 1, tagIndex: 3 })
    expect(second.snapshot.slides[1].editability).toBe('simple')
    await deck.apply({ type: 'editBlock', no: 2, block: second.focusBlock!, markdown: 'Neuer Punkt' })
    await deck.apply({ type: 'removeBlock', no: 2, block: { tag: 'li', text: '', occurrence: 0, tagIndex: 2 } })
    expect(await read(file)).toContain('# Zwei\n\n- a\n- b\n- Neuer Punkt\n\n---')
  })

  it('inserts and removes blocks', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const inserted = await deck.apply({ type: 'insertBlock', no: 3, kind: 'text', slot: 'right' })
    expect(inserted.snapshot.slides[2].slots[1].content).toBe('Rechts\n\nText')
    expect(inserted.focusBlock).toEqual({ tag: 'p', text: 'Text', occurrence: 0, tagIndex: 1 })
    const removed = await deck.apply({ type: 'removeBlock', no: 3, block: { tag: 'p', text: 'Rechts', occurrence: 0, tagIndex: 0 } })
    expect(removed.snapshot.slides[2].slots[1].content).toBe('Text')
  })

  it('inserts an image without a focus block', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const result = await deck.apply({ type: 'insertBlock', no: 2, kind: 'image', src: '/images/x.png' })
    expect(result.focusBlock).toBeUndefined()
    expect(result.snapshot.slides[1].content.endsWith('![](/images/x.png)')).toBe(true)
  })

  it('edits a slide without frontmatter and note in an empty slide', async () => {
    const { deck, file } = await deckFrom(lines('# A', '', '---', '', '---', '', '# C'))
    expect(deck.snapshot().slides).toHaveLength(3)
    await deck.apply({ type: 'insertBlock', no: 2, kind: 'heading', text: 'B' })
    expect(await read(file)).toBe(lines('# A', '', '---', '', '## B', '', '---', '', '# C'))
  })
})

describe('undo and redo', () => {
  it('restores file contents step by step', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await deck.apply({ type: 'setLayout', no: 2, layout: 'center' })
    await deck.apply({ type: 'removeSlides', nos: [3] })
    const afterBoth = await read(file)
    let r = await deck.undo()
    expect(r.snapshot.cause).toBe('undo')
    expect(r.snapshot.slides).toHaveLength(3)
    expect(r.snapshot.canRedo).toBe(true)
    r = await deck.undo()
    expect(await read(file)).toBe(SAMPLE)
    expect(r.snapshot.canUndo).toBe(false)
    r = await deck.redo()
    expect(r.snapshot.cause).toBe('redo')
    r = await deck.redo()
    expect(await read(file)).toBe(afterBoth)
    expect(r.snapshot.canRedo).toBe(false)
    // A new edit clears the redo stack.
    await deck.undo()
    await deck.apply({ type: 'setLayout', no: 1, layout: 'end' })
    expect(deck.snapshot().canRedo).toBe(false)
  })

  it('undo with an empty history returns the current snapshot', async () => {
    const { deck } = await deckFrom(SAMPLE)
    const r = await deck.undo()
    expect(r.snapshot).toBe(deck.snapshot())
  })

  it('caps the history at 200 steps', async () => {
    const { deck } = await deckFrom('# A\n')
    for (let i = 0; i < 205; i++)
      await deck.apply({ type: 'updateSlide', no: 1, content: `# A${i}` })
    let steps = 0
    while (deck.snapshot().canUndo) {
      await deck.undo()
      steps++
    }
    expect(steps).toBe(200)
    expect(deck.snapshot().slides[0].content).toBe('# A4')
  }, 60_000)
})

describe('outside changes', () => {
  it('reloads, reports external and makes the change undoable', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await writeFile(file, SAMPLE.replace('# Zwei', '# Vom Agenten'))
    await waitFor(() => changes.some(c => c.cause === 'external'))
    const s = deck.snapshot()
    expect(s.cause).toBe('external')
    expect(s.slides[1].title).toBe('Vom Agenten')
    expect(s.canUndo).toBe(true)
    await deck.undo()
    expect(await read(file)).toBe(SAMPLE)
  })

  it('notices files replaced by rename (atomic writes of other tools)', async () => {
    const { deck, file, dir } = await deckFrom(SAMPLE)
    await writeFile(join(dir, 'tmp-agent'), SAMPLE.replace('# Drei', '# Drei neu'))
    const { rename } = await import('node:fs/promises')
    await rename(join(dir, 'tmp-agent'), file)
    await waitFor(() => changes.some(c => c.cause === 'external'))
    expect(deck.snapshot().slides[2].title).toBe('Drei neu')
    // And the session keeps watching afterwards.
    await writeFile(file, SAMPLE.replace('# Drei', '# Drei zwei'))
    await waitFor(() => deck.snapshot().slides[2].title === 'Drei zwei')
  })

  it('never reports its own writes as external', async () => {
    const { deck } = await deckFrom(SAMPLE)
    for (let i = 0; i < 5; i++)
      await deck.apply({ type: 'updateSlide', no: 2, note: `n${i}` })
    await deck.undo()
    await sleep(500)
    expect(changes.map(c => c.cause)).toEqual(['app', 'app', 'app', 'app', 'app', 'undo'])
  })

  it('keeps the last good snapshot while the YAML is broken', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    await writeFile(file, SAMPLE.replace('layout: two-cols', 'layout: [two-cols'))
    await sleep(500)
    expect(changes).toHaveLength(0)
    expect(deck.snapshot().slides[2].layout).toBe('two-cols')
    await writeFile(file, SAMPLE.replace('layout: two-cols', 'layout: center'))
    await waitFor(() => changes.length > 0)
    expect(deck.snapshot().slides[2].layout).toBe('center')
  })

  it('debounces bursts of writes', async () => {
    const { deck, file } = await deckFrom(SAMPLE)
    for (let i = 0; i < 5; i++)
      await writeFile(file, SAMPLE.replace('# Zwei', `# Zwei ${i}`))
    await waitFor(() => changes.length > 0)
    await sleep(400)
    expect(changes.length).toBeLessThanOrEqual(2)
    expect(deck.snapshot().slides[1].title).toBe('Zwei 4')
  })

  it('writeFile on a deck markdown file is picked up as an outside change', async () => {
    const { deck } = await deckFrom(SAMPLE)
    await deck.writeFile('slides.md', '# Neu\n')
    expect(deck.snapshot().slides).toHaveLength(1)
    expect(deck.snapshot().canUndo).toBe(true)
  })
})

describe('files and assets', () => {
  it('imports assets with clean, unique names', async () => {
    const { deck, dir } = await deckFrom(SAMPLE)
    const src = join(root, 'Foto vom Grill (1).JPG')
    await writeFile(src, 'jpg')
    expect(await deck.importAsset(src)).toBe('/images/foto-vom-grill-1.jpg')
    expect(await deck.importAsset(src)).toBe('/images/foto-vom-grill-1-2.jpg')
    expect(await deck.importAssetData('Übersicht.png', new Uint8Array([1, 2, 3]))).toBe('/images/uebersicht.png')
    expect(await deck.importAssetData('../../evil.png', new Uint8Array([1]))).toBe('/images/evil.png')
    expect(await readFile(join(dir, 'public/images/uebersicht.png'))).toEqual(Buffer.from([1, 2, 3]))
  })

  it('writes deck-relative files and refuses paths outside', async () => {
    const { deck, dir } = await deckFrom(SAMPLE)
    await deck.writeFile('AGENTS.md', '# Regeln\n')
    expect(await read(join(dir, 'AGENTS.md'))).toBe('# Regeln\n')
    await expect(deck.writeFile('../draussen.txt', 'x')).rejects.toThrow(/außerhalb/)
    await expect(deck.writeFile('/etc/passwd', 'x')).rejects.toThrow()
    expect(existsSync(join(root, 'draussen.txt'))).toBe(false)
  })
})

describe('bundles', () => {
  it('exports, opens, repacks after changes and on close', async () => {
    const { deck, dir } = await deckFrom(SAMPLE, { 'public/images/a.png': 'png', 'node_modules/x/index.js': 'x', '.git/HEAD': 'ref', 'old.podium': 'zip' })
    const bundle = join(root, 'Vortrag.podium')
    await deck.exportBundle(bundle)
    const entries = Object.keys(unzipSync(new Uint8Array(await readFile(bundle)))).sort()
    expect(entries).toEqual(['public/images/a.png', 'slides.md'])
    expect(existsSync(join(dir, 'Vortrag.podium'))).toBe(false)

    const opened = await openDeck(bundle, options())
    sessions.push(opened)
    const snap = opened.snapshot()
    expect(snap.bundlePath).toBe(bundle)
    expect(snap.dir.startsWith(join(root, 'work'))).toBe(true)
    expect(snap.slides).toHaveLength(3)

    await opened.apply({ type: 'setLayout', no: 2, layout: 'fact' })
    await sleep(1400)
    const repacked = unzipSync(new Uint8Array(await readFile(bundle)))
    expect(new TextDecoder().decode(repacked['slides.md'])).toContain('layout: fact')

    await opened.apply({ type: 'setLayout', no: 2, layout: 'quote' })
    await opened.close()
    const closed = unzipSync(new Uint8Array(await readFile(bundle)))
    expect(new TextDecoder().decode(closed['slides.md'])).toContain('layout: quote')
  })

  it('opens a bundle that contains a top-level folder', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const bundle = join(root, 'nested.podium')
    await writeFile(bundle, zipSync({ 'mein-vortrag/slides.md': strToU8('# Hallo\n') }))
    const deck = await openDeck(bundle, options())
    sessions.push(deck)
    expect(deck.snapshot().slides[0].title).toBe('Hallo')
  })
})

describe('createDeck', () => {
  it('creates a readable, unique folder and opens it', async () => {
    const starter = { slides: '---\ntheme: default\ntitle: Über Öl\n---\n\n# Über Öl\n', files: { 'AGENTS.md': '# Agents\n', '.gitignore': 'node_modules\n' } }
    const first = await createDeck({ title: 'Über Öl & Gas', template: 'default', parentDir: join(root, 'docs') }, starter, options())
    sessions.push(first)
    expect(first.snapshot().dir).toBe(join(root, 'docs', 'ueber-oel-gas'))
    expect(await read(join(root, 'docs', 'ueber-oel-gas', 'AGENTS.md'))).toBe('# Agents\n')
    expect(first.snapshot().title).toBe('Über Öl')
    const second = await createDeck({ title: 'Über Öl & Gas', template: 'default', parentDir: join(root, 'docs') }, starter, options())
    sessions.push(second)
    expect(second.snapshot().dir).toBe(join(root, 'docs', 'ueber-oel-gas-2'))
    const named = await createDeck({ title: 'x', template: 'default', parentDir: join(root, 'docs'), folderName: 'Mein Ordner' }, starter, options())
    sessions.push(named)
    expect(named.snapshot().dir).toBe(join(root, 'docs', 'Mein Ordner'))
  })

  it('refuses starter files outside the deck', async () => {
    await expect(createDeck({ title: 'x', template: 'default', parentDir: root }, { slides: '# x\n', files: { '../x': 'y' } }, options())).rejects.toThrow()
  })
})
