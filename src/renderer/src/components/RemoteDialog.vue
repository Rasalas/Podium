<script setup lang="ts">
// Phone as remote control: pick who may reach it, then show the QR code and link.
import type { RemoteInfo, RemoteMode } from '@shared/types'
import { Check, Copy, LoaderCircle, TriangleAlert } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'
import Modal from './Modal.vue'

const props = defineProps<{ deckId: string }>()
const emit = defineEmits<{ close: [] }>()
const ui = useUiStore()
const deck = useDeckStore()

const info = ref<RemoteInfo | undefined>(ui.remote)
const busy = ref(false)
const copied = ref(false)

const mode = computed<RemoteMode>(() => info.value?.mode ?? 'off')
const hasTailscale = computed(() => !!info.value?.tailscaleAddress)
const hasLan = computed(() => (info.value?.lanAddresses.length ?? 0) > 0)
const qrSrc = computed(() => info.value?.qrSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.value.qrSvg)}` : undefined)

function accept(next: RemoteInfo) {
  info.value = next
  ui.remote = next
}

onMounted(async () => {
  const loaded = await ui.attempt(() => api().getRemoteInfo(props.deckId))
  if (loaded)
    accept(loaded)
})

async function choose(next: RemoteMode) {
  if (busy.value || next === mode.value)
    return
  busy.value = true
  try {
    const result = await ui.attempt(() => api().setRemote(props.deckId, next))
    if (result)
      accept(result)
    else {
      const reloaded = await ui.attempt(() => api().getRemoteInfo(props.deckId))
      if (reloaded)
        accept(reloaded)
    }
  }
  finally {
    busy.value = false
  }
}

async function copyLink() {
  const url = info.value?.url
  if (!url)
    return
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  }
  catch (err) {
    ui.error(err)
  }
}

const options = computed(() => [
  { value: 'off' as const, label: t('remote.off'), hint: t('remote.offHint'), disabled: false },
  {
    value: 'tailscale' as const,
    label: t('remote.tailscale'),
    hint: hasTailscale.value ? t('remote.tailscaleHint') : t('remote.tailscaleMissing'),
    recommended: hasTailscale.value,
    disabled: !hasTailscale.value,
  },
  {
    value: 'lan' as const,
    label: t('remote.lan'),
    hint: hasLan.value ? t('remote.lanWarning') : t('remote.lanMissing'),
    warning: hasLan.value,
    disabled: !hasLan.value,
  },
])
</script>

<template>
  <Modal :title="t('remote.title')" :width="600" @close="emit('close')">
    <div class="remote" data-testid="remote-dialog">
      <p class="intro">{{ t('remote.intro') }}</p>

      <fieldset :disabled="busy || !info">
        <legend class="label">{{ t('remote.choose') }}</legend>
        <label
          v-for="option in options" :key="option.value" class="choice"
          :class="{ on: mode === option.value, disabled: option.disabled && mode !== option.value }"
          :data-testid="`remote-${option.value}`"
        >
          <input
            type="radio" name="remote-mode" :value="option.value" :checked="mode === option.value"
            :disabled="option.disabled && mode !== option.value" @change="choose(option.value)"
          >
          <span class="choice-text">
            <span class="choice-label">
              {{ option.label }}
              <span v-if="option.recommended" class="badge">{{ t('remote.recommended') }}</span>
            </span>
            <span class="choice-hint" :class="{ warning: option.warning }">
              <TriangleAlert v-if="option.warning" :size="14" class="warn-icon" />
              {{ option.hint }}
            </span>
          </span>
        </label>
      </fieldset>

      <p v-if="busy" class="status" role="status">
        <LoaderCircle :size="16" class="spin" /> {{ t('remote.switching') }}
      </p>

      <section v-else-if="mode !== 'off'" class="link-box" data-testid="remote-link">
        <template v-if="info?.url">
          <img v-if="qrSrc" class="qr" :src="qrSrc" :alt="t('remote.qr')" data-testid="remote-qr">
          <div class="link-side">
            <p class="scan">{{ t('remote.scan') }}</p>
            <p class="hint">{{ mode === 'tailscale' ? t('remote.needTailscale') : t('remote.needLan') }}</p>
            <span class="label">{{ t('remote.link') }}</span>
            <div id="remote-url" class="url mono" data-testid="remote-url">{{ info.url }}</div>
            <button class="btn copy" :aria-label="t('remote.copyLink')" @click="copyLink">
              <Check v-if="copied" :size="15" /><Copy v-else :size="15" />
              {{ copied ? t('common.copied') : t('remote.copyLink') }}
            </button>
            <p class="hint">{{ t('remote.newLink') }}</p>
          </div>
        </template>
        <p v-else class="hint">{{ !deck.serverReady ? t('remote.waitingForPreview') : mode === 'tailscale' ? t('remote.tailscaleMissing') : t('remote.lanMissing') }}</p>
      </section>

      <p class="hint note">{{ t('remote.restartNote') }}</p>
    </div>
    <template #footer>
      <button class="btn primary" @click="emit('close')">{{ t('common.close') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.remote { display: flex; flex-direction: column; gap: 14px; }
.intro { line-height: 1.45; }
fieldset { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; border: 0; min-width: 0; }
legend { padding: 0; margin-bottom: 6px; }
.choice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.choice:hover:not(.disabled) { background: var(--bg-hover); }
.choice.on { border-color: var(--accent); background: var(--accent-soft); }
.choice.disabled { cursor: default; color: var(--text-muted); }
.choice input { width: 16px; height: 16px; margin: 2px 0 0; flex: none; accent-color: var(--accent); }
.choice-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.choice-label { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.choice-hint { color: var(--text-muted); line-height: 1.4; }
.choice-hint.warning { color: var(--warn); }
.warn-icon { vertical-align: -2px; margin-right: 2px; }
.badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--success-soft);
  color: var(--success);
  font-size: var(--fs-xs);
  font-weight: 650;
}
.status { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }
.link-box {
  display: flex;
  gap: 18px;
  align-items: flex-start;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
}
.qr {
  width: 220px;
  height: 220px;
  flex: none;
  border-radius: var(--radius);
  background: #fff;
  image-rendering: pixelated;
}
.link-side { display: flex; flex-direction: column; gap: 8px; min-width: 0; flex: 1; }
.scan { font-weight: 600; line-height: 1.4; }
.url {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-surface);
  overflow-wrap: anywhere;
  user-select: all;
  line-height: 1.4;
}
.copy { align-self: flex-start; }
.mono { font-family: var(--font-mono); font-size: var(--fs-sm); }
.note { margin-top: 2px; }
</style>
