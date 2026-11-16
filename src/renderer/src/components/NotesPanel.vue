<script setup lang="ts">
import { ChevronDown, ChevronUp, MousePointerClick } from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { keys, t } from '../i18n'
import { createDebouncedSave } from '../lib/debounce'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'
import NotesEditor from './NotesEditor.vue'

const deck = useDeckStore()
const ui = useUiStore()
const draft = ref('')
const focused = ref(false)
const editor = ref<InstanceType<typeof NotesEditor>>()
const panel = ref<HTMLElement>()

const saver = createDebouncedSave<number>((no, note) => deck.apply({ type: 'updateSlide', no, note }))

// Switching slides saves what was typed for the previous one first.
watch(() => deck.current?.id, () => {
  void saver.flush()
  draft.value = deck.current?.note ?? ''
  editor.value?.reset(draft.value)
}, { immediate: true })

// Follow outside changes unless the user is typing here.
watch(() => deck.current?.note, (note) => {
  if (!saver.pending && !focused.value)
    draft.value = note ?? ''
})

function onInput(value: string) {
  draft.value = value
  if (deck.current)
    saver.schedule(deck.currentNo, value)
}

function onBlur() {
  focused.value = false
  void saver.flush()
}

onBeforeUnmount(() => void saver.flush())

// --- height ------------------------------------------------------------------

const HEAD = 28
const MIN = 72
/** The slide above keeps at least this much room. */
const CANVAS_MIN = 220

function maxHeight(): number {
  const parent = panel.value?.parentElement
  return Math.max(MIN, (parent?.clientHeight ?? window.innerHeight) - CANVAS_MIN)
}

const clamp = (height: number) => Math.min(Math.max(height, MIN), maxHeight())
const style = computed(() => ui.notesOpen && ui.notesHeight !== undefined ? { height: `${ui.notesHeight}px` } : undefined)

let drag: { y: number, height: number } | undefined

function onGripDown(event: PointerEvent) {
  if (event.button !== 0 || !panel.value)
    return
  // Captured, so the slide's frame above does not swallow the moves.
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag = { y: event.clientY, height: panel.value.getBoundingClientRect().height }
  event.preventDefault()
}

function onGripMove(event: PointerEvent) {
  if (drag)
    ui.setNotesHeight(clamp(drag.height + drag.y - event.clientY))
}

function onGripUp() {
  drag = undefined
}

/** Tall enough to show the whole note, or back to the default when it already is. */
function fit() {
  if (!panel.value)
    return
  const wanted = clamp(HEAD + (editor.value?.contentHeight() ?? 0) + 8)
  const current = Math.round(panel.value.getBoundingClientRect().height)
  ui.setNotesHeight(Math.abs(wanted - current) < 4 ? undefined : wanted)
}

function onGripKey(event: KeyboardEvent) {
  if (!panel.value || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown'))
    return
  event.preventDefault()
  const current = panel.value.getBoundingClientRect().height
  ui.setNotesHeight(clamp(current + (event.key === 'ArrowUp' ? 24 : -24)))
}
</script>

<template>
  <section ref="panel" class="notes" :class="{ collapsed: !ui.notesOpen }" :style="style">
    <div
      v-if="ui.notesOpen" class="grip" role="separator" aria-orientation="horizontal" tabindex="0"
      :aria-label="t('notes.resize')" :data-tip="t('notes.resize')" data-testid="notes-grip"
      @pointerdown="onGripDown" @pointermove="onGripMove" @pointerup="onGripUp" @pointercancel="onGripUp"
      @dblclick="fit" @keydown="onGripKey"
    />
    <div class="head">
      <button class="toggle" :aria-expanded="ui.notesOpen" :aria-label="ui.notesOpen ? t('notes.hide') : t('notes.show')" @click="ui.notesOpen = !ui.notesOpen">
        <span class="section-title">{{ t('notes.label') }}</span>
        <ChevronDown v-if="ui.notesOpen" :size="15" />
        <ChevronUp v-else :size="15" />
      </button>
      <button
        v-if="ui.notesOpen" class="btn click" :disabled="!deck.current" data-testid="notes-insert-click"
        :data-tip="t('notes.insertClickTip', { key: keys('Ctrl+Enter') })" @mousedown.prevent @click="editor?.insertClick()"
      >
        <MousePointerClick :size="14" />
        {{ t('notes.insertClick') }}
      </button>
    </div>
    <NotesEditor
      v-if="ui.notesOpen" ref="editor" :model-value="draft" :label="t('notes.label')" :placeholder="t('notes.placeholder')"
      :click-label="t('notes.click')" @update:model-value="onInput" @focus="focused = true" @blur="onBlur"
    />
  </section>
</template>

<style scoped>
.notes {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 132px;
  flex: none;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
}
.notes.collapsed { height: auto; }
@media (max-height: 760px) {
  .notes { height: 92px; }
}
.grip {
  position: absolute;
  top: -4px;
  left: 0;
  right: 0;
  height: 8px;
  cursor: ns-resize;
  z-index: 2;
  touch-action: none;
}
.grip::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 0;
  right: 0;
  height: 2px;
  background: transparent;
}
.grip:hover::after, .grip:active::after, .grip:focus-visible::after { background: var(--accent); }
.grip:focus-visible { outline: none; }
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  flex: none;
  padding: 0 6px 0 12px;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
}
.toggle:hover { color: var(--text); }
.click {
  height: 22px;
  padding: 0 8px;
  gap: 5px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
</style>
