// Host side of the canvas protocol (src/shared/bridge.ts). DOM-free apart from postMessage on
// the frame's window, so the routing can be tested without a browser.
import type { BridgeMode, FrameMessage, HostMessage, Rect } from '@shared/bridge'
import type { BlockRef, DeckOp, Locale, OpResult } from '@shared/types'
import { BRIDGE_TAG } from '@shared/bridge'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type HostPayload = DistributiveOmit<HostMessage, 'tag'>

export interface FrameTarget {
  postMessage: (message: unknown, targetOrigin: string) => void
}

export interface CanvasDeps {
  apply: (op: DeckOp) => Promise<OpResult | undefined>
  locale: () => Locale
  onReady?: (no: number, total: number) => void
  onNavigated?: (no: number) => void
  onEditing?: (editing: boolean) => void
  onFormatState?: (state: { bold: boolean, italic: boolean, code: boolean, link: boolean }) => void
  onCodeClicked?: (what: string, rect: Rect) => void
  onBackgroundClicked?: () => void
  onShortcut?: (key: { key: string, ctrl: boolean, shift: boolean, alt: boolean }) => void
}

export class BridgeHost {
  private frame: FrameTarget | null = null
  private origin = '*'
  /** Slide the frame last reported, to avoid redundant goto messages. */
  frameNo = 0
  ready = false

  constructor(private deps: CanvasDeps, private mode: BridgeMode = 'edit') {}

  /** Call on every iframe load (also after reloads): the page forgets the hello on reload. */
  attach(frame: FrameTarget | null, url?: string) {
    this.frame = frame
    this.ready = false
    this.frameNo = 0
    try {
      this.origin = url ? new URL(url).origin : '*'
    }
    catch {
      this.origin = '*'
    }
    this.send({ type: 'hello', mode: this.mode, locale: this.deps.locale() })
  }

  detach() {
    this.frame = null
    this.ready = false
  }

  send(message: HostPayload) {
    this.frame?.postMessage({ tag: BRIDGE_TAG, ...message }, this.origin)
  }

  goto(no: number) {
    if (no > 0 && no !== this.frameNo) {
      this.frameNo = no
      this.send({ type: 'goto', no })
    }
  }

  focusBlock(block: BlockRef, selectAll = false) {
    this.send({ type: 'focusBlock', block, selectAll })
  }

  /** Returns true when the message came from our frame and carried the bridge tag. */
  handle(event: { source: unknown, data: unknown }): boolean {
    if (!this.frame || event.source !== this.frame)
      return false
    const data = event.data as FrameMessage | undefined
    if (!data || typeof data !== 'object' || data.tag !== BRIDGE_TAG)
      return false
    void this.dispatch(data)
    return true
  }

  private async dispatch(msg: FrameMessage) {
    const d = this.deps
    switch (msg.type) {
      case 'ready':
        this.ready = true
        this.frameNo = msg.no
        d.onReady?.(msg.no, msg.total)
        break
      case 'navigated':
        this.frameNo = msg.no
        d.onNavigated?.(msg.no)
        break
      case 'editStarted':
        d.onEditing?.(true)
        break
      case 'editCancelled':
      case 'selectionCleared':
        d.onEditing?.(false)
        break
      case 'blockSelected':
        break
      case 'formatState':
        d.onFormatState?.({ bold: msg.bold, italic: msg.italic, code: msg.code, link: msg.link })
        break
      case 'blockCommit':
        d.onEditing?.(false)
        await d.apply({ type: 'editBlock', no: msg.no, block: msg.block, markdown: msg.markdown })
        break
      case 'textCommit':
        d.onEditing?.(false)
        await d.apply({ type: 'editText', no: msg.no, edit: msg.edit })
        break
      case 'listItemSplit': {
        const result = await d.apply({ type: 'splitListItem', no: msg.no, block: msg.block, markdown: msg.markdown, newItem: msg.rest })
        if (result?.focusBlock)
          this.focusBlock(result.focusBlock)
        else
          d.onEditing?.(false)
        break
      }
      case 'blockRemove':
        d.onEditing?.(false)
        await d.apply({ type: 'removeBlock', no: msg.no, block: msg.block })
        break
      case 'codeClicked':
        d.onCodeClicked?.(msg.what, msg.rect)
        break
      case 'backgroundClicked':
        d.onEditing?.(false)
        d.onBackgroundClicked?.()
        break
      case 'shortcut':
        d.onShortcut?.({ key: msg.key, ctrl: msg.ctrl, shift: msg.shift, alt: msg.alt })
        break
      case 'measured':
        break
    }
  }
}
