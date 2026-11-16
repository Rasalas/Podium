import type { DeckSnapshot, SlideSnapshot } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { addThumbnail, emptyThumbCache, foldAgentEvent, rangeIds, resolveMultiSelection, resolveSelection, shouldAccept, thumbnailFor } from '../../../src/renderer/src/lib/deckLogic'

function slide(no: number, id: string, revision = `r${id}`): SlideSnapshot {
  return { no, id, title: id, layout: 'default', frontmatter: {}, frontmatterRaw: '', content: '', note: '', slots: [], filepath: '', imported: false, revision, editability: 'simple' }
}
function deck(revision: number, slides: SlideSnapshot[], deckId = 'd1'): DeckSnapshot {
  return { deckId, dir: '', entry: '', title: '', headmatter: {}, theme: 'default', addons: [], canvas: { width: 980, height: 552 }, slides, canUndo: false, canRedo: false, revision, cause: 'app' }
}

describe('shouldAccept', () => {
  it('takes the first snapshot and newer revisions only', () => {
    const a = deck(3, [])
    expect(shouldAccept(undefined, a, 'd1')).toBe(true)
    expect(shouldAccept(a, deck(3, []), 'd1')).toBe(false)
    expect(shouldAccept(a, deck(2, []), 'd1')).toBe(false)
    expect(shouldAccept(a, deck(4, []), 'd1')).toBe(true)
  })
  it('ignores snapshots of other decks', () => {
    expect(shouldAccept(deck(1, []), deck(9, [], 'other'), 'd1')).toBe(false)
  })
})

describe('resolveSelection', () => {
  const slides = [slide(1, 'a'), slide(2, 'b'), slide(3, 'c')]
  it('prefers an explicit select', () => {
    expect(resolveSelection(slides, { id: 'a', no: 1 }, 3)).toBe(3)
    expect(resolveSelection(slides, { id: 'a', no: 1 }, 99)).toBe(3)
  })
  it('follows the slide by id when it moved', () => {
    const moved = [slide(1, 'c'), slide(2, 'a'), slide(3, 'b')]
    expect(resolveSelection(moved, { id: 'b', no: 2 })).toBe(3)
  })
  it('falls back to the position, clamped', () => {
    expect(resolveSelection([slide(1, 'x')], { id: 'gone', no: 3 })).toBe(1)
    expect(resolveSelection([], { id: 'gone', no: 3 })).toBe(0)
  })
})

describe('multi selection', () => {
  const slides = [slide(1, 'a'), slide(2, 'b'), slide(3, 'c'), slide(4, 'd')]
  it('drops missing ids and keeps the current slide', () => {
    expect([...resolveMultiSelection(slides, ['b', 'zz', 'c'], 'c')]).toEqual(['b', 'c'])
    expect([...resolveMultiSelection(slides, ['b'], 'd')]).toEqual(['d'])
  })
  it('selects ranges in both directions', () => {
    expect(rangeIds(slides, 3, 1)).toEqual(['a', 'b', 'c'])
    expect(rangeIds(slides, 2, 4)).toEqual(['b', 'c', 'd'])
  })
})

describe('thumbnails', () => {
  it('shows an older picture until the current revision arrives', () => {
    let slides = [slide(1, 'a', 'r1')]
    let cache = addThumbnail(emptyThumbCache(), slides, { no: 1, revision: 'r1', dataUrl: 'old' })
    expect(thumbnailFor(cache, slides[0])).toEqual({ src: 'old', stale: false })
    slides = [slide(1, 'a', 'r2')]
    expect(thumbnailFor(cache, slides[0])).toEqual({ src: 'old', stale: true })
    cache = addThumbnail(cache, slides, { no: 1, revision: 'r2', dataUrl: 'new' })
    expect(thumbnailFor(cache, slides[0])).toEqual({ src: 'new', stale: false })
  })
  it('does not let a late old picture replace a newer one', () => {
    const slides = [slide(1, 'a', 'r2')]
    let cache = addThumbnail(emptyThumbCache(), slides, { no: 1, revision: 'r2', dataUrl: 'new' })
    cache = addThumbnail(cache, slides, { no: 1, revision: 'r1', dataUrl: 'old' })
    expect(thumbnailFor(cache, slides[0]).src).toBe('new')
  })
  it('finds a picture by revision after the slide moved', () => {
    const cache = addThumbnail(emptyThumbCache(), [slide(1, 'a', 'r1')], { no: 1, revision: 'r1', dataUrl: 'pic' })
    expect(thumbnailFor(cache, slide(5, 'other-id', 'r1')).src).toBe('pic')
  })
})

describe('foldAgentEvent', () => {
  it('streams text into one message and tracks running', () => {
    let state = foldAgentEvent([], { deckId: 'd', type: 'started', prompt: 'Hallo' })
    expect(state.running).toBe(true)
    state = foldAgentEvent(state.items, { deckId: 'd', type: 'text', text: 'Ich ' })
    state = foldAgentEvent(state.items, { deckId: 'd', type: 'text', text: 'schaue.' })
    state = foldAgentEvent(state.items, { deckId: 'd', type: 'tool', name: 'Edit', detail: 'slides.md' })
    state = foldAgentEvent(state.items, { deckId: 'd', type: 'text', text: 'Fertig.' })
    state = foldAgentEvent(state.items, { deckId: 'd', type: 'done', ok: true })
    expect(state.running).toBe(false)
    expect(state.items.map(i => [i.kind, i.text])).toEqual([
      ['user', 'Hallo'],
      ['assistant', 'Ich schaue.'],
      ['tool', 'Edit'],
      ['assistant', 'Fertig.'],
      ['status', 'done'],
    ])
  })
})
