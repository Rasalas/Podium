import type { DeckOp, OpResult } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { BridgeHost } from '../../../src/renderer/src/lib/bridgeHost'

const TAG = 'podium-bridge'
const block = { tag: 'li', text: 'Eins', occurrence: 0, tagIndex: 0 }

function setup(result?: Partial<OpResult>) {
  const posted: unknown[] = []
  const frame = { postMessage: (msg: unknown) => posted.push(msg) }
  const ops: DeckOp[] = []
  const deps = {
    apply: vi.fn(async (op: DeckOp) => {
      ops.push(op)
      return result as OpResult | undefined
    }),
    locale: () => 'de' as const,
    onEditing: vi.fn(),
    onShortcut: vi.fn(),
    onCodeClicked: vi.fn(),
    onNavigated: vi.fn(),
  }
  const host = new BridgeHost(deps)
  host.attach(frame, 'http://localhost:3030')
  return { host, frame, posted, ops, deps }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('BridgeHost', () => {
  it('says hello in edit mode on attach', () => {
    const { posted } = setup()
    expect(posted[0]).toEqual({ tag: TAG, type: 'hello', mode: 'edit', locale: 'de' })
  })

  it('ignores messages from other windows or without the tag', () => {
    const { host, frame, deps } = setup()
    expect(host.handle({ source: {}, data: { tag: TAG, type: 'navigated', no: 2 } })).toBe(false)
    expect(host.handle({ source: frame, data: { tag: 'other', type: 'navigated', no: 2 } })).toBe(false)
    expect(host.handle({ source: frame, data: null })).toBe(false)
    expect(deps.onNavigated).not.toHaveBeenCalled()
    expect(host.handle({ source: frame, data: { tag: TAG, type: 'navigated', no: 2 } })).toBe(true)
    expect(deps.onNavigated).toHaveBeenCalledWith(2)
  })

  it('turns a commit into an editBlock op', async () => {
    const { host, frame, ops } = setup()
    host.handle({ source: frame, data: { tag: TAG, type: 'blockCommit', no: 3, block, markdown: '**Eins**' } })
    await flush()
    expect(ops).toEqual([{ type: 'editBlock', no: 3, block, markdown: '**Eins**' }])
  })

  it('splits a list item and focuses the block the backend returns', async () => {
    const next = { tag: 'li', text: 'Zwei', occurrence: 0, tagIndex: 1 }
    const { host, frame, ops, posted } = setup({ focusBlock: next })
    host.handle({ source: frame, data: { tag: TAG, type: 'listItemSplit', no: 1, block, markdown: 'Eins', rest: 'Zwei' } })
    await flush()
    expect(ops[0]).toEqual({ type: 'splitListItem', no: 1, block, markdown: 'Eins', newItem: 'Zwei' })
    expect(posted.at(-1)).toEqual({ tag: TAG, type: 'focusBlock', block: next, selectAll: false })
  })

  it('removes empty blocks and forwards shortcuts', async () => {
    const { host, frame, ops, deps } = setup()
    host.handle({ source: frame, data: { tag: TAG, type: 'blockRemove', no: 2, block } })
    host.handle({ source: frame, data: { tag: TAG, type: 'shortcut', key: 'z', ctrl: true, shift: false, alt: false } })
    await flush()
    expect(ops).toEqual([{ type: 'removeBlock', no: 2, block }])
    expect(deps.onShortcut).toHaveBeenCalledWith({ key: 'z', ctrl: true, shift: false, alt: false })
  })

  it('sends goto only when the slide differs from what the frame shows', () => {
    const { host, frame, posted } = setup()
    host.handle({ source: frame, data: { tag: TAG, type: 'ready', no: 1, total: 5 } })
    const before = posted.length
    host.goto(1)
    expect(posted.length).toBe(before)
    host.goto(4)
    expect(posted.at(-1)).toEqual({ tag: TAG, type: 'goto', no: 4 })
  })
})
