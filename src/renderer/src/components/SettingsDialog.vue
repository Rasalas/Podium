<script setup lang="ts">
import type { DisplayInfo, Settings } from '@shared/types'
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import { useAppStore } from '../stores/app'
import { useUiStore } from '../stores/ui'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const ui = useUiStore()
const displays = ref<DisplayInfo[]>([])

const PRESETS: Record<Exclude<Settings['agentPreset'], 'custom'>, string> = {
  claude: 'claude -p {prompt}',
  codex: 'codex exec {prompt}',
}

onMounted(async () => {
  displays.value = (await ui.attempt(() => api().getDisplays())) ?? []
})

const checked = ref(false)
const updateBusy = computed(() => app.update?.status === 'checking' || app.update?.status === 'downloading')
const updateStatus = computed(() => {
  const update = app.update
  if (!update)
    return ''
  switch (update.status) {
    case 'checking': return t('update.checking')
    case 'downloading': return t('update.downloading', { v: update.version ?? '', p: Math.round((update.progress ?? 0) * 100) })
    case 'ready': return t('update.readyShort', { v: update.version ?? '' })
    case 'available': return t('update.availableShort', { v: update.version ?? '' })
    case 'error': return t('update.failed', { msg: update.error ?? '' })
    default: return checked.value ? t('update.upToDate') : ''
  }
})

async function checkNow() {
  const state = await ui.attempt(() => api().checkForUpdates())
  if (state) {
    app.update = state
    checked.value = true
  }
}

function setPreset(preset: Settings['agentPreset']) {
  const patch: Partial<Settings> = { agentPreset: preset }
  if (preset !== 'custom')
    patch.agentCommand = PRESETS[preset]
  void app.saveSettings(patch)
}
</script>

<template>
  <Modal :title="t('settings.title')" :width="520" @close="emit('close')">
    <div v-if="app.settings" class="form">
      <div>
        <label class="label" for="set-lang">{{ t('settings.language') }}</label>
        <select id="set-lang" class="select" :value="app.settings.locale" @change="app.saveSettings({ locale: ($event.target as HTMLSelectElement).value as Settings['locale'] })">
          <option value="system">{{ t('settings.system') }}</option>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </div>

      <fieldset>
        <legend class="label">{{ t('settings.agent') }}</legend>
        <div class="radios">
          <label v-for="preset in (['claude', 'codex', 'custom'] as const)" :key="preset" class="radio">
            <input type="radio" name="agent" :checked="app.settings.agentPreset === preset" @change="setPreset(preset)">
            {{ preset === 'claude' ? 'Claude Code' : preset === 'codex' ? 'Codex' : t('settings.custom') }}
          </label>
        </div>
        <label class="label sub" for="set-cmd">{{ t('settings.agentCommand') }}</label>
        <input
          id="set-cmd" class="input mono" :value="app.settings.agentCommand" :disabled="app.settings.agentPreset !== 'custom'"
          @change="app.saveSettings({ agentCommand: ($event.target as HTMLInputElement).value })"
        >
        <p class="hint">{{ t('settings.agentCommandHint') }}</p>
      </fieldset>

      <label class="check">
        <input type="checkbox" :checked="app.settings.autoInstallTrusted" @change="app.saveSettings({ autoInstallTrusted: ($event.target as HTMLInputElement).checked })">
        {{ t('settings.autoInstall') }}
      </label>

      <div>
        <label class="label" for="set-screen">{{ t('settings.audience') }}</label>
        <select
          id="set-screen" class="select" :value="app.settings.audienceDisplayId ?? ''"
          @change="app.saveSettings({ audienceDisplayId: ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : undefined })"
        >
          <option value="">{{ t('settings.auto') }}</option>
          <option v-for="d in displays" :key="d.id" :value="d.id">
            {{ d.label }}{{ d.primary ? ` (${t('settings.primary')})` : '' }}
          </option>
        </select>
      </div>

      <fieldset v-if="app.update && app.update.status !== 'off'">
        <legend class="label">{{ t('update.heading') }}</legend>
        <label class="check">
          <input type="checkbox" :checked="app.settings.autoUpdate" @change="app.saveSettings({ autoUpdate: ($event.target as HTMLInputElement).checked })">
          {{ t('update.auto') }}
        </label>
        <div class="update-row">
          <button class="btn outline" data-testid="update-check" :disabled="updateBusy" @click="checkNow">{{ t('update.check') }}</button>
          <span class="hint" role="status" data-testid="update-status">{{ updateStatus }}</span>
        </div>
      </fieldset>

      <p v-if="app.info" class="hint version">{{ t('settings.version', { v: app.info.version }) }}</p>
    </div>
    <template #footer>
      <button class="btn primary" @click="emit('close')">{{ t('common.close') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 18px; }
fieldset { margin: 0; padding: 0; border: 0; }
legend { padding: 0; }
.radios { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 10px; }
.radio, .check { display: flex; align-items: center; gap: 8px; }
.radio input, .check input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
.check { align-items: flex-start; line-height: 1.4; }
.check input { margin-top: 1px; flex: none; }
.sub { margin-top: 4px; }
.mono { font-family: var(--font-mono); font-size: var(--fs-sm); }
.hint { margin-top: 4px; }
.version { margin-top: 4px; }
.update-row { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.update-row .hint { margin: 0; }
</style>
