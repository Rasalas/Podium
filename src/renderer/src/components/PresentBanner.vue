<script setup lang="ts">
import { ArrowLeftRight, MonitorPlay, Square } from '@lucide/vue'
import { api } from '../api'
import { t } from '../i18n'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'

const deck = useDeckStore()
const ui = useUiStore()

async function swap() {
  const state = await ui.attempt(() => api().swapPresentationDisplays())
  if (state)
    deck.presentation = state
}
async function stop() {
  const state = await ui.attempt(() => api().stopPresentation())
  if (state)
    deck.presentation = state
}
</script>

<template>
  <div class="banner" role="status">
    <MonitorPlay :size="18" />
    <strong>{{ t('present.running') }}</strong>
    <span v-if="deck.presentation.position" class="where" data-testid="present-where">
      {{ t('present.slideOf', { n: deck.presentation.position.no, total: deck.presentation.position.total }) }}
    </span>
    <span class="spacer" />
    <button v-if="deck.presentation.displays.length > 1 && !deck.presentation.windowed" class="btn small" @click="swap">
      <ArrowLeftRight :size="14" /> {{ t('present.swap') }}
    </button>
    <button class="btn small stop" @click="stop">
      <Square :size="12" /> {{ t('present.stop') }}
    </button>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 12px;
  background: var(--accent);
  color: var(--accent-text);
}
.spacer { flex: 1; }
.where { opacity: 0.9; font-variant-numeric: tabular-nums; }
.banner .btn { color: var(--accent-text); border: 1px solid color-mix(in srgb, var(--accent-text) 45%, transparent); }
.banner .btn:hover { background: color-mix(in srgb, var(--accent-text) 15%, transparent); }
.banner .stop { background: var(--accent-text); color: var(--accent); font-weight: 600; }
.banner .stop:hover { background: color-mix(in srgb, var(--accent-text) 88%, var(--accent)) !important; }
</style>
