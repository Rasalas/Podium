import type { PodiumBridge } from '@shared/ipc'
import type { DeckOp, DeckSnapshot, SlideSnapshot } from '@shared/types'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { setApi } from '../../../src/renderer/src/api'
import { useDeckStore } from '../../../src/renderer/src/stores/deck'
import { useUiStore } from '../../../src/renderer/src/stores/ui'

function slide(no: number, id: string): SlideSnapshot {
  return { no, id, title: id, layout: 'default', frontmatter: {}, frontmatterRaw: '', content: '', note: '', slots: [], filepath: '', imported: false, revision: id, editability: 'simple' }
}
function snap(revision: number, ids: string[], cause: DeckSnapshot['cause'] = 'app'): DeckSnapshot {
  return { deckId: 'd1', dir: '', entry: '', title: 'T', headmatter: {}, theme: 'klar', addons: [], canvas: { width: 980, height: 552 }, slides: ids.map((id, i) => slide(i + 1, id)), canUndo: true, canRedo: false, revision, cause }
}

let onApply: (op: DeckOp) => Promise<{ snapshot: DeckSnapshot, select?: number }>

beforeEach(() => {
  setActivePinia(createPinia())
  setApi({
    getLayouts: async () => [],
    applyOp: async (_id: string, op: DeckOp) => onApply(op),
  } as unknown as PodiumBridge)
})

describe('deck store', () => {
  it('keeps the selected slide by id across outside changes', () => {
    const deck = useDeckStore()
    deck.load(snap(1, ['a', 'b', 'c']))
    deck.select(2)
    deck.accept(snap(2, ['x', 'a', 'b', 'c'], 'external'))
    expect(deck.current?.id).toBe('b')
    expect(deck.currentNo).toBe(3)
    expect(useUiStore().toasts.map(t => t.message)).toContain('Von außen geändert')
  })

  it('ignores older snapshots', () => {
    const deck = useDeckStore()
    deck.load(snap(5, ['a', 'b']))
    expect(deck.accept(snap(4, ['a']))).toBe(false)
    expect(deck.slides).toHaveLength(2)
  })

  it('applies the op result selection even when the change event came first', async () => {
    const deck = useDeckStore()
    deck.load(snap(1, ['a', 'b', 'c', 'd']))
    deck.select(3)
    const after = snap(2, ['a', 'd'])
    onApply = async () => {
      deck.accept(after) // 'deck:changed' arrives before the invoke reply
      return { snapshot: after, select: 2 }
    }
    deck.select(2)
    deck.select(3, 'range')
    await deck.removeSelected()
    expect(deck.currentNo).toBe(2)
    expect(deck.current?.id).toBe('d')
    expect([...deck.selectedIds]).toEqual(['d'])
  })

  it('shows a toast instead of throwing when an op fails', async () => {
    const deck = useDeckStore()
    deck.load(snap(1, ['a']))
    onApply = async () => {
      throw new Error('Datei ist schreibgeschützt')
    }
    const result = await deck.apply({ type: 'duplicateSlide', no: 1 })
    expect(result).toBeUndefined()
    expect(useUiStore().toasts.at(-1)?.detail).toBe('Datei ist schreibgeschützt')
    expect(deck.pending).toBe(0)
  })
})
