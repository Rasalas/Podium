<script setup lang="ts">
import { Bot, Check, CircleAlert, Copy, FileText, LoaderCircle, Send, Square, Wrench, X } from '@lucide/vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'

const deck = useDeckStore()
const ui = useUiStore()
const prompt = ref('')
const log = ref<HTMLElement>()
const copied = ref<string>()
const loading = ref(false)
const sending = ref(false)

async function loadInfo() {
  const id = deck.deckId
  if (!id)
    return
  loading.value = true
  try {
    const info = await ui.attempt(() => api().getAgentInfo(id))
    if (info)
      deck.agentInfo = info
  }
  finally {
    loading.value = false
  }
}

onMounted(loadInfo)
// The MCP address only exists once the preview runs.
watch(() => deck.server?.mcpUrl, loadInfo)

watch(() => deck.agentItems.length, () => void nextTick(() => {
  log.value?.scrollTo({ top: log.value.scrollHeight })
}))
watch(() => deck.agentItems.at(-1)?.text, () => void nextTick(() => {
  log.value?.scrollTo({ top: log.value.scrollHeight })
}))

const info = computed(() => deck.agentInfo)

async function send() {
  const id = deck.deckId
  const text = prompt.value.trim()
  if (!id || !text || deck.agentRunning || sending.value)
    return
  sending.value = true
  try {
    await api().agentSend(id, text)
    prompt.value = ''
  }
  catch (err) {
    ui.error(err)
  }
  finally {
    sending.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

async function stop() {
  const id = deck.deckId
  if (id)
    await ui.attempt(() => api().agentStop(id))
}

async function copy(text: string, which: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = which
    setTimeout(() => {
      if (copied.value === which)
        copied.value = undefined
    }, 1800)
  }
  catch (err) {
    ui.error(err)
  }
}

async function rewriteAgents() {
  const id = deck.deckId
  if (!id)
    return
  const ok = await ui.attempt(() => api().writeAgentsFile(id).then(() => true))
  if (ok) {
    ui.toast({ kind: 'success', message: t('agent.agentsWritten') })
    void loadInfo()
  }
}
</script>

<template>
  <div class="agent">
    <header class="panel-head">
      <h2><Bot :size="17" /> {{ t('agent.title') }}</h2>
      <button class="btn icon" :aria-label="t('agent.close')" :data-tip="t('agent.close')" @click="ui.rightPanel = 'inspector'">
        <X :size="16" />
      </button>
    </header>

    <div v-if="loading && !info" class="center-note">
      <LoaderCircle :size="18" class="spin" />
    </div>

    <div v-else-if="info && !info.available" class="unavailable">
      <h3>{{ t('agent.unavailableTitle') }}</h3>
      <p>{{ t('agent.unavailableText', { command: info.command }) }}</p>
      <p class="hint">{{ t('agent.unavailableHint') }}</p>
      <button class="btn outline" @click="ui.settingsOpen = true">{{ t('agent.openSettings') }}</button>
    </div>

    <template v-else-if="info">
      <div ref="log" class="log" aria-live="polite">
        <p v-if="!deck.agentItems.length" class="empty">{{ t('agent.empty') }}</p>
        <template v-for="(item, i) in deck.agentItems" :key="i">
          <div v-if="item.kind === 'user'" class="msg user selectable">{{ item.text }}</div>
          <div v-else-if="item.kind === 'assistant'" class="msg assistant selectable">{{ item.text }}</div>
          <div v-else-if="item.kind === 'tool'" class="tool">
            <Wrench :size="12" /> <span class="tool-name">{{ item.text }}</span> <span class="tool-detail selectable">{{ item.detail }}</span>
          </div>
          <div v-else-if="item.kind === 'error'" class="msg error selectable" role="alert">
            <CircleAlert :size="14" /> {{ item.text }}
          </div>
          <div v-else class="status" :class="item.text">
            <Check v-if="item.text === 'done'" :size="13" />
            <Square v-else :size="11" />
            {{ item.text === 'done' ? t('agent.done') : t('agent.failed') }}
          </div>
        </template>
        <div v-if="deck.agentRunning" class="status running">
          <LoaderCircle :size="13" class="spin" /> {{ t('agent.working') }}
        </div>
      </div>

      <form class="composer" @submit.prevent="send">
        <textarea
          v-model="prompt" class="textarea" rows="3" :placeholder="t('agent.placeholder')" :aria-label="t('agent.placeholder')"
          :disabled="deck.agentRunning" @keydown="onKey"
        />
        <div class="composer-actions">
          <button v-if="deck.agentRunning" type="button" class="btn outline" @click="stop">
            <Square :size="13" /> {{ t('agent.stop') }}
          </button>
          <button v-else class="btn primary" type="submit" :disabled="!prompt.trim() || sending">
            <Send :size="14" /> {{ t('agent.send') }}
          </button>
        </div>
      </form>
    </template>

    <details v-if="info" class="others">
      <summary>{{ t('agent.otherTools') }}</summary>
      <div class="others-body">
        <template v-if="info.mcpUrl">
          <span class="label">{{ t('agent.mcpAddress') }}</span>
          <div class="copy-row">
            <code class="selectable">{{ info.mcpUrl }}</code>
            <button class="btn icon small" :aria-label="`${t('common.copy')}: ${t('agent.mcpAddress')}`" :data-tip="copied === 'url' ? t('common.copied') : t('common.copy')" @click="copy(info.mcpUrl, 'url')">
              <Check v-if="copied === 'url'" :size="14" /><Copy v-else :size="14" />
            </button>
          </div>
          <template v-if="info.mcpSetupCommand">
            <span class="label">{{ t('agent.mcpCommand') }}</span>
            <div class="copy-row">
              <code class="selectable">{{ info.mcpSetupCommand }}</code>
              <button class="btn icon small" :aria-label="`${t('common.copy')}: ${t('agent.mcpCommand')}`" :data-tip="copied === 'cmd' ? t('common.copied') : t('common.copy')" @click="copy(info.mcpSetupCommand, 'cmd')">
                <Check v-if="copied === 'cmd'" :size="14" /><Copy v-else :size="14" />
              </button>
            </div>
          </template>
        </template>
        <p v-else class="hint">{{ t('agent.mcpNotRunning') }}</p>
        <button class="btn outline small" @click="rewriteAgents">
          <FileText :size="14" /> {{ t('agent.rewriteAgents') }}
        </button>
        <p class="hint">{{ t('agent.agentsHint') }}</p>
      </div>
    </details>
  </div>
</template>

<style scoped>
.agent { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  flex: none;
  padding: 0 6px 0 14px;
  border-bottom: 1px solid var(--border);
}
.panel-head h2 { display: flex; align-items: center; gap: 8px; font-size: var(--fs-md); font-weight: 650; }
.center-note { display: grid; place-items: center; padding: 32px; color: var(--text-muted); }
.unavailable { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 16px 14px; line-height: 1.5; }
.unavailable h3 { font-size: var(--fs-md); }
.log { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 14px; }
.empty { color: var(--text-muted); line-height: 1.5; }
.msg { padding: 8px 10px; border-radius: var(--radius); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.user { align-self: flex-end; max-width: 88%; background: var(--accent-soft); color: var(--text); }
.assistant { background: var(--bg-surface); border: 1px solid var(--border); }
.error { display: flex; gap: 6px; align-items: flex-start; background: var(--danger-soft); color: var(--danger); }
.error svg { flex: none; margin-top: 3px; }
.tool { display: flex; align-items: baseline; gap: 6px; padding: 0 2px; font-size: var(--fs-sm); color: var(--text-faint); min-width: 0; }
.tool svg { flex: none; align-self: center; }
.tool-name { font-weight: 600; }
.tool-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-muted); }
.status.done { color: var(--success); }
.status.running { color: var(--accent-ink); }
.composer { flex: none; display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--border); }
.composer .textarea { resize: none; }
.composer-actions { display: flex; justify-content: flex-end; }
.others { flex: none; border-top: 1px solid var(--border); }
.others summary { padding: 10px 14px; font-size: var(--fs-sm); font-weight: 600; color: var(--text-muted); cursor: default; }
.others summary:hover { color: var(--text); }
.others-body { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 0 14px 14px; }
.others-body .label { margin: 4px 0 0; }
.copy-row { display: flex; align-items: center; gap: 4px; width: 100%; }
.copy-row code {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}
.copy-row .btn { width: 26px; height: 26px; }
</style>
