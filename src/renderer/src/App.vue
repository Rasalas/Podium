<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { handleKey } from './actions'
import { api } from './api'
import NewDeckDialog from './components/NewDeckDialog.vue'
import PackageDialog from './components/PackageDialog.vue'
import RemoteDialog from './components/RemoteDialog.vue'
import AddTemplateDialog from './components/AddTemplateDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import Toasts from './components/Toasts.vue'
import Tooltip from './components/Tooltip.vue'
import { installEventHandlers } from './events'
import { t } from './i18n'
import { useAppStore } from './stores/app'
import { useDeckStore } from './stores/deck'
import { useUiStore } from './stores/ui'
import EditorView from './views/EditorView.vue'
import SetupView from './views/SetupView.vue'
import StartView from './views/StartView.vue'

const app = useAppStore()
const deck = useDeckStore()
const ui = useUiStore()
const dragging = ref(false)
let dragDepth = 0
let uninstall: (() => void) | undefined

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i

function onKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing)
    return
  if (handleKey({ key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey }, e.target as Element))
    e.preventDefault()
}

function hasFiles(e: DragEvent) {
  return [...(e.dataTransfer?.types ?? [])].includes('Files')
}
function onDragEnter(e: DragEvent) {
  if (!hasFiles(e))
    return
  dragDepth++
  dragging.value = app.view === 'start' || app.view === 'editor'
}
function onDragLeave(e: DragEvent) {
  if (!hasFiles(e))
    return
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth)
    dragging.value = false
}
function onDragOver(e: DragEvent) {
  if (hasFiles(e))
    e.preventDefault()
}
async function onDrop(e: DragEvent) {
  if (!hasFiles(e))
    return
  e.preventDefault()
  dragDepth = 0
  dragging.value = false
  const file = e.dataTransfer?.files[0]
  if (!file || (app.view !== 'start' && app.view !== 'editor'))
    return
  const path = api().pathForFile(file)
  if (!path)
    return
  // An image dropped into an open deck goes onto the current slide.
  if (app.view === 'editor' && deck.deckId && IMAGE.test(file.name)) {
    const id = deck.deckId
    const src = await ui.attempt(() => api().importImage(id, path))
    if (src)
      await deck.insertBlock('image', src)
    return
  }
  void app.openPath(path)
}

onMounted(() => {
  uninstall = installEventHandlers()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  void app.boot()
})
onBeforeUnmount(() => {
  uninstall?.()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <div class="app-root">
    <div v-if="app.view === 'boot'" class="boot" />
    <SetupView v-else-if="app.view === 'setup'" />
    <StartView v-else-if="app.view === 'start'" />
    <EditorView v-else-if="app.view === 'editor' && deck.snapshot" />

    <NewDeckDialog v-if="ui.newDeckOpen" @close="ui.newDeckOpen = false" />
    <SettingsDialog v-if="ui.settingsOpen" @close="ui.settingsOpen = false" />
    <AddTemplateDialog v-if="ui.addTemplateOpen" @close="ui.addTemplateOpen = false" @added="ui.lastAddedTemplate = $event.name" />
    <PackageDialog />
    <RemoteDialog v-if="ui.remoteOpen && deck.deckId" :deck-id="deck.deckId" @close="ui.remoteOpen = false" />

    <div v-if="app.opening && app.view === 'editor'" class="opening" role="status">
      <LoaderCircle :size="18" class="spin" /> {{ t('start.opening') }}
    </div>
    <div v-if="dragging" class="drop-overlay" aria-hidden="true">
      <div class="drop-box">{{ t('start.dropHere') }}</div>
    </div>
    <Toasts />
    <Tooltip />
  </div>
</template>

<style scoped>
.app-root { height: 100%; }
.boot { height: 100%; background: var(--bg-app); }
.opening {
  position: fixed;
  left: 50%;
  top: 64px;
  z-index: 160;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: var(--radius);
  background: var(--bg-surface);
  box-shadow: var(--shadow);
  font-weight: 600;
}
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  pointer-events: none;
}
.drop-box {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border: 3px dashed var(--accent);
  border-radius: var(--radius-lg);
  font-size: var(--fs-xl);
  font-weight: 600;
  color: var(--accent-ink);
}
</style>
