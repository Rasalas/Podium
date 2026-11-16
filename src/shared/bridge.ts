/**
 * Message protocol between Podium and the Slidev page it embeds.
 *
 * The launcher injects `launcher/bridge-client.js` into every Slidev page it serves.
 * The script stays passive until a host says hello, so a deck opened in a normal
 * browser behaves like plain Slidev.
 *
 * Two transports use the same messages:
 *  - iframe: `postMessage` between the renderer (host) and the Slidev page (frame)
 *  - hidden windows (thumbnails, checks): `window.__podium__` called via executeJavaScript
 *
 * Only the integrator edits this file.
 */
import type { BlockRef, TextEdit } from './types'

export const BRIDGE_TAG = 'podium-bridge'

export type BridgeMode =
  /** Canvas of the editor: blocks are selectable and editable, slide navigation by click/keys is off, all clicks revealed. */
  | 'edit'
  /** Plain preview: Slidev behaves normally, UI chrome hidden. */
  | 'view'
  /** Thumbnails and checks: UI chrome hidden, all clicks revealed, no interaction, no animations. */
  | 'capture'

export interface Rect { x: number, y: number, width: number, height: number }

export interface OverflowReport {
  no: number
  overflowX: number
  overflowY: number
}

/** Host → frame */
export type HostMessage =
  | { tag: typeof BRIDGE_TAG, type: 'hello', mode: BridgeMode, locale: 'de' | 'en' }
  | { tag: typeof BRIDGE_TAG, type: 'setMode', mode: BridgeMode }
  /** `clicks` sets the click step (v-click) to show, default: mode-dependent (all revealed in edit/capture, 0 in view). */
  | { tag: typeof BRIDGE_TAG, type: 'goto', no: number, clicks?: number }
  /** Put the caret into this block and start editing (used after inserting a block). */
  | { tag: typeof BRIDGE_TAG, type: 'focusBlock', block: BlockRef, selectAll?: boolean }
  /** Apply inline formatting to the current selection of the block being edited. */
  | { tag: typeof BRIDGE_TAG, type: 'format', command: 'bold' | 'italic' | 'code' | 'link' | 'clear', value?: string }
  /** Leave the block being edited. `commit: false` discards the change. */
  | { tag: typeof BRIDGE_TAG, type: 'endEdit', commit: boolean }
  | { tag: typeof BRIDGE_TAG, type: 'clearSelection' }
  | { tag: typeof BRIDGE_TAG, type: 'measure', requestId: string }

/** Frame → host */
export type FrameMessage =
  | { tag: typeof BRIDGE_TAG, type: 'ready', no: number, total: number }
  | { tag: typeof BRIDGE_TAG, type: 'navigated', no: number }
  /** A markdown block was clicked. `editable: false` means it contains inline HTML/components. */
  | { tag: typeof BRIDGE_TAG, type: 'blockSelected', no: number, block: BlockRef, editable: boolean, rect: Rect }
  | { tag: typeof BRIDGE_TAG, type: 'selectionCleared' }
  | { tag: typeof BRIDGE_TAG, type: 'editStarted', no: number, block: BlockRef, rect: Rect }
  /** Which inline formats are active at the caret, for toolbar state. */
  | { tag: typeof BRIDGE_TAG, type: 'formatState', bold: boolean, italic: boolean, code: boolean, link: boolean }
  /** The user finished editing a block. `markdown` is the new inline markdown. */
  | { tag: typeof BRIDGE_TAG, type: 'blockCommit', no: number, block: BlockRef, markdown: string }
  /** The user changed text outside the editable markdown blocks (HTML, a heading with an icon, text from the slide's settings). */
  | { tag: typeof BRIDGE_TAG, type: 'textCommit', no: number, edit: TextEdit }
  /** Enter inside a list item: commit `markdown` and open a new item with `rest` (text after the caret). */
  | { tag: typeof BRIDGE_TAG, type: 'listItemSplit', no: number, block: BlockRef, markdown: string, rest: string }
  /** Backspace/Delete on an empty block. */
  | { tag: typeof BRIDGE_TAG, type: 'blockRemove', no: number, block: BlockRef }
  | { tag: typeof BRIDGE_TAG, type: 'editCancelled' }
  /** Click on slide content that is not an editable markdown block (HTML, Vue component, code, image). */
  | { tag: typeof BRIDGE_TAG, type: 'codeClicked', no: number, what: 'html' | 'component' | 'code' | 'image' | 'table' | 'other', rect: Rect }
  /** Click on the empty slide background. */
  | { tag: typeof BRIDGE_TAG, type: 'backgroundClicked', no: number }
  /** Keyboard shortcut pressed while focus is in the frame and no block is being edited. */
  | { tag: typeof BRIDGE_TAG, type: 'shortcut', key: string, ctrl: boolean, shift: boolean, alt: boolean }
  | { tag: typeof BRIDGE_TAG, type: 'measured', requestId: string, report: OverflowReport }

/** `window.__podium__` inside the Slidev page, for hidden windows driven by the main process. */
export interface PodiumPageApi {
  /** Resolves once Slidev has mounted and the first slide is rendered. */
  ready: () => Promise<{ total: number }>
  /**
   * Navigate and resolve when the slide is rendered and fonts/images settled.
   * Edit/capture mode reveal all clicks. In view mode `clicks` picks the click step, default 0.
   */
  goto: (no: number, clicks?: number) => Promise<void>
  measure: () => OverflowReport
  setMode: (mode: BridgeMode) => void
}

/** Attribute the launcher's markdown rule puts on editable markdown blocks. Value: 'heading' | 'paragraph' | 'listitem'. */
export const ATTR_BLOCK = 'data-pd-block'
/** Present ("1") when the block's inline content is plain enough to edit in place. */
export const ATTR_EDITABLE = 'data-pd-editable'
