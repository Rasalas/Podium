<script setup lang="ts">
// The only place an update shows up on its own: a small button once a new version is loaded
// (or, where the app cannot replace itself, once there is one). Nothing opens unasked.
import { ArrowDownToLine } from '@lucide/vue'
import { computed, ref } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import { useAppStore } from '../stores/app'
import { useUiStore } from '../stores/ui'
import Modal from './Modal.vue'

const app = useAppStore()
const ui = useUiStore()
const open = ref(false)
const update = computed(() => app.update)
const visible = computed(() => update.value?.status === 'ready' || update.value?.status === 'available')
const label = computed(() => update.value?.status === 'ready' ? t('update.ready') : t('update.available'))

function restart() {
  void ui.attempt(() => api().installUpdate())
}

function download() {
  const url = update.value?.downloadUrl ?? update.value?.releaseUrl
  if (url)
    void ui.attempt(() => api().openExternal(url))
  open.value = false
}
</script>

<template>
  <button v-if="visible" class="btn update-note" data-testid="update-note" @click="open = true">
    <ArrowDownToLine :size="15" /> {{ label }}
  </button>
  <Modal v-if="open && update" :title="t('update.title', { v: update.version ?? '' })" :width="440" @close="open = false">
    <p class="text">
      {{ update.status === 'ready' ? t('update.readyText') : t('update.availableText') }}
    </p>
    <p v-if="update.releaseUrl" class="text">
      <a href="#" @click.prevent="api().openExternal(update.releaseUrl!)">{{ t('update.notes') }}</a>
    </p>
    <template #footer>
      <button class="btn" @click="open = false">{{ t('update.later') }}</button>
      <button v-if="update.status === 'ready'" class="btn primary" data-testid="update-restart" @click="restart">{{ t('update.restart') }}</button>
      <button v-else class="btn primary" @click="download">{{ t('update.download') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.update-note {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.update-note:hover:not(:disabled) { background: var(--accent-soft); filter: brightness(0.97); }
.text { margin: 0 0 10px; line-height: 1.5; }
.text a { color: var(--accent); }
</style>
