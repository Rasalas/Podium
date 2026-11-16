<script setup lang="ts">
import type { BlockKind, DisplayInfo, ExportFormat } from '@shared/types'
import {
  ArrowLeft, Bold, ChevronDown, Code, CodeXml, Download, FileCode, Heading, Image, Italic, Link,
  List, PanelRight, Play, Plus, Redo2, ScanSearch, Settings, Shapes, Smartphone, Sparkles, Table, Type, Undo2,
} from '@lucide/vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { exportAs, format, insertBlock, openCheck, present } from '../actions'
import { api } from '../api'
import { keys, t } from '../i18n'
import { useAppStore } from '../stores/app'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'
import DropMenu from './DropMenu.vue'

const app = useAppStore()
const deck = useDeckStore()
const ui = useUiStore()

const renaming = ref(false)
const titleDraft = ref('')
const titleInput = ref<HTMLInputElement>()

async function startRename() {
  titleDraft.value = deck.snapshot?.title ?? ''
  renaming.value = true
  await nextTick()
  titleInput.value?.select()
}
function finishRename(commit: boolean) {
  if (!renaming.value)
    return
  renaming.value = false
  const next = titleDraft.value.trim()
  if (commit && next && next !== deck.snapshot?.title)
    void deck.apply({ type: 'setHeadmatter', patch: { title: next } })
}

const blocks: { kind: BlockKind, icon: unknown, key: string }[] = [
  { kind: 'text', icon: Type, key: 'text' },
  { kind: 'heading', icon: Heading, key: 'heading' },
  { kind: 'list', icon: List, key: 'list' },
  { kind: 'image', icon: Image, key: 'image' },
  { kind: 'table', icon: Table, key: 'table' },
  { kind: 'code', icon: CodeXml, key: 'code' },
]

const exportFormats: ExportFormat[] = ['pdf', 'pptx', 'png', 'web', 'bundle']

const displays = ref<DisplayInfo[]>([])
async function loadDisplays() {
  displays.value = (await ui.attempt(() => api().getDisplays())) ?? []
}
const audience = computed(() => app.settings?.audienceDisplayId)
function chooseAudience(id: number | undefined) {
  void app.saveSettings({ audienceDisplayId: id })
}

const linkMenu = ref<InstanceType<typeof DropMenu>>()
const linkUrl = ref('https://')
function applyLink() {
  const url = linkUrl.value.trim()
  linkMenu.value?.close()
  if (url && url !== 'https://')
    format('link', url)
  linkUrl.value = 'https://'
}

const remoteOn = computed(() => !!ui.remote && ui.remote.mode !== 'off')
async function loadRemote() {
  const id = deck.deckId
  if (!id)
    return
  try {
    const info = await api().getRemoteInfo(id)
    if (id === deck.deckId)
      ui.remote = info
  }
  catch {}
}
onMounted(loadRemote)
// The link carries the port; refresh it when the preview comes back after a restart.
watch(() => [deck.deckId, deck.server?.state], loadRemote)

const editing = computed(() => deck.canvasEditing)
const rightVisible = computed(() => !ui.rightCollapsed)
</script>

<template>
  <header class="toolbar" role="toolbar" :aria-label="deck.snapshot?.title">
    <div class="group">
      <button class="btn icon" :aria-label="t('editor.back')" :data-tip="t('editor.back')" @click="app.closeCurrent()">
        <ArrowLeft :size="18" />
      </button>
      <input
        v-if="renaming" ref="titleInput" v-model="titleDraft" class="input title-input" :aria-label="t('editor.renameTitle')"
        @keydown.enter.prevent="finishRename(true)" @keydown.escape.prevent.stop="finishRename(false)" @blur="finishRename(true)"
      >
      <button v-else class="btn deck-title" :data-tip="t('editor.renameTitle')" @click="startRename">
        <span class="ellipsis">{{ deck.snapshot?.title }}</span>
      </button>
    </div>

    <div class="group">
      <button
        class="btn icon" :disabled="!deck.snapshot?.canUndo" :aria-label="t('editor.undo')"
        :data-tip="`${t('editor.undo')} (${keys('Ctrl+Z')})`" @mousedown.prevent @click="deck.undo()"
      >
        <Undo2 :size="18" />
      </button>
      <button
        class="btn icon" :disabled="!deck.snapshot?.canRedo" :aria-label="t('editor.redo')"
        :data-tip="`${t('editor.redo')} (${keys('Ctrl+Shift+Z')})`" @mousedown.prevent @click="deck.redo()"
      >
        <Redo2 :size="18" />
      </button>
    </div>

    <div class="group split">
      <button class="btn outline split-main" :data-tip="`${t('editor.newSlide')} (${keys('Ctrl+M')})`" @click="deck.newSlide()">
        <Plus :size="17" /> <span>{{ t('editor.newSlide') }}</span>
      </button>
      <button class="btn outline split-arrow" :aria-label="t('editor.chooseLayout')" :data-tip="t('editor.chooseLayout')" aria-haspopup="dialog" @click="ui.layoutPicker = 'new'">
        <ChevronDown :size="15" />
      </button>
    </div>

    <div class="group insert-compact">
      <DropMenu :label="t('editor.insert')">
        <template #trigger="{ toggle, open }">
          <button class="btn" aria-haspopup="menu" :aria-expanded="open" :disabled="!deck.current" :data-tip="t('editor.insert')" @mousedown.prevent @click="toggle">
            <Shapes :size="16" /> <span class="insert-text">{{ t('editor.insert') }}</span> <ChevronDown :size="14" class="chev" />
          </button>
        </template>
        <button v-for="block in blocks" :key="block.kind" class="menu-item" role="menuitem" @mousedown.prevent @click="insertBlock(block.kind)">
          <component :is="block.icon" :size="16" /> {{ t(`editor.blocks.${block.key}`) }}
        </button>
      </DropMenu>
    </div>

    <div class="group insert-inline" role="group" :aria-label="t('editor.insert')">
      <button
        v-for="block in blocks" :key="block.kind" class="btn insert" :disabled="!deck.current"
        :aria-label="t(`editor.blocks.${block.key}`)" :data-tip="t(`editor.blocks.${block.key}`)"
        @mousedown.prevent @click="insertBlock(block.kind)"
      >
        <component :is="block.icon" :size="17" />
        <span class="insert-label">{{ t(`editor.blocks.${block.key}`) }}</span>
      </button>
    </div>

    <div class="group" role="group" :aria-label="t('editor.format')">
      <button
        class="btn icon" :disabled="!editing" :aria-pressed="editing && deck.formatState.bold" :aria-label="t('editor.bold')"
        :data-tip="`${t('editor.bold')} (${keys('Ctrl+B')})`" @mousedown.prevent @click="format('bold')"
      >
        <Bold :size="17" />
      </button>
      <button
        class="btn icon" :disabled="!editing" :aria-pressed="editing && deck.formatState.italic" :aria-label="t('editor.italic')"
        :data-tip="`${t('editor.italic')} (${keys('Ctrl+I')})`" @mousedown.prevent @click="format('italic')"
      >
        <Italic :size="17" />
      </button>
      <button
        class="btn icon fmt-code" :disabled="!editing" :aria-pressed="editing && deck.formatState.code" :aria-label="t('editor.inlineCode')"
        :data-tip="t('editor.inlineCode')" @mousedown.prevent @click="format('code')"
      >
        <Code :size="17" />
      </button>
      <DropMenu ref="linkMenu" :label="t('editor.link')">
        <template #trigger="{ toggle }">
          <button
            class="btn icon" :disabled="!editing" :aria-pressed="editing && deck.formatState.link" :aria-label="t('editor.link')"
            :data-tip="t('editor.link')" aria-haspopup="menu" @mousedown.prevent @click="toggle"
          >
            <Link :size="17" />
          </button>
        </template>
        <form class="link-form" @submit.prevent="applyLink" @click.stop>
          <label class="label" for="link-url">{{ t('editor.linkPrompt') }}</label>
          <input id="link-url" v-model="linkUrl" class="input menu-item" type="url" autofocus>
          <button class="btn primary small" type="submit">OK</button>
        </form>
      </DropMenu>
    </div>

    <div class="spacer" />

    <div class="group">
      <button class="btn" :class="{ pressed: ui.checkOpen }" :data-tip="t('check.title')" @click="openCheck()">
        <ScanSearch :size="17" /> <span class="label-text">{{ t('editor.check') }}</span>
      </button>
      <DropMenu align="right" :label="t('editor.export')">
        <template #trigger="{ toggle, open }">
          <button class="btn" aria-haspopup="menu" :aria-expanded="open" :data-tip="t('editor.export')" @click="toggle">
            <Download :size="17" /> <span class="label-text">{{ t('editor.export') }}</span>
            <ChevronDown :size="14" class="chev" />
          </button>
        </template>
        <button v-for="fmt in exportFormats" :key="fmt" class="menu-item" role="menuitem" @click="exportAs(fmt)">
          <span>
            {{ t(`editor.exportAs.${fmt}`) }}
            <span class="menu-sub">{{ t(`editor.exportHint.${fmt}`) }}</span>
          </span>
        </button>
      </DropMenu>
    </div>

    <div class="group">
      <button
        class="btn icon" :aria-pressed="ui.sourceOpen" :aria-label="t('editor.source')"
        :data-tip="`${t('editor.source')} (${keys('Ctrl+E')})`" @click="ui.sourceOpen = !ui.sourceOpen"
      >
        <FileCode :size="18" />
      </button>
      <button
        class="btn icon" :aria-pressed="rightVisible && ui.rightPanel === 'agent'" :aria-label="t('editor.agent')"
        :data-tip="`${t('editor.agent')} (${keys('Ctrl+J')})`" @click="ui.toggleAgent()"
      >
        <Sparkles :size="18" />
      </button>
      <button
        class="btn icon" :aria-pressed="rightVisible && ui.rightPanel === 'inspector'" :aria-label="t('editor.inspector')"
        :data-tip="t('editor.inspector')"
        @click="rightVisible && ui.rightPanel === 'inspector' ? (ui.rightCollapsed = true) : ui.showRight('inspector')"
      >
        <PanelRight :size="18" />
      </button>
      <button class="btn icon" :aria-label="t('editor.settings')" :data-tip="t('editor.settings')" @click="ui.settingsOpen = true">
        <Settings :size="18" />
      </button>
    </div>

    <div class="group split">
      <button
        v-if="remoteOn" class="btn icon remote-on" data-testid="remote-indicator"
        :aria-label="t('remote.indicator')" :data-tip="t('remote.indicator')" @click="ui.remoteOpen = true"
      >
        <Smartphone :size="17" />
      </button>
      <button class="btn primary split-main" :data-tip="`${t('editor.presentFromStart')} (F5)`" @click="present(false)">
        <Play :size="16" /> {{ t('editor.present') }}
      </button>
      <DropMenu align="right" class="present-menu" :label="t('editor.present')" @open="loadDisplays">
        <template #trigger="{ toggle, open }">
          <button class="btn primary split-arrow" aria-haspopup="menu" :aria-expanded="open" :aria-label="`${t('editor.present')}: Optionen`" @click="toggle">
            <ChevronDown :size="15" />
          </button>
        </template>
        <button class="menu-item" role="menuitem" @click="present(false)">
          {{ t('editor.presentFromStart') }} <span class="menu-hint">F5</span>
        </button>
        <button class="menu-item" role="menuitem" @click="present(true)">
          {{ t('editor.presentFromCurrent') }} <span class="menu-hint">{{ keys('Shift+F5') }}</span>
        </button>
        <button class="menu-item" role="menuitem" @click="present(true, undefined, true)">
          {{ t('editor.presentWindowed') }}
        </button>
        <div class="menu-sep" />
        <button class="menu-item" role="menuitem" data-testid="menu-remote" @click="ui.remoteOpen = true">
          <Smartphone :size="16" /> {{ t('editor.remote') }}
          <span v-if="remoteOn" class="remote-state">{{ t('remote.on') }}</span>
        </button>
        <template v-if="displays.length > 1">
          <div class="menu-sep" />
          <div class="menu-heading">{{ t('editor.audienceScreen') }}</div>
          <button
            class="menu-item" role="menuitemradio" :aria-checked="audience === undefined"
            @click.stop="chooseAudience(undefined)"
          >
            <span class="radio" :class="{ on: audience === undefined }" /> {{ t('editor.autoScreen') }}
          </button>
          <button
            v-for="d in displays" :key="d.id" class="menu-item" role="menuitemradio" :aria-checked="audience === d.id"
            @click.stop="chooseAudience(d.id)"
          >
            <span class="radio" :class="{ on: audience === d.id }" /> {{ d.label }}
            <span class="menu-hint">{{ d.bounds.width }}×{{ d.bounds.height }}</span>
          </button>
        </template>
      </DropMenu>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--toolbar-h);
  padding: 0 10px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.group { display: flex; align-items: center; gap: 2px; flex: none; }
.group + .group { padding-left: 6px; border-left: 1px solid var(--border); }
.group.split { gap: 0; }
.spacer + .group { border-left: 0; }
.spacer { flex: 1; min-width: 4px; }
.deck-title {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--fs-md);
  font-weight: 600;
  justify-content: flex-start;
}
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title-input { width: 220px; font-size: var(--fs-md); font-weight: 600; }
.split-main { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.split-arrow { width: 24px; padding: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: -1px; }
.btn.primary.split-arrow { border-left: 1px solid color-mix(in srgb, var(--accent-text) 35%, var(--accent)); }
.insert { padding: 0 7px; }
.insert-compact { display: none; }
.insert-label { display: none; }
.chev { color: var(--text-faint); margin-left: -2px; }
.link-form { display: flex; flex-direction: column; gap: 6px; padding: 6px; width: 260px; }
.link-form .input { height: var(--control-h); }
.link-form .btn { align-self: flex-end; }
.present-menu :deep(.menu) { width: 300px; }
.radio {
  width: 12px;
  height: 12px;
  flex: none;
  border: 1.5px solid var(--border-strong);
  border-radius: 50%;
}
.radio.on { border: 4px solid var(--accent); }
.remote-on { position: relative; margin-right: 6px; color: var(--accent-ink); }
.remote-on::after {
  content: '';
  position: absolute;
  top: 5px;
  right: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 2px var(--bg-panel);
}
.remote-state { margin-left: auto; color: var(--success); font-size: var(--fs-sm); font-weight: 600; }

@media (min-width: 1500px) {
  .insert-label { display: inline; }
}
@media (max-width: 1280px) {
  .insert-inline { display: none; }
  .insert-compact { display: flex; }
}
@media (max-width: 1340px) {
  .label-text { display: none; }
}
@media (max-width: 1180px) {
  .deck-title { max-width: 150px; }
}
@media (max-width: 1050px) {
  .deck-title { max-width: 100px; }
  .insert-text, .fmt-code { display: none; }
  .toolbar { gap: 3px; padding: 0 6px; }
  .group + .group { padding-left: 3px; }
  .insert { padding: 0 5px; }
}
</style>
