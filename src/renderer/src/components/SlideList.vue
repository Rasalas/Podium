<script setup lang="ts">
import type { SlideSnapshot } from '@shared/types'
import { CodeXml, Copy, Plus, Trash2, TriangleAlert } from '@lucide/vue'
import Sortable from 'sortablejs'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { keys, t } from '../i18n'
import { thumbnailFor } from '../lib/deckLogic'
import { useDeckStore } from '../stores/deck'

const deck = useDeckStore()
const list = ref<HTMLElement>()
const menu = ref<{ x: number, y: number }>()
const menuEl = ref<HTMLElement>()
let sortable: Sortable | undefined

const aspect = computed(() => deck.snapshot ? `${deck.snapshot.canvas.width} / ${deck.snapshot.canvas.height}` : '16 / 9')

function thumb(slide: SlideSnapshot) {
  return thumbnailFor(deck.thumbs, slide)
}

function onClick(e: MouseEvent, slide: SlideSnapshot) {
  if (e.shiftKey)
    deck.select(slide.no, 'range')
  else if (e.ctrlKey || e.metaKey)
    deck.select(slide.no, 'toggle')
  else
    deck.select(slide.no)
}

function focusCurrent() {
  void nextTick(() => {
    const el = list.value?.querySelector<HTMLElement>(`[data-no="${deck.currentNo}"]`)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(e: KeyboardEvent) {
  const n = deck.slides.length
  if (!n)
    return
  const go = (no: number) => {
    e.preventDefault()
    deck.select(Math.min(Math.max(no, 1), n), e.shiftKey ? 'range' : 'single')
    focusCurrent()
  }
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return go(deck.currentNo + 1)
    case 'ArrowUp':
    case 'ArrowLeft':
      return go(deck.currentNo - 1)
    case 'Home':
      return go(1)
    case 'End':
      return go(n)
    case 'Delete':
    case 'Backspace':
      e.preventDefault()
      void deck.removeSelected().then(focusCurrent)
      return
    case 'ContextMenu':
      e.preventDefault()
      openMenuAtCurrent()
      return
    case 'F10':
      if (e.shiftKey) {
        e.preventDefault()
        openMenuAtCurrent()
      }
      return
    case 'a':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        deck.select(1)
        deck.select(n, 'range')
      }
  }
}

function openMenu(e: MouseEvent, slide: SlideSnapshot) {
  e.preventDefault()
  if (!deck.selectedIds.has(slide.id))
    deck.select(slide.no)
  showMenu(e.clientX, e.clientY)
}

function openMenuAtCurrent() {
  const el = list.value?.querySelector<HTMLElement>(`[data-no="${deck.currentNo}"]`)
  const r = el?.getBoundingClientRect()
  if (r)
    showMenu(r.left + 24, r.top + r.height / 2)
}

async function showMenu(x: number, y: number) {
  menu.value = { x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 140) }
  await nextTick()
  menuEl.value?.querySelector<HTMLElement>('.menu-item')?.focus()
  document.addEventListener('mousedown', closeMenuOutside, true)
}
function closeMenu(refocus = true) {
  menu.value = undefined
  document.removeEventListener('mousedown', closeMenuOutside, true)
  if (refocus)
    focusCurrent()
}
function closeMenuOutside(e: MouseEvent) {
  if (!menuEl.value?.contains(e.target as Node))
    closeMenu(false)
}
function onMenuKey(e: KeyboardEvent) {
  const items = [...(menuEl.value?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)') ?? [])]
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    closeMenu()
  }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
}
function menuAction(action: () => unknown) {
  closeMenu()
  void action()
}

const selectionCount = computed(() => deck.selectedNos.length)

onMounted(() => {
  if (!list.value)
    return
  sortable = Sortable.create(list.value, {
    animation: 150,
    delay: 0,
    ghostClass: 'drag-ghost',
    chosenClass: 'drag-chosen',
    onEnd(evt) {
      const { item, from, oldIndex, newIndex } = evt
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex)
        return
      // Put the DOM back: Vue renders the new order from the snapshot the backend returns.
      from.removeChild(item)
      from.insertBefore(item, from.children[oldIndex] ?? null)
      void deck.move(oldIndex + 1, newIndex + 1).then(focusCurrent)
    },
  })
})
onBeforeUnmount(() => {
  sortable?.destroy()
  document.removeEventListener('mousedown', closeMenuOutside, true)
})

watch(() => deck.currentNo, () => {
  void nextTick(() => list.value?.querySelector(`[data-no="${deck.currentNo}"]`)?.scrollIntoView({ block: 'nearest' }))
})
</script>

<template>
  <nav class="slide-list" :aria-label="t('slides.label')">
    <ol
      ref="list" class="items" role="listbox" aria-multiselectable="true" :aria-label="t('slides.label')"
      @keydown="onKeydown"
    >
      <li
        v-for="slide in deck.slides" :key="slide.id" class="item" role="option"
        :class="{ current: slide.no === deck.currentNo, selected: deck.selectedIds.has(slide.id) }"
        :aria-selected="deck.selectedIds.has(slide.id)" :data-no="slide.no"
        :tabindex="slide.no === deck.currentNo ? 0 : -1"
        :aria-label="`${t('slides.slideN', { n: slide.no })}: ${slide.title || t('slides.untitled')}${slide.editability === 'code' ? `, ${t('slides.containsCode')}` : ''}`"
        @click="onClick($event, slide)" @contextmenu="openMenu($event, slide)"
      >
        <span class="no">{{ slide.no }}</span>
        <div class="thumb" :style="{ aspectRatio: aspect }">
          <img v-if="thumb(slide).src" :src="thumb(slide).src" alt="" draggable="false" :class="{ stale: thumb(slide).stale }">
          <span v-else class="placeholder">{{ slide.title || t('slides.untitled') }}</span>
          <span
            v-if="slide.editability === 'code'" class="badge code" :data-tip="t('slides.containsCodeHint')"
          >
            <CodeXml :size="12" /> {{ t('slides.containsCode') }}
          </span>
          <span v-if="deck.problemNos.has(slide.no)" class="badge warn" :data-tip="t('slides.overflow')">
            <TriangleAlert :size="12" /><span class="visually-hidden">{{ t('slides.overflow') }}</span>
          </span>
        </div>
      </li>
    </ol>

    <div
      v-if="menu" ref="menuEl" class="menu context" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @keydown="onMenuKey"
    >
      <button class="menu-item" role="menuitem" @click="menuAction(() => deck.newSlide())">
        <Plus :size="15" /> {{ t('slides.newAfter') }} <span class="menu-hint">{{ keys('Ctrl+M') }}</span>
      </button>
      <button class="menu-item" role="menuitem" @click="menuAction(() => deck.duplicate())">
        <Copy :size="15" /> {{ t('slides.duplicate') }} <span class="menu-hint">{{ keys('Ctrl+D') }}</span>
      </button>
      <div class="menu-sep" />
      <button
        class="menu-item danger" role="menuitem" :disabled="selectionCount >= deck.slides.length"
        @click="menuAction(() => deck.removeSelected())"
      >
        <Trash2 :size="15" /> {{ selectionCount > 1 ? t('slides.deleteN', { n: selectionCount }) : t('slides.delete') }}
        <span class="menu-hint">{{ keys('Del') }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.slide-list {
  width: var(--list-w, 196px);
  flex: none;
  overflow-y: auto;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
}
.items { margin: 0; padding: 10px 10px 40px 4px; list-style: none; }
.item {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 5px 4px;
  border-radius: var(--radius);
}
.item:focus-visible { box-shadow: none; }
.item:focus-visible .thumb { box-shadow: var(--focus-ring); }
.no {
  width: 20px;
  flex: none;
  padding-top: 2px;
  text-align: right;
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
}
.current .no { color: var(--accent-ink); font-weight: 700; }
.thumb {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
}
.item:hover .thumb { border-color: var(--border-strong); }
.selected .thumb { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.current .thumb { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
.thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.thumb img.stale { opacity: 0.85; }
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 6px;
  font-size: var(--fs-xs);
  font-weight: 600;
  text-align: center;
  color: var(--text-muted);
  overflow: hidden;
}
.badge {
  position: absolute;
  bottom: 3px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  box-shadow: var(--shadow-sm);
}
.badge.code { left: 3px; background: var(--bg-surface); color: var(--text-muted); border: 1px solid var(--border); }
.badge.warn { right: 3px; background: var(--warn-soft); color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); }
.drag-ghost .thumb { opacity: 0.35; }
.drag-chosen .thumb { box-shadow: var(--shadow); }
.context { position: fixed; }
.menu-item.danger { color: var(--danger); }

@media (max-width: 1100px) {
  .badge.code { font-size: 0; gap: 0; padding: 2px; }
}
</style>
