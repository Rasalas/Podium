<script setup lang="ts">
import type { LayoutInfo } from '@shared/types'
import { computed } from 'vue'
import { t } from '../i18n'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'
import LayoutSketch from './LayoutSketch.vue'
import Modal from './Modal.vue'

const deck = useDeckStore()
const ui = useUiStore()
const mode = computed(() => ui.layoutPicker)
const CATEGORIES: LayoutInfo['category'][] = ['title', 'content', 'media', 'emphasis', 'special']

const groups = computed(() => CATEGORIES
  .map(category => ({ category, layouts: deck.layouts.filter(l => !l.hidden && l.category === category) }))
  .filter(g => g.layouts.length))

function choose(layout: LayoutInfo) {
  const m = mode.value
  ui.layoutPicker = null
  if (m === 'new')
    void deck.newSlide(layout.name)
  else if (deck.current && layout.name !== deck.current.layout)
    void deck.apply({ type: 'setLayout', no: deck.currentNo, layout: layout.name })
      .then(() => fillWithStarter(layout))
}

/**
 * A slide that is empty or still shows the placeholder text of its old layout takes the
 * placeholder of the new one. Otherwise a blank two-column slide has nothing to click on.
 */
function fillWithStarter(layout: LayoutInfo) {
  const slide = deck.current
  if (!slide || !layout.starter)
    return
  const content = slide.content.trim()
  const untouched = content === '' || deck.layouts.some(l => l.starter.trim() === content)
  if (untouched && content !== layout.starter.trim())
    void deck.apply({ type: 'updateSlide', no: slide.no, content: layout.starter })
}

function onGridKey(e: KeyboardEvent) {
  const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[e.key]
  if (!delta)
    return
  const tiles = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.tile')]
  const i = tiles.indexOf(document.activeElement as HTMLElement)
  if (i < 0)
    return
  e.preventDefault()
  tiles[Math.min(Math.max(i + delta, 0), tiles.length - 1)]?.focus()
}
</script>

<template>
  <Modal :title="mode === 'new' ? t('layoutPicker.titleNew') : t('layoutPicker.title')" :width="720" @close="ui.layoutPicker = null">
    <div class="groups" @keydown="onGridKey">
      <section v-for="group in groups" :key="group.category" class="group">
        <h3 class="section-title">{{ t(`layoutPicker.categories.${group.category}`) }}</h3>
        <div class="grid">
          <button
            v-for="layout in group.layouts" :key="layout.name" class="tile"
            :class="{ current: mode === 'change' && layout.name === deck.current?.layout }"
            :aria-current="mode === 'change' && layout.name === deck.current?.layout"
            :title="layout.description || undefined" @click="choose(layout)"
          >
            <LayoutSketch :sketch="layout.sketch" />
            <span class="name">{{ layout.label }}</span>
            <span v-if="mode === 'change' && layout.name === deck.current?.layout" class="current-tag">{{ t('layoutPicker.current') }}</span>
          </button>
        </div>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.groups { display: flex; flex-direction: column; gap: 18px; }
.group h3 { margin-bottom: 8px; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: none;
  text-align: center;
}
.tile :deep(.sketch) { border: 1px solid var(--border); box-shadow: var(--shadow-sm); }
.tile:hover { background: var(--bg-hover); }
.tile:hover :deep(.sketch) { border-color: var(--accent); }
.tile.current { background: var(--accent-soft); border-color: var(--accent); }
.name { font-size: var(--fs); font-weight: 500; }
.current-tag { margin-top: -4px; font-size: var(--fs-xs); color: var(--accent-ink); font-weight: 600; }
@media (max-width: 760px) { .grid { grid-template-columns: repeat(3, 1fr); } }
</style>
