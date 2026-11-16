import { describe, expect, it } from 'vitest'
import { MockDeck } from '../../../src/renderer/src/mock/deck'

function make() {
  return new MockDeck('d1', '/tmp/deck', { title: 'Test', theme: 'klar' }, [
    { frontmatter: {}, content: '# Titel', note: '' },
    { frontmatter: {}, content: '# Liste\n\n- Eins\n- Zwei', note: '' },
    { frontmatter: { layout: 'center' }, content: '# Ende', note: '' },
  ])
}

describe('MockDeck', () => {
  it('inserts, moves and removes slides with undo/redo', () => {
    const deck = make()
    let r = deck.apply({ type: 'insertSlide', after: 1, layout: 'section' })
    expect(r.select).toBe(2)
    expect(r.snapshot.slides.map(s => s.layout)).toEqual(['cover', 'section', 'default', 'center'])
    r = deck.apply({ type: 'moveSlide', from: 4, to: 1 })
    expect(r.snapshot.slides[0].title).toBe('Ende')
    r = deck.apply({ type: 'removeSlides', nos: [1, 2] })
    expect(r.snapshot.slides.map(s => s.title)).toEqual(['Neuer Abschnitt', 'Liste'])
    r = deck.undo()
    expect(r.snapshot.slides).toHaveLength(4)
    expect(r.snapshot.canRedo).toBe(true)
    r = deck.redo()
    expect(r.snapshot.slides).toHaveLength(2)
    expect(r.snapshot.revision).toBeGreaterThan(1)
  })

  it('edits and splits list items by block reference', () => {
    const deck = make()
    const block = { tag: 'li', text: 'Eins', occurrence: 0, tagIndex: 0 }
    const r = deck.apply({ type: 'splitListItem', no: 2, block, markdown: '**Eins**', newItem: 'Neu' })
    expect(r.snapshot.slides[1].content).toBe('# Liste\n\n- **Eins**\n- Neu\n- Zwei')
    expect(r.focusBlock).toEqual({ tag: 'li', text: 'Neu', occurrence: 0, tagIndex: 1 })
  })

  it('returns a focus block for inserted text', () => {
    const deck = make()
    const r = deck.apply({ type: 'insertBlock', no: 1, kind: 'text' })
    expect(r.snapshot.slides[0].content).toBe('# Titel\n\nNeuer Text')
    expect(r.focusBlock).toEqual({ tag: 'p', text: 'Neuer Text', occurrence: 0, tagIndex: 0 })
  })

  it('rejects invalid frontmatter without changing anything', () => {
    const deck = make()
    expect(() => deck.apply({ type: 'updateSlide', no: 1, frontmatterRaw: 'a: [' })).toThrow()
    expect(deck.snapshot().canUndo).toBe(false)
    const r = deck.apply({ type: 'updateSlide', no: 1, frontmatterRaw: 'layout: center\nclass: big' })
    expect(r.snapshot.slides[0].frontmatter).toEqual({ layout: 'center', class: 'big' })
    expect(r.snapshot.slides[0].layout).toBe('center')
  })
})
