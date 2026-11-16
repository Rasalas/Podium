import type { TextEdit } from '../../../src/shared/types'
import { describe, expect, it } from 'vitest'
import { parseSourceFile, serializeSourceFile } from '../../../src/main/deck/source'
import { editTextInContent, editTextInUnit, TextEditError } from '../../../src/main/deck/text'

const edit = (before: string, after: string, extra: Partial<TextEdit> = {}): TextEdit => ({ before, after, occurrence: 0, total: 1, ...extra })

describe('text edits in slide content', () => {
  const steps = [
    '# Vom Entwurf zum Film',
    '',
    '<ol>',
    '<li>Entwurf<ul><li>der Text aus dem Verein</li></ul></li>',
    '<li v-click="1">Skript<ul><li>Szenen und Sprechtext</li></ul></li>',
    '</ol>',
  ].join('\n')

  it('changes text inside HTML and nothing else', () => {
    const next = editTextInContent(steps, edit('Szenen und Sprechtext', 'Szenen und Text'))
    expect(next).toBe(steps.replace('Szenen und Sprechtext', 'Szenen und Text'))
  })

  it('does not touch tags, attributes or words inside other text', () => {
    const content = '<div class="Set">\n\nDas Set steht in Hamburg.\n\n</div>\n\n<p class="x">Set</p>'
    // "Set" as a whole text node is only the last one: not the class, not the word in the sentence.
    expect(editTextInContent(content, edit('Set', 'Bühne'))).toBe(content.replace('>Set<', '>Bühne<'))
  })

  it('finds text next to an icon in a heading through its block', () => {
    const content = '### <ph-x-circle-duotone /> Oft gesehen\n\n- Textfolie\n\n### <ph-check-circle-duotone /> Bei uns'
    const block = { tag: 'h3', text: 'Bei uns', occurrence: 0, tagIndex: 1 }
    expect(editTextInContent(content, edit(' Bei uns', 'Bei euch', { block }))).toBe(content.replace('Bei uns', 'Bei euch'))
  })

  it('leaves editable markdown blocks to the block editor when no block is given', () => {
    const content = '# Hamburg\n\n<p class="ort">Hamburg</p>'
    expect(editTextInContent(content, edit('Hamburg', 'Bremen'))).toBe('# Hamburg\n\n<p class="ort">Bremen</p>')
  })

  it('picks the right one of several equal texts by position', () => {
    const content = '<td>offen</td>\n<td>offen</td>\n<td>offen</td>'
    expect(editTextInContent(content, edit('offen', 'fertig', { occurrence: 1, total: 3 }))).toBe('<td>offen</td>\n<td>fertig</td>\n<td>offen</td>')
  })

  it('refuses when the count on the slide and in the file differ', () => {
    const content = '<td>offen</td>\n<td>offen</td>'
    expect(() => editTextInContent(content, edit('offen', 'fertig', { occurrence: 0, total: 5 }))).toThrow(TextEditError)
  })

  it('edits table cells and text that wraps over lines', () => {
    const table = '| Kurs | Stand |\n| --- | --- |\n| Wandern | offen |'
    expect(editTextInContent(table, edit('offen', 'fertig'))).toBe(table.replace('offen', 'fertig'))
    const wrapped = '<div>\n  Eine Zeile,\n  die umbricht\n</div>'
    expect(editTextInContent(wrapped, edit('Eine Zeile, die umbricht', 'Eine Zeile'))).toBe('<div>\n  Eine Zeile\n</div>')
  })

  it('matches entities and keeps a typed "<" as text', () => {
    const content = '<p>Fragen &amp; Antworten</p>'
    expect(editTextInContent(content, edit('Fragen & Antworten', 'Fragen <3 Antworten'))).toBe('<p>Fragen &lt;3 Antworten</p>')
  })

  it('leaves text that is put together from pieces to the fallback for the whole slide', () => {
    const content = '<p>Stand {{ $slidev.configs.title }}: das Set steht in Hamburg</p>'
    const next = editTextInContent(content, edit('Stand Filme: das Set steht in Hamburg', 'Stand Filme: das Set steht in Bremen'))
    expect(next).toBeUndefined()
  })

  it('returns undefined when the text is not in the content', () => {
    expect(editTextInContent(steps, edit('Ablauf', 'Plan'))).toBeUndefined()
    expect(editTextInContent(steps, edit('Skript', 'Skript'))).toBeUndefined()
  })
})

describe('text edits in a deck file', () => {
  const source = [
    '---',
    'theme: slidev-theme-hausfarbe',
    'title: Filme für den Wanderverein',
    'kicker: Jahrestreffen · Wanderverein',
    'themeConfig:',
    '  footer: Wanderverein · Jahrestreffen · 13.11.2026 # steht auf jeder Folie',
    '---',
    '',
    '# Filme für den Wanderverein',
    '',
    '---',
    'layout: steps',
    'kicker: Ablauf',
    '---',
    '',
    '# Vom Entwurf zum Film',
    '',
    '<p>Stand {{ $slidev.configs.title }}: das Set steht in Hamburg</p>',
    '',
    '<!-- Notiz: Ablauf erklären, Hamburg erwähnen -->',
    '',
  ].join('\n')

  function run(no: number, change: TextEdit): string {
    const file = parseSourceFile('slides.md', source)
    const unit = file.units[no - 1]
    editTextInUnit(unit, no === 1 ? undefined : file.units[0], change)
    return serializeSourceFile(file)
  }

  it('changes a kicker in the slide\'s frontmatter', () => {
    expect(run(2, edit('Ablauf', 'Der Plan: drei Schritte'))).toBe(source.replace('kicker: Ablauf', 'kicker: "Der Plan: drei Schritte"'))
  })

  it('changes a deck-wide footer from any slide and keeps its comment', () => {
    const next = run(2, edit('Wanderverein · Jahrestreffen · 13.11.2026', 'Wanderverein · Jahrestreffen · 14.11.2026'))
    expect(next).toBe(source.replace('13.11.2026 #', '14.11.2026 #'))
  })

  it('changes only the words that differ when the text is put together from pieces', () => {
    const next = run(2, edit('Stand Filme für den Wanderverein: das Set steht in Hamburg', 'Stand Filme für den Wanderverein: das Set steht in Bremen'))
    // The note mentions Hamburg too and stays as it is.
    expect(next).toBe(source.replace('steht in Hamburg', 'steht in Bremen'))
  })

  it('says so when the text comes from the theme', () => {
    expect(() => run(2, edit('Powered by Slidev', 'x'))).toThrow(/Vorlage/)
  })

  it('refuses when two settings show the same text', () => {
    const file = parseSourceFile('slides.md', source.replace('kicker: Ablauf', 'kicker: Ablauf\nsubtitle: Ablauf'))
    expect(() => editTextInUnit(file.units[1], file.units[0], edit('Ablauf', 'Plan'))).toThrow(TextEditError)
  })
})
