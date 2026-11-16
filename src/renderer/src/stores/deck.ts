import type { AgentEvent, AgentInfo, BlockKind, DeckOp, DeckSnapshot, LayoutInfo, OpResult, PresentationState, ServerStatus, SlideCheck, ThumbnailEvent } from '@shared/types'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import type { AgentItem, ThumbCache } from '../lib/deckLogic'
import { addThumbnail, emptyThumbCache, foldAgentEvent, rangeIds, resolveMultiSelection, resolveSelection, shouldAccept } from '../lib/deckLogic'
import { useUiStore } from './ui'

export const useDeckStore = defineStore('deck', () => {
  const ui = useUiStore()
  const snapshot = shallowRef<DeckSnapshot>()
  const server = ref<ServerStatus>()
  const layouts = ref<LayoutInfo[]>([])
  const currentNo = ref(0)
  const selectedIds = ref(new Set<string>())
  /** Anchor for Shift range selection. */
  const anchorNo = ref(0)
  const thumbs = shallowRef<ThumbCache>(emptyThumbCache())
  const checks = ref<SlideCheck[]>()
  const checkRunning = ref(false)
  const presentation = ref<PresentationState>({ active: false, displays: [] })
  const agentItems = ref<AgentItem[]>([])
  const agentRunning = ref(false)
  const agentInfo = ref<AgentInfo>()
  /** A block on the canvas is in edit mode. */
  const canvasEditing = ref(false)
  const formatState = ref({ bold: false, italic: false, code: false, link: false })
  /** Ops in flight, so the UI can show it is saving. */
  const pending = ref(0)

  const deckId = computed(() => snapshot.value?.deckId)
  const slides = computed(() => snapshot.value?.slides ?? [])
  const current = computed(() => slides.value[currentNo.value - 1])
  const currentLayout = computed(() => layouts.value.find(l => l.name === current.value?.layout))
  const serverReady = computed(() => server.value?.state === 'ready' && Boolean(server.value.url))
  const problemNos = computed(() => new Set((checks.value ?? []).filter(c => c.overflow || c.messages.length).map(c => c.no)))

  function reset() {
    snapshot.value = undefined
    server.value = undefined
    layouts.value = []
    currentNo.value = 0
    selectedIds.value = new Set()
    thumbs.value = emptyThumbCache()
    checks.value = undefined
    agentItems.value = []
    agentRunning.value = false
    agentInfo.value = undefined
    canvasEditing.value = false
  }

  function load(next: DeckSnapshot) {
    reset()
    snapshot.value = next
    currentNo.value = next.slides.length ? 1 : 0
    selectedIds.value = new Set(next.slides[0] ? [next.slides[0].id] : [])
    anchorNo.value = currentNo.value
    void loadLayouts()
  }

  async function loadLayouts() {
    const id = deckId.value
    if (!id)
      return
    const list = await ui.attempt(() => api().getLayouts(id))
    if (list && id === deckId.value)
      layouts.value = list
  }

  /** Take a snapshot from an op result or event. Returns true when it was newer. */
  function accept(next: DeckSnapshot, select?: number): boolean {
    if (!shouldAccept(snapshot.value, next, deckId.value)) {
      // The 'deck:changed' event usually lands before the op's own reply. The reply still
      // carries the slide to select, so apply that part to the snapshot we already have.
      if (select !== undefined && snapshot.value && next.deckId === snapshot.value.deckId && next.revision === snapshot.value.revision) {
        currentNo.value = resolveSelection(snapshot.value.slides, { no: currentNo.value }, select)
        const id = snapshot.value.slides[currentNo.value - 1]?.id
        selectedIds.value = new Set(id ? [id] : [])
        anchorNo.value = currentNo.value
      }
      return false
    }
    const prev = snapshot.value
    const prevSlide = current.value
    snapshot.value = next
    currentNo.value = resolveSelection(next.slides, { id: prevSlide?.id, no: currentNo.value }, select)
    const currentId = next.slides[currentNo.value - 1]?.id
    selectedIds.value = select !== undefined
      ? new Set(currentId ? [currentId] : [])
      : resolveMultiSelection(next.slides, selectedIds.value, currentId)
    if (next.cause === 'external') {
      ui.toast({
        kind: 'info',
        key: 'external',
        message: t('editor.externalChange'),
        action: next.canUndo ? { label: t('common.undo'), run: () => void undo() } : undefined,
      })
    }
    if (prev && prev.theme !== next.theme)
      void loadLayouts()
    return true
  }

  function acceptServer(status: ServerStatus) {
    if (status.deckId === deckId.value)
      server.value = status
  }

  function acceptThumbnail(event: ThumbnailEvent) {
    if (event.deckId === deckId.value)
      thumbs.value = addThumbnail(thumbs.value, slides.value, event)
  }

  function acceptAgent(event: AgentEvent) {
    if (event.deckId !== deckId.value)
      return
    const folded = foldAgentEvent(agentItems.value, event)
    agentItems.value = folded.items
    if (folded.running !== undefined)
      agentRunning.value = folded.running
  }

  async function run(call: () => Promise<OpResult>, context?: string): Promise<OpResult | undefined> {
    pending.value++
    try {
      const result = await ui.attempt(call, context)
      if (result)
        accept(result.snapshot, result.select)
      return result
    }
    finally {
      pending.value--
    }
  }

  function apply(op: DeckOp, context?: string) {
    const id = deckId.value
    if (!id)
      return Promise.resolve(undefined)
    return run(() => api().applyOp(id, op), context)
  }

  function undo() {
    const id = deckId.value
    if (!id || !snapshot.value?.canUndo)
      return Promise.resolve(undefined)
    return run(() => api().undo(id))
  }

  function redo() {
    const id = deckId.value
    if (!id || !snapshot.value?.canRedo)
      return Promise.resolve(undefined)
    return run(() => api().redo(id))
  }

  function select(no: number, mode: 'single' | 'toggle' | 'range' = 'single') {
    const slide = slides.value[no - 1]
    if (!slide)
      return
    if (mode === 'toggle') {
      const next = new Set(selectedIds.value)
      if (next.has(slide.id) && next.size > 1) {
        next.delete(slide.id)
        if (current.value?.id === slide.id) {
          const other = slides.value.find(s => next.has(s.id))
          if (other)
            currentNo.value = other.no
        }
      }
      else {
        next.add(slide.id)
        currentNo.value = no
      }
      selectedIds.value = next
      anchorNo.value = no
      return
    }
    if (mode === 'range') {
      selectedIds.value = new Set(rangeIds(slides.value, anchorNo.value || currentNo.value, no))
      currentNo.value = no
      return
    }
    currentNo.value = no
    anchorNo.value = no
    selectedIds.value = new Set([slide.id])
  }

  const selectedNos = computed(() => slides.value.filter(s => selectedIds.value.has(s.id)).map(s => s.no))

  function newSlide(layoutName?: string) {
    // A new slide always starts with placeholder text, so there is something to click on.
    const layout = layouts.value.find(l => l.name === (layoutName ?? 'default'))
    return apply({
      type: 'insertSlide',
      after: currentNo.value,
      layout: layoutName,
      content: layout?.starter,
    })
  }

  function duplicate() {
    if (!current.value)
      return
    return apply({ type: 'duplicateSlide', no: currentNo.value })
  }

  async function removeSelected() {
    const nos = selectedNos.value.length ? selectedNos.value : current.value ? [currentNo.value] : []
    if (!nos.length)
      return
    const result = await apply({ type: 'removeSlides', nos })
    if (result) {
      ui.toast({
        kind: 'info',
        message: nos.length === 1 ? t('slides.deleted') : t('slides.deletedN', { n: nos.length }),
        action: { label: t('common.undo'), run: () => void undo() },
        timeout: 7000,
      })
    }
  }

  function move(from: number, to: number) {
    return apply({ type: 'moveSlide', from, to })
  }

  function insertBlock(kind: BlockKind, src?: string) {
    if (!current.value)
      return Promise.resolve(undefined)
    return apply({ type: 'insertBlock', no: currentNo.value, kind, src })
  }

  async function runCheck() {
    const id = deckId.value
    if (!id || checkRunning.value)
      return
    checkRunning.value = true
    try {
      const result = await ui.attempt(() => api().checkDeck(id))
      if (result)
        checks.value = result
    }
    finally {
      checkRunning.value = false
    }
  }

  return {
    snapshot,
    server,
    layouts,
    currentNo,
    selectedIds,
    selectedNos,
    thumbs,
    checks,
    checkRunning,
    problemNos,
    presentation,
    agentItems,
    agentRunning,
    agentInfo,
    canvasEditing,
    formatState,
    pending,
    deckId,
    slides,
    current,
    currentLayout,
    serverReady,
    reset,
    load,
    loadLayouts,
    accept,
    acceptServer,
    acceptThumbnail,
    acceptAgent,
    apply,
    undo,
    redo,
    select,
    newSlide,
    duplicate,
    removeSelected,
    move,
    insertBlock,
    runCheck,
  }
})
