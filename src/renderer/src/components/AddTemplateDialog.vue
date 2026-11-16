<script setup lang="ts">
// Add a template from an address or a folder. It stays available for every new presentation.
import type { AddedTemplate } from '@shared/types'
import { FolderOpen, LoaderCircle, TriangleAlert } from '@lucide/vue'
import { computed, ref } from 'vue'
import { api, errorMessage } from '../api'
import { t } from '../i18n'
import { useAppStore } from '../stores/app'
import { useUiStore } from '../stores/ui'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [], added: [template: AddedTemplate] }>()
const app = useAppStore()
const ui = useUiStore()
const source = ref('')
const subdir = ref('')
const showSubdir = ref(false)
const busy = ref(false)
const problem = ref<string>()
const canAdd = computed(() => Boolean(source.value.trim()) && !busy.value)

async function chooseFolder() {
  const picked = await ui.attempt(() => api().pickFolder(t('templates.pickFolderTitle')))
  if (picked)
    source.value = picked
}

async function add() {
  if (!canAdd.value)
    return
  busy.value = true
  problem.value = undefined
  try {
    const added = await api().addTemplate(source.value, showSubdir.value ? subdir.value : undefined)
    await app.loadTemplates()
    ui.toast({ kind: 'success', message: t('templates.added', { name: added.label }) })
    emit('added', added)
    emit('close')
  }
  catch (err) {
    // Stays in the dialog, next to what the user typed.
    problem.value = errorMessage(err)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal :title="t('templates.addTitle')" :width="520" :closable="!busy" @close="emit('close')">
    <form id="add-template" class="form" @submit.prevent="add">
      <div>
        <label class="label" for="at-source">{{ t('templates.source') }}</label>
        <div class="row">
          <input
            id="at-source" v-model="source" class="input" autofocus spellcheck="false" autocomplete="off"
            placeholder="https://github.com/name/vorlage" :disabled="busy" data-testid="template-source"
          >
          <button type="button" class="btn outline" :disabled="busy" @click="chooseFolder">
            <FolderOpen :size="16" /> {{ t('templates.chooseFolder') }}
          </button>
        </div>
        <p class="hint">{{ t('templates.sourceHint') }}</p>
      </div>

      <label class="check">
        <input v-model="showSubdir" type="checkbox" :disabled="busy">
        {{ t('templates.inSubfolder') }}
      </label>
      <div v-if="showSubdir">
        <label class="label" for="at-subdir">{{ t('templates.subfolder') }}</label>
        <input id="at-subdir" v-model="subdir" class="input" spellcheck="false" placeholder="packages/slidev-theme-name" :disabled="busy">
      </div>

      <p class="warning">
        <TriangleAlert :size="16" />
        <span>{{ t('templates.trust') }}</span>
      </p>
      <p v-if="problem" class="problem" role="alert" data-testid="template-problem">{{ problem }}</p>
    </form>
    <template #footer>
      <span v-if="busy" class="busy" role="status"><LoaderCircle :size="16" class="spin" /> {{ t('templates.fetching') }}</span>
      <button class="btn outline" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn primary" type="submit" form="add-template" :disabled="!canAdd" data-testid="template-add">{{ t('templates.add') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 16px; }
.row { display: flex; gap: 8px; }
.row .input { flex: 1; min-width: 0; }
.check { display: flex; align-items: center; gap: 8px; }
.check input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
.hint { margin-top: 6px; }
.warning {
  display: flex;
  gap: 10px;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: var(--fs-sm);
  line-height: 1.45;
}
.warning svg { flex: none; margin-top: 2px; }
.problem { margin: 0; color: var(--danger); line-height: 1.45; }
.busy { display: inline-flex; align-items: center; gap: 8px; margin-right: auto; color: var(--text-muted); font-size: var(--fs-sm); }
</style>
