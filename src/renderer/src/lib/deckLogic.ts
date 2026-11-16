// Pure helpers behind the deck store, kept free of Vue and DOM so they are easy to test.
import type { AgentEvent, DeckSnapshot, SlideSnapshot } from '@shared/types'

/** Newest revision wins. Snapshots of another deck are ignored. */
export function shouldAccept(current: DeckSnapshot | undefined, next: DeckSnapshot, deckId: string | undefined): boolean {
  if (deckId && next.deckId !== deckId)
    return false
  if (!current || current.deckId !== next.deckId)
    return true
  return next.revision > current.revision
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max)
}

/**
 * Which slide stays selected after a new snapshot: an explicit `select` from the op result,
 * else the same slide by id, else the same position clamped to the new range.
 */
export function resolveSelection(slides: SlideSnapshot[], prev: { id?: string, no: number }, select?: number): number {
  if (!slides.length)
    return 0
  if (select !== undefined)
    return clamp(select, 1, slides.length)
  if (prev.id) {
    const same = slides.find(s => s.id === prev.id)
    if (same)
      return same.no
  }
  return clamp(prev.no || 1, 1, slides.length)
}

/** Multi-selection by id, dropping ids that no longer exist. Always contains the current slide. */
export function resolveMultiSelection(slides: SlideSnapshot[], selectedIds: Iterable<string>, currentId: string | undefined): Set<string> {
  const exists = new Set(slides.map(s => s.id))
  const next = new Set([...selectedIds].filter(id => exists.has(id)))
  if (currentId && !next.has(currentId)) {
    next.clear()
    next.add(currentId)
  }
  return next
}

/** Range selection by position for Shift+click / Shift+arrows. */
export function rangeIds(slides: SlideSnapshot[], fromNo: number, toNo: number): string[] {
  const [a, b] = fromNo < toNo ? [fromNo, toNo] : [toNo, fromNo]
  return slides.filter(s => s.no >= a && s.no <= b).map(s => s.id)
}

export interface ThumbCache {
  byRevision: Record<string, string>
  byId: Record<string, string>
  order: string[]
}

export function emptyThumbCache(): ThumbCache {
  return { byRevision: {}, byId: {}, order: [] }
}

const MAX_CACHED = 300

/**
 * Store a thumbnail event. The picture is remembered by revision (exact) and by slide id
 * (shown while a newer revision renders, so the list does not flicker back to placeholders).
 */
export function addThumbnail(cache: ThumbCache, slides: SlideSnapshot[], event: { no: number, revision: string, dataUrl: string }): ThumbCache {
  const byRevision = { ...cache.byRevision, [event.revision]: event.dataUrl }
  const order = [...cache.order.filter(r => r !== event.revision), event.revision]
  while (order.length > MAX_CACHED) delete byRevision[order.shift()!]
  const byId = { ...cache.byId }
  const slide = slides.find(s => s.revision === event.revision) ?? slides[event.no - 1]
  // An image for an older revision must not replace the image of the slide's current revision.
  if (slide && (slide.revision === event.revision || !byRevision[slide.revision]))
    byId[slide.id] = event.dataUrl
  return { byRevision, byId, order }
}

export function thumbnailFor(cache: ThumbCache, slide: SlideSnapshot): { src?: string, stale: boolean } {
  const exact = cache.byRevision[slide.revision]
  if (exact)
    return { src: exact, stale: false }
  const old = cache.byId[slide.id]
  return { src: old, stale: Boolean(old) }
}

export interface AgentItem {
  kind: 'user' | 'assistant' | 'tool' | 'error' | 'status'
  text: string
  detail?: string
}

/** Fold one agent event into the chat. Consecutive text events extend the same message (streaming). */
export function foldAgentEvent(items: AgentItem[], event: AgentEvent): { items: AgentItem[], running: boolean | undefined } {
  const next = [...items]
  const last = next.at(-1)
  switch (event.type) {
    case 'started':
      next.push({ kind: 'user', text: event.prompt })
      return { items: next, running: true }
    case 'text':
      if (last?.kind === 'assistant')
        next[next.length - 1] = { ...last, text: last.text + event.text }
      else
        next.push({ kind: 'assistant', text: event.text })
      return { items: next, running: undefined }
    case 'tool':
      next.push({ kind: 'tool', text: event.name, detail: event.detail })
      return { items: next, running: undefined }
    case 'error':
      next.push({ kind: 'error', text: event.message })
      return { items: next, running: undefined }
    case 'done':
      next.push({ kind: 'status', text: event.ok ? 'done' : 'failed' })
      return { items: next, running: false }
  }
}

/** Slide numbers after moving the slides listed in `from` (1-based) by a drag from oldIndex to newIndex (0-based). */
export function moveTarget(oldIndex: number, newIndex: number): { from: number, to: number } | undefined {
  if (oldIndex === newIndex || oldIndex < 0 || newIndex < 0)
    return undefined
  return { from: oldIndex + 1, to: newIndex + 1 }
}
