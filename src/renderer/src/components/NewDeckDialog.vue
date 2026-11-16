<script setup lang="ts">
import { Check, FolderOpen, Plus } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import { useAppStore } from '../stores/app'
import { useUiStore } from '../stores/ui'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const ui = useUiStore()
const title = ref('')
const template = ref('')
const parentDir = ref(app.info?.defaultDeckDir ?? '')

onMounted(async () => {
  const list = await app.loadTemplates()
  template.value = list.find(tpl => tpl.builtin)?.id ?? list[0]?.id ?? 'default'
})

// A template added from this dialog becomes the choice.
watch(() => ui.lastAddedTemplate, (name) => {
  const added = app.templates.find(tpl => tpl.packageName === name)
  if (added)
    template.value = added.id
  ui.lastAddedTemplate = undefined
})

const effectiveTitle = computed(() => title.value.trim() || t('newDeck.title'))
const folderName = computed(() => effectiveTitle.value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim())
const canCreate = computed(() => Boolean(template.value && parentDir.value) && !app.opening)

async function chooseFolder() {
  const picked = await ui.attempt(() => api().pickFolder(t('newDeck.pickFolderTitle'), parentDir.value || undefined))
  if (picked)
    parentDir.value = picked
}

function create() {
  if (!canCreate.value)
    return
  emit('close')
  void app.createDeck({ title: effectiveTitle.value, template: template.value, parentDir: parentDir.value, folderName: folderName.value })
}

function onTemplateKey(e: KeyboardEvent, index: number) {
  const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
  if (!delta)
    return
  e.preventDefault()
  const list = app.templates
  const next = list[(index + delta + list.length) % list.length]
  template.value = next.id
  ;(e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[list.indexOf(next)]?.focus()
}
</script>

<template>
  <Modal :title="t('newDeck.title')" :width="640" @close="emit('close')">
    <form id="new-deck" class="form" @submit.prevent="create">
      <div>
        <label class="label" for="nd-title">{{ t('newDeck.name') }}</label>
        <input id="nd-title" v-model="title" class="input large" autofocus :placeholder="t('newDeck.namePlaceholder')">
      </div>

      <div>
        <span id="nd-template" class="label">{{ t('newDeck.template') }}</span>
        <div class="templates" role="radiogroup" aria-labelledby="nd-template">
          <button
            v-for="(tpl, index) in app.templates" :key="tpl.id" type="button" role="radio"
            class="template" :class="{ selected: template === tpl.id }" :aria-checked="template === tpl.id"
            :tabindex="template === tpl.id ? 0 : -1" @click="template = tpl.id" @keydown="onTemplateKey($event, index)"
          >
            <div
              class="preview"
              :style="{ background: tpl.colors?.background ?? '#fff', color: tpl.colors?.foreground ?? '#222' }"
            >
              <img v-if="tpl.preview" :src="tpl.preview" alt="">
              <template v-else>
                <span class="pv-title">{{ effectiveTitle }}</span>
                <span class="pv-line" :style="{ background: tpl.colors?.accent ?? '#888' }" />
              </template>
              <span v-if="template === tpl.id" class="check"><Check :size="14" :stroke-width="3" /></span>
            </div>
            <span class="tpl-label">{{ tpl.label }}</span>
            <span class="tpl-desc">{{ tpl.description }}</span>
            <span v-if="!tpl.installed" class="tpl-desc faint">{{ t('newDeck.needsDownload') }}</span>
          </button>
          <button type="button" class="template add" data-testid="add-template" @click="ui.addTemplateOpen = true">
            <div class="preview add-preview"><Plus :size="22" /></div>
            <span class="tpl-label">{{ t('templates.addShort') }}</span>
            <span class="tpl-desc">{{ t('templates.addHint') }}</span>
          </button>
        </div>
      </div>

      <div>
        <span class="label">{{ t('newDeck.location') }}</span>
        <div class="location">
          <span class="path selectable" :title="parentDir">{{ parentDir }}</span>
          <button type="button" class="btn outline" @click="chooseFolder">
            <FolderOpen :size="16" /> {{ t('newDeck.chooseFolder') }}
          </button>
        </div>
        <p class="hint">{{ t('newDeck.locationHint', { folder: folderName }) }}</p>
      </div>
    </form>
    <template #footer>
      <button class="btn outline" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn primary" type="submit" form="new-deck" :disabled="!canCreate">{{ t('newDeck.create') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 20px; }
.input.large { height: 36px; font-size: var(--fs-md); }
.templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; }
.template {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: none;
  text-align: left;
}
.template:hover { background: var(--bg-hover); }
.add-preview { display: flex; align-items: center; justify-content: center; background: var(--bg-panel); color: var(--text-faint); border-style: dashed; }
.template.selected { border-color: var(--accent); background: var(--accent-soft); }
.preview {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  aspect-ratio: 16 / 9;
  padding: 0 10px;
  margin-bottom: 4px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.preview img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pv-title { font-size: 11px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-line { width: 40%; height: 3px; border-radius: 2px; }
.check {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-text);
}
.tpl-label { font-weight: 600; }
.tpl-desc { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.3; }
.faint { color: var(--text-faint); font-style: italic; }
.location { display: flex; align-items: center; gap: 8px; }
.path {
  flex: 1;
  min-width: 0;
  height: var(--control-h);
  line-height: var(--control-h);
  padding: 0 8px;
  border-radius: var(--radius);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.hint { margin-top: 6px; }
</style>
