<script setup lang="ts">
import { CircleCheck, LoaderCircle, RefreshCw, TriangleAlert, X } from '@lucide/vue'
import { computed } from 'vue'
import { t } from '../i18n'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'

const deck = useDeckStore()
const ui = useUiStore()
const problems = computed(() => (deck.checks ?? []).filter(c => c.overflow || c.messages.length))

function titleOf(no: number) {
  return deck.slides[no - 1]?.title || t('slides.untitled')
}
</script>

<template>
  <section class="check" :aria-label="t('check.title')" @keydown.escape="ui.checkOpen = false">
    <header class="head">
      <h2>{{ t('check.title') }}</h2>
      <button class="btn icon small" :aria-label="t('editor.check')" :data-tip="t('check.again')" :disabled="deck.checkRunning" @click="deck.runCheck()">
        <RefreshCw :size="14" />
      </button>
      <button class="btn icon small" :aria-label="t('common.close')" @click="ui.checkOpen = false">
        <X :size="15" />
      </button>
    </header>
    <div v-if="deck.checkRunning" class="state" role="status">
      <LoaderCircle :size="16" class="spin" /> {{ t('check.running') }}
    </div>
    <div v-else-if="deck.checks && !problems.length" class="state ok" role="status">
      <CircleCheck :size="16" /> {{ t('check.ok') }}
    </div>
    <template v-else-if="problems.length">
      <p class="summary" role="status">{{ problems.length === 1 ? t('check.problem1') : t('check.problems', { n: problems.length }) }}</p>
      <ul class="list">
        <li v-for="p in problems" :key="p.no">
          <button class="item" :class="{ current: p.no === deck.currentNo }" @click="deck.select(p.no)">
            <TriangleAlert :size="15" class="warn" />
            <span class="text">
              <span class="title">{{ t('slides.slideN', { n: p.no }) }}: {{ titleOf(p.no) }}</span>
              <span v-for="(m, i) in p.messages" :key="i" class="msg">{{ m }}</span>
              <span v-if="!p.messages.length && p.overflow" class="msg">{{ t('check.overflowBy', { px: Math.round(Math.max(p.overflowX, p.overflowY)) }) }}</span>
            </span>
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.check {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 30;
  width: 320px;
  max-height: calc(100% - 20px);
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.head { display: flex; align-items: center; gap: 2px; padding: 8px 6px 8px 14px; border-bottom: 1px solid var(--border); }
.head h2 { flex: 1; font-size: var(--fs-md); font-weight: 650; }
.state { display: flex; align-items: center; gap: 8px; padding: 14px; color: var(--text-muted); line-height: 1.45; }
.state.ok { color: var(--success); }
.summary { padding: 10px 14px 4px; font-weight: 600; }
.list { margin: 0; padding: 4px; list-style: none; overflow-y: auto; }
.item {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  text-align: left;
}
.item:hover { background: var(--bg-hover); }
.item.current { background: var(--accent-soft); }
.warn { flex: none; margin-top: 2px; color: var(--warn); }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.title { font-weight: 600; }
.msg { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.4; }
</style>
