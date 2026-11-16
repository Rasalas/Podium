import type { BlockRef } from '../../../src/shared/types'
import { describe, expect, it } from 'vitest'
import {
  editabilityOf,
  editBlockContent,
  insertBlockContent,
  parseContent,
  refForLine,
  removeBlockContent,
  setSlotContent,
  slotsOf,
  splitListItemContent,
} from '../../../src/main/deck/blocks'

function ref(tag: string, text: string, occurrence = 0, tagIndex = 0): BlockRef {
  return { tag, text, occurrence, tagIndex }
}

const md = (...lines: string[]) => lines.join('\n')

describe('parseContent blocks', () => {
  it('lists the blocks the launcher tags, in document order', () => {
    const { blocks } = parseContent(md(
      '# Title',
      '',
      'Intro **bold** and `code`',
      '',
      '- one',
      '- two',
      '  - nested',
      '',
      '> quoted',
      '',
      'Setext',
      '======',
      '',
      '```js',
      'code()',
      '```',
    ))
    expect(blocks.map(b => [b.tag, b.text])).toEqual([
      ['h1', 'Title'],
      ['p', 'Intro bold and code'],
      ['li', 'one'],
      ['li', 'two'],
      ['li', 'nested'],
      ['p', 'quoted'],
    ])
  })

  it('does not count slot markers as paragraphs and records the slot', () => {
    const { blocks, slots } = parseContent(md('# Left', '', '::right::', '', 'Right text'))
    expect(blocks.map(b => [b.tag, b.slot])).toEqual([['h1', 'default'], ['p', 'right']])
    expect(slots.map(s => s.name)).toEqual(['default', 'right'])
  })

  it('renders breaks as spaces and collapses whitespace', () => {
    const { blocks } = parseContent(md('one', 'two  ', 'three   four'))
    expect(blocks[0].text).toBe('one two three four')
  })

  it('strips task checkboxes from list item text', () => {
    const { blocks } = parseContent(md('- [ ] open task', '- [x] done'))
    expect(blocks.map(b => b.text)).toEqual(['open task', 'done'])
    expect(blocks.every(b => !b.editable)).toBe(true)
  })
})

describe('editBlockContent', () => {
  it('replaces one heading and leaves every other line alone', () => {
    const content = md('# Hallo', '', 'Text', '', '## Unter')
    expect(editBlockContent(content, ref('h1', 'Hallo'), 'Servus')).toBe(md('# Servus', '', 'Text', '', '## Unter'))
  })

  it('keeps closing heading markers', () => {
    expect(editBlockContent('## Alt ##', ref('h2', 'Alt'), 'Neu')).toBe('## Neu ##')
  })

  it('collapses a soft-wrapped paragraph into the new text', () => {
    const content = md('Erste Zeile', 'zweite Zeile', 'dritte', '', 'Danach')
    expect(editBlockContent(content, ref('p', 'Erste Zeile zweite Zeile dritte'), 'Kurz')).toBe(md('Kurz', '', 'Danach'))
  })

  it('keeps list bullets and numbers', () => {
    expect(editBlockContent(md('- a', '- b', '- c'), ref('li', 'b'), 'B')).toBe(md('- a', '- B', '- c'))
    expect(editBlockContent(md('1. a', '2. b'), ref('li', 'b'), '**B**')).toBe(md('1. a', '2. **B**'))
    expect(editBlockContent(md('* a', '+ x'), ref('li', 'x'), 'y')).toBe(md('* a', '+ y'))
    expect(editBlockContent(md('3) a'), ref('li', 'a'), 'b')).toBe('3) b')
  })

  it('keeps indentation of nested list items', () => {
    const content = md('- outer', '  - inner', '    - deep', '- next')
    expect(editBlockContent(content, ref('li', 'inner'), 'INNER')).toBe(md('- outer', '  - INNER', '    - deep', '- next'))
    expect(editBlockContent(content, ref('li', 'deep'), 'DEEP')).toBe(md('- outer', '  - inner', '    - DEEP', '- next'))
  })

  it('handles an item nested on the same line as its parent marker', () => {
    expect(editBlockContent('- - inner', ref('li', 'inner'), 'neu')).toBe('- - neu')
  })

  it('keeps task list checkboxes', () => {
    expect(editBlockContent(md('- [ ] todo', '- [x] done'), ref('li', 'done'), 'erledigt')).toBe(md('- [ ] todo', '- [x] erledigt'))
  })

  it('keeps blockquote prefixes, also for wrapped quotes', () => {
    expect(editBlockContent(md('> Zitat', '> weiter'), ref('p', 'Zitat weiter'), 'Neu')).toBe('> Neu')
    expect(editBlockContent(md('> > tief'), ref('p', 'tief'), 'x')).toBe('> > x')
  })

  it('edits a list inside a blockquote', () => {
    expect(editBlockContent(md('> - a', '> - b'), ref('li', 'b'), 'c')).toBe(md('> - a', '> - c'))
  })

  it('edits a multi-line list item and the continuation lines', () => {
    const content = md('- erste', '  zweite', '- danach')
    expect(editBlockContent(content, ref('li', 'erste zweite'), 'eins')).toBe(md('- eins', '- danach'))
    expect(editBlockContent(content, ref('li', 'erste zweite'), 'eins\nzwei')).toBe(md('- eins', '  zwei', '- danach'))
  })

  it('edits the second paragraph of a loose list item', () => {
    const content = md('- first', '', '  second para', '', '- next')
    expect(editBlockContent(content, ref('li', 'second para'), 'neu')).toBe(md('- first', '', '  neu', '', '- next'))
  })

  it('edits a heading inside a list item', () => {
    expect(editBlockContent('- ## Head', ref('h2', 'Head'), 'Kopf')).toBe('- ## Kopf')
  })

  it('picks the right occurrence of identical blocks', () => {
    const content = md('- gleich', '- gleich', '- gleich')
    expect(editBlockContent(content, ref('li', 'gleich', 1, 1), 'zwei')).toBe(md('- gleich', '- zwei', '- gleich'))
    expect(editBlockContent(content, ref('li', 'gleich', 2, 2), 'drei')).toBe(md('- gleich', '- gleich', '- drei'))
  })

  it('falls back to the tag index when the text does not match', () => {
    const content = md('# A', '', '# B', '', '# C')
    expect(editBlockContent(content, ref('h1', 'stale text', 0, 1), 'Neu')).toBe(md('# A', '', '# Neu', '', '# C'))
  })

  it('throws a readable error when nothing matches', () => {
    expect(() => editBlockContent('# A', ref('h2', 'x', 0, 0), 'y')).toThrow(/nicht gefunden/)
  })

  it('compares text with formatting stripped', () => {
    const content = md('Ein **fetter** und *kursiver* Text mit [Link](https://x.de)')
    expect(editBlockContent(content, ref('p', 'Ein fetter und kursiver Text mit Link'), 'Neu')).toBe('Neu')
  })

  it('works inside named slots', () => {
    const content = md('# Links', '', '- a', '', '::right::', '', '# Rechts', '', 'Text rechts')
    expect(editBlockContent(content, ref('p', 'Text rechts'), 'Neu rechts')).toBe(md('# Links', '', '- a', '', '::right::', '', '# Rechts', '', 'Neu rechts'))
    expect(editBlockContent(content, ref('h1', 'Rechts', 0, 1), 'R')).toBe(md('# Links', '', '- a', '', '::right::', '', '# R', '', 'Text rechts'))
  })

  it('escapes text that would change the block type', () => {
    expect(editBlockContent('Text', ref('p', 'Text'), '# kein Titel')).toBe('\\# kein Titel')
    expect(editBlockContent('Text', ref('p', 'Text'), '- kein Punkt')).toBe('\\- kein Punkt')
    expect(editBlockContent('Text', ref('p', 'Text'), '---')).toBe('\\---')
    expect(editBlockContent('Text', ref('p', 'Text'), '::right::')).toBe('\\::right::')
    expect(editBlockContent('Text', ref('p', 'Text'), '2026. Jahr')).toBe('2026\\. Jahr')
    expect(editBlockContent('- a', ref('li', 'a'), '- b')).toBe('- \\- b')
  })

  it('joins multi-line markdown into one heading line', () => {
    expect(editBlockContent('# A', ref('h1', 'A'), 'eins\nzwei')).toBe('# eins zwei')
  })

  it('leaves HTML and code blocks untouched', () => {
    const content = md('<div class="x">', '', 'inside', '', '</div>', '', 'outside')
    expect(editBlockContent(content, ref('p', 'outside'), 'neu')).toBe(md('<div class="x">', '', 'inside', '', '</div>', '', 'neu'))
  })

  it('keeps CRLF-free content and inline html text in comparison', () => {
    const content = 'Hallo <b>Welt</b>'
    expect(editBlockContent(content, ref('p', 'Hallo Welt'), 'x')).toBe('x')
  })
})

describe('splitListItemContent', () => {
  it('adds a bullet after the item and focuses it', () => {
    const result = splitListItemContent(md('- a', '- b'), ref('li', 'a'), 'a1', 'neu')
    expect(result.content).toBe(md('- a1', '- neu', '- b'))
    expect(refForLine(result.content, result.focusLine!)).toEqual({ tag: 'li', text: 'neu', occurrence: 0, tagIndex: 1 })
  })

  it('increments and renumbers ordered lists', () => {
    const result = splitListItemContent(md('1. a', '2. b', '3. c'), ref('li', 'a'), 'a', 'x')
    expect(result.content).toBe(md('1. a', '2. x', '3. b', '4. c'))
  })

  it('keeps all-same numbers', () => {
    const result = splitListItemContent(md('1. a', '1. b'), ref('li', 'a'), 'a', 'x')
    expect(result.content).toBe(md('1. a', '1. x', '1. b'))
  })

  it('keeps nested indentation and goes after the item children', () => {
    const result = splitListItemContent(md('- a', '  - a1', '  - a2', '- b'), ref('li', 'a1'), 'a1', 'neu')
    expect(result.content).toBe(md('- a', '  - a1', '  - neu', '  - a2', '- b'))
    const outer = splitListItemContent(md('- a', '  - a1', '- b'), ref('li', 'a'), 'A', 'neu')
    expect(outer.content).toBe(md('- A', '  - a1', '- neu', '- b'))
  })

  it('adds an empty item', () => {
    const result = splitListItemContent(md('- a'), ref('li', 'a'), 'a', '')
    expect(result.content).toBe(md('- a', '- '))
    expect(refForLine(result.content, result.focusLine!)).toEqual({ tag: 'li', text: '', occurrence: 0, tagIndex: 1 })
  })

  it('handles loose lists, task lists and quotes', () => {
    expect(splitListItemContent(md('- a', '', '- b'), ref('li', 'a'), 'a', 'x').content).toBe(md('- a', '', '- x', '', '- b'))
    expect(splitListItemContent(md('- [x] a'), ref('li', 'a'), 'a', 'x').content).toBe(md('- [x] a', '- [ ] x'))
    expect(splitListItemContent(md('> - a'), ref('li', 'a'), 'a', 'x').content).toBe(md('> - a', '> - x'))
    expect(splitListItemContent(md('9. a'), ref('li', 'a'), 'a', 'x').content).toBe(md('9. a', '9. x'))
  })

  it('collapses a wrapped item before splitting', () => {
    const result = splitListItemContent(md('- a', '  b', '- c'), ref('li', 'a b'), 'ab', 'neu')
    expect(result.content).toBe(md('- ab', '- neu', '- c'))
  })

  it('refuses non-list blocks', () => {
    expect(() => splitListItemContent('Text', ref('p', 'Text'), 'x', 'y')).toThrow()
  })
})

describe('removeBlockContent', () => {
  it('removes a paragraph and one of the blank lines around it', () => {
    expect(removeBlockContent(md('# A', '', 'weg', '', 'bleibt'), ref('p', 'weg'))).toBe(md('# A', '', 'bleibt'))
  })

  it('removes the last block without leaving trailing blank lines', () => {
    expect(removeBlockContent(md('# A', '', 'weg'), ref('p', 'weg'))).toBe('# A')
  })

  it('removes the first block', () => {
    expect(removeBlockContent(md('# A', '', 'bleibt'), ref('h1', 'A'))).toBe('bleibt')
  })

  it('removes one list item', () => {
    expect(removeBlockContent(md('- a', '- b', '- c'), ref('li', 'b'))).toBe(md('- a', '- c'))
  })

  it('removes a list item with its children', () => {
    expect(removeBlockContent(md('- a', '  - a1', '- b'), ref('li', 'a'))).toBe(md('- b'))
  })

  it('removes a now-empty list', () => {
    expect(removeBlockContent(md('# T', '', '- only', '', 'after'), ref('li', 'only'))).toBe(md('# T', '', 'after'))
  })

  it('removes the last nested item and with it the nested list', () => {
    expect(removeBlockContent(md('- a', '  - a1', '- b'), ref('li', 'a1'))).toBe(md('- a', '- b'))
  })

  it('removes a quote that becomes empty', () => {
    expect(removeBlockContent(md('A', '', '> zitat', '> weiter', '', 'B'), ref('p', 'zitat weiter'))).toBe(md('A', '', 'B'))
  })

  it('removes the last item of a loose list with its blank line', () => {
    expect(removeBlockContent(md('- a', '', '- b', '', 'after'), ref('li', 'b'))).toBe(md('- a', '', 'after'))
  })

  it('keeps slot markers', () => {
    expect(removeBlockContent(md('a', '', '::right::', '', 'b'), ref('p', 'b'))).toBe(md('a', '', '::right::'))
  })
})

describe('insertBlockContent', () => {
  it('appends to the default slot with one blank line', () => {
    const result = insertBlockContent('# A', { kind: 'text' })
    expect(result.content).toBe(md('# A', '', 'Text'))
    expect(refForLine(result.content, result.focusLine!)).toEqual({ tag: 'p', text: 'Text', occurrence: 0, tagIndex: 0 })
  })

  it('inserts into empty content', () => {
    expect(insertBlockContent('', { kind: 'heading' }).content).toBe('## Überschrift')
  })

  it('appends to the default slot before the first marker', () => {
    const result = insertBlockContent(md('# A', '', '::right::', '', 'r'), { kind: 'list' })
    expect(result.content).toBe(md('# A', '', '- Punkt', '', '::right::', '', 'r'))
  })

  it('appends to a named slot', () => {
    const result = insertBlockContent(md('# A', '', '::right::', '', 'r'), { kind: 'numbered-list', slot: 'right', text: 'eins' })
    expect(result.content).toBe(md('# A', '', '::right::', '', 'r', '', '1. eins'))
    expect(refForLine(result.content, result.focusLine!)?.text).toBe('eins')
  })

  it('appends to an empty named slot followed by another marker', () => {
    const result = insertBlockContent(md('::left::', '::right::', 'r'), { kind: 'text', slot: 'left', text: 'L' })
    expect(result.content).toBe(md('::left::', '', 'L', '', '::right::', 'r'))
  })

  it('creates a missing slot', () => {
    const result = insertBlockContent('# A', { kind: 'quote', slot: 'right' })
    expect(result.content).toBe(md('# A', '', '::right::', '', '> Zitat'))
    expect(refForLine(result.content, result.focusLine!)).toEqual({ tag: 'p', text: 'Zitat', occurrence: 0, tagIndex: 0 })
  })

  it('inserts after a given block', () => {
    const result = insertBlockContent(md('# A', '', 'B'), { kind: 'heading', after: ref('h1', 'A'), text: 'Neu' })
    expect(result.content).toBe(md('# A', '', '## Neu', '', 'B'))
    expect(refForLine(result.content, result.focusLine!)).toEqual({ tag: 'h2', text: 'Neu', occurrence: 0, tagIndex: 0 })
  })

  it('inserts after the whole list when the anchor is an item', () => {
    const result = insertBlockContent(md('- a', '- b', '', 'c'), { kind: 'text', after: ref('li', 'a'), text: 'x' })
    expect(result.content).toBe(md('- a', '- b', '', 'x', '', 'c'))
  })

  it('inserts a sibling item when a list is inserted after an item', () => {
    const result = insertBlockContent(md('- a', '- b'), { kind: 'list', after: ref('li', 'a'), text: 'x' })
    expect(result.content).toBe(md('- a', '- x', '- b'))
  })

  it('builds the other kinds', () => {
    expect(insertBlockContent('A', { kind: 'image', src: '/images/foto.png' })).toEqual({ content: md('A', '', '![](/images/foto.png)'), focusLine: undefined })
    expect(insertBlockContent('A', { kind: 'code' }).content).toBe(md('A', '', '```', '', '```'))
    expect(insertBlockContent('A', { kind: 'table' }).content).toBe(md('A', '', '| Spalte 1 | Spalte 2 |', '| --- | --- |', '|   |   |'))
  })
})

describe('slots', () => {
  it('splits content at slot markers', () => {
    expect(slotsOf(md('# L', '', '::right::', '', '# R', '', '::bottom::', 'x'))).toEqual([
      { name: 'default', content: '# L' },
      { name: 'right', content: '# R' },
      { name: 'bottom', content: 'x' },
    ])
  })

  it('ignores markers inside code fences', () => {
    expect(slotsOf(md('```', '::right::', '```')).map(s => s.name)).toEqual(['default'])
  })

  it('replaces one slot', () => {
    const content = md('# L', '', '::right::', '', '# R', '', '::bottom::', '', 'x')
    expect(setSlotContent(content, 'right', 'neu\n\nzwei')).toBe(md('# L', '', '::right::', '', 'neu', '', 'zwei', '', '::bottom::', '', 'x'))
    expect(setSlotContent(content, 'default', 'D')).toBe(md('D', '', '::right::', '', '# R', '', '::bottom::', '', 'x'))
    expect(setSlotContent(content, 'bottom', 'y')).toBe(md('# L', '', '::right::', '', '# R', '', '::bottom::', '', 'y'))
  })

  it('creates a missing slot marker', () => {
    expect(setSlotContent('# L', 'right', 'R')).toBe(md('# L', '', '::right::', '', 'R'))
    expect(setSlotContent('', 'right', 'R')).toBe(md('::right::', '', 'R'))
  })
})

describe('editabilityOf', () => {
  it('is simple for plain markdown and harmless blocks', () => {
    expect(editabilityOf(md('# A', '', 'text', '', '- x', '', '![](/a.png)', '', '```js', 'x', '```', '', '| a |', '| - |', '| b |', '', '---x', '', '> q'))).toBe('simple')
    expect(editabilityOf('')).toBe('simple')
    expect(editabilityOf(md('# L', '', '::right::', '', 'R'))).toBe('simple')
  })

  it('is code when only HTML or Vue is there', () => {
    expect(editabilityOf(md('<div class="grid">', '  <Foo />', '</div>'))).toBe('code')
  })

  it('is mixed when editable markdown and HTML meet', () => {
    expect(editabilityOf(md('# A', '', '<div>x</div>'))).toBe('mixed')
    expect(editabilityOf('Text mit <span>html</span>')).toBe('code')
    expect(editabilityOf(md('# A', '', 'Text mit {{ $slidev.nav.currentPage }}'))).toBe('mixed')
  })
})

describe('empty list items and headings', () => {
  it('lists empty items and headings as editable blocks in document order', () => {
    const { blocks } = parseContent(md('# ', '', '- a', '  * x', '  * ', '- ', '- b', '', '1. ', '', '::right::', '', '- ', '', '##'))
    expect(blocks.map(b => [b.tag, b.text, b.editable, b.line0, b.slot])).toEqual([
      ['h1', '', true, 0, 'default'],
      ['li', 'a', true, 2, 'default'],
      ['li', 'x', true, 3, 'default'],
      ['li', '', true, 4, 'default'],
      ['li', '', true, 5, 'default'],
      ['li', 'b', true, 6, 'default'],
      ['li', '', true, 8, 'default'],
      ['li', '', true, 12, 'right'],
      ['h2', '', true, 14, 'right'],
    ])
  })

  it('counts empty blocks as editable for editability', () => {
    expect(editabilityOf(md('- ', '- '))).toBe('simple')
    expect(editabilityOf(md('## ', '', '<div>x</div>'))).toBe('mixed')
  })

  it('writes text after the marker of an empty item or heading', () => {
    expect(editBlockContent(md('- a', '- '), ref('li', '', 0, 1), 'Neuer Punkt')).toBe(md('- a', '- Neuer Punkt'))
    expect(editBlockContent(md('- a', '-'), ref('li', '', 0, 1), 'x')).toBe(md('- a', '- x'))
    expect(editBlockContent(md('- a', '  - b', '  - '), ref('li', '', 0, 2), 'tief')).toBe(md('- a', '  - b', '  - tief'))
    expect(editBlockContent(md('1. a', '2. '), ref('li', '', 0, 1), 'zwei')).toBe(md('1. a', '2. zwei'))
    expect(editBlockContent(md('> - '), ref('li', '', 0, 0), 'q')).toBe('> - q')
    expect(editBlockContent('## ', ref('h2', '', 0, 0), 'Titel')).toBe('## Titel')
    expect(editBlockContent('##', ref('h2', '', 0, 0), 'Titel')).toBe('## Titel')
    expect(editBlockContent(md('::right::', '', '- '), ref('li', '', 0, 0), 'r')).toBe(md('::right::', '', '- r'))
  })

  it('committing an empty string keeps the marker', () => {
    expect(editBlockContent(md('- a', '- b'), ref('li', 'b', 0, 1), '')).toBe(md('- a', '- '))
    expect(editBlockContent(md('  1. a'), ref('li', 'a'), '')).toBe('  1. ')
    expect(editBlockContent('## Titel ##', ref('h2', 'Titel'), '')).toBe('## ')
    expect(editBlockContent(md('- '), ref('li', '', 0, 0), '')).toBe('- ')
  })

  it('picks the right empty item by occurrence', () => {
    const content = md('- ', '- x', '- ', '- ')
    expect(editBlockContent(content, ref('li', '', 1, 2), 'zwei')).toBe(md('- ', '- x', '- zwei', '- '))
  })

  it('splits an empty item again (Enter in a fresh item)', () => {
    const first = splitListItemContent(md('- a'), ref('li', 'a'), 'a', '')
    const focus1 = refForLine(first.content, first.focusLine!)!
    expect(focus1).toEqual({ tag: 'li', text: '', occurrence: 0, tagIndex: 1 })
    const second = splitListItemContent(first.content, focus1, '', '')
    expect(second.content).toBe(md('- a', '- ', '- '))
    expect(refForLine(second.content, second.focusLine!)).toEqual({ tag: 'li', text: '', occurrence: 1, tagIndex: 2 })
    const ordered = splitListItemContent(md('1. a', '2. '), ref('li', '', 0, 1), '', '')
    expect(ordered.content).toBe(md('1. a', '2. ', '3. '))
    const nested = splitListItemContent(md('- a', '  - b', '  - ', '- c'), ref('li', '', 0, 2), '', '')
    expect(nested.content).toBe(md('- a', '  - b', '  - ', '  - ', '- c'))
    expect(refForLine(nested.content, nested.focusLine!)).toEqual({ tag: 'li', text: '', occurrence: 1, tagIndex: 3 })
  })

  it('removes an empty item and an otherwise empty list', () => {
    expect(removeBlockContent(md('- a', '- ', '- b'), ref('li', '', 0, 1))).toBe(md('- a', '- b'))
    expect(removeBlockContent(md('# T', '', '- ', '', 'x'), ref('li', '', 0, 0))).toBe(md('# T', '', 'x'))
    expect(removeBlockContent(md('- a', '  - b', '  - '), ref('li', '', 0, 2))).toBe(md('- a', '  - b'))
    expect(removeBlockContent(md('- a', '', '  - ', '- c'), ref('li', '', 0, 1))).toBe(md('- a', '', '- c'))
    expect(removeBlockContent(md('# T', '', '## ', '', 'x'), ref('h2', '', 0, 0))).toBe(md('# T', '', 'x'))
  })

  it('insertBlock focuses a new empty item or heading', () => {
    const list = insertBlockContent('# A', { kind: 'list', text: '' })
    expect(list.content).toBe(md('# A', '', '- '))
    expect(refForLine(list.content, list.focusLine!)).toEqual({ tag: 'li', text: '', occurrence: 0, tagIndex: 0 })
    const heading = insertBlockContent('# A', { kind: 'heading', text: '' })
    expect(heading.content).toBe(md('# A', '', '## '))
    expect(refForLine(heading.content, heading.focusLine!)).toEqual({ tag: 'h2', text: '', occurrence: 0, tagIndex: 0 })
    const sibling = insertBlockContent(md('- a', '- b'), { kind: 'list', after: ref('li', 'a'), text: '' })
    expect(sibling.content).toBe(md('- a', '- ', '- b'))
    expect(refForLine(sibling.content, sibling.focusLine!)).toEqual({ tag: 'li', text: '', occurrence: 0, tagIndex: 1 })
  })
})
