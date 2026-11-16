<script setup lang="ts">
import type { Rect } from '@shared/bridge'
import { CircleAlert, FileCode, LoaderCircle, RefreshCw, Sparkles, X } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { canvas, handleFrameShortcut } from '../actions'
import { api } from '../api'
import { locale, t } from '../i18n'
import { BridgeHost } from '../lib/bridgeHost'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'

const deck = useDeckStore()
const ui = useUiStore()
const stage = ref<HTMLElement>()
const frame = ref<HTMLIFrameElement>()
const size = ref({ width: 0, height: 0 })
const frameSrc = ref<string>()
const hint = ref<{ x: number, y: number }>()
const retrying = ref(false)

const PAD = 28

const host = new BridgeHost({
  apply: op => deck.apply(op),
  locale: () => locale.value,
  onReady(no) {
    if (deck.currentNo && no !== deck.currentNo)
      host.goto(deck.currentNo)
  },
  onNavigated(no) {
    // The frame moved by itself (e.g. a link inside the slide); follow it.
    if (no !== deck.currentNo && deck.slides[no - 1])
      deck.select(no)
  },
  onEditing(editing) {
    deck.canvasEditing = editing
    if (!editing)
      deck.formatState = { bold: false, italic: false, code: false, link: false }
    if (editing)
      hint.value = undefined
  },
  onFormatState(state) {
    deck.formatState = state
  },
  onCodeClicked(_what, rect) {
    showHint(rect)
  },
  onBackgroundClicked() {
    hint.value = undefined
  },
  onShortcut: key => handleFrameShortcut(key),
})

const status = computed(() => deck.server)
const ready = computed(() => deck.serverReady)

const aspect = computed(() => {
  const c = deck.snapshot?.canvas
  return c && c.width && c.height ? c.width / c.height : 16 / 9
})

function measure() {
  const el = stage.value
  if (!el)
    return
  const w = Math.max(0, el.clientWidth - PAD * 2)
  const h = Math.max(0, el.clientHeight - PAD * 2)
  const width = Math.floor(Math.min(w, h * aspect.value))
  size.value = { width, height: Math.floor(width / aspect.value) }
}

let observer: ResizeObserver | undefined

function onMessage(event: MessageEvent) {
  host.handle(event)
}

function onFrameLoad() {
  // Fires again whenever the page inside reloads; the bridge client then needs a new hello.
  host.attach(frame.value?.contentWindow ?? null, deck.server?.url)
}

function showHint(rect: Rect) {
  const f = frame.value?.getBoundingClientRect()
  const s = stage.value?.getBoundingClientRect()
  if (!f || !s)
    return
  const x = f.left - s.left + rect.x + rect.width / 2
  const y = f.top - s.top + rect.y + rect.height
  hint.value = { x: Math.min(Math.max(x, 170), s.width - 170), y: Math.min(y + 8, s.height - 120) }
}

watch(() => deck.server?.url, (url) => {
  if (url && deck.serverReady) {
    frameSrc.value = `${url}/${deck.currentNo || 1}?embedded=true`
  }
}, { immediate: true })

watch(ready, (isReady) => {
  if (!isReady)
    host.detach()
  else if (deck.server?.url && !frameSrc.value)
    frameSrc.value = `${deck.server.url}/${deck.currentNo || 1}?embedded=true`
})

watch(() => deck.currentNo, (no) => {
  hint.value = undefined
  if (host.ready)
    host.goto(no)
})

watch(aspect, () => void nextTick(measure))

async function retry() {
  const id = deck.deckId
  if (!id)
    return
  retrying.value = true
  try {
    const next = await ui.attempt(() => api().restartServer(id))
    if (next)
      deck.acceptServer(next)
  }
  finally {
    retrying.value = false
  }
}

onMounted(() => {
  canvas.host = host
  canvas.focusFrame = () => frame.value?.contentWindow?.focus()
  window.addEventListener('message', onMessage)
  observer = new ResizeObserver(measure)
  if (stage.value)
    observer.observe(stage.value)
  measure()
})
onBeforeUnmount(() => {
  if (canvas.host === host) {
    canvas.host = null
    canvas.focusFrame = undefined
  }
  window.removeEventListener('message', onMessage)
  observer?.disconnect()
})
</script>

<template>
  <div ref="stage" class="stage" @keydown.escape="hint = undefined">
    <div class="slide-box" :style="{ width: `${size.width}px`, height: `${size.height}px` }">
      <iframe
        v-if="ready && frameSrc" ref="frame" class="frame" :src="frameSrc" allow="screen-wake-lock; fullscreen"
        :title="t('canvas.slideFrame', { n: deck.currentNo })" @load="onFrameLoad"
      />

      <div v-if="!ready && status?.state !== 'error'" class="overlay" role="status">
        <LoaderCircle :size="22" class="spin" />
        <span>{{ status?.state === 'restarting' ? t('canvas.restarting') : t('canvas.starting') }}</span>
      </div>

      <div v-else-if="status?.state === 'error'" class="overlay error" role="alert">
        <div class="error-head">
          <CircleAlert :size="20" /> <strong>{{ t('canvas.failed') }}</strong>
        </div>
        <p v-if="status.error" class="selectable">{{ status.error }}</p>
        <details v-if="status.log?.length" class="log" open>
          <summary>{{ t('canvas.log') }}</summary>
          <pre class="selectable">{{ status.log.slice(-12).join('\n') }}</pre>
        </details>
        <button class="btn primary" :disabled="retrying" @click="retry">
          <RefreshCw :size="16" :class="{ spin: retrying }" /> {{ t('common.retry') }}
        </button>
      </div>

      <div v-if="ready && status?.state === 'restarting'" class="overlay dim" role="status">
        <LoaderCircle :size="22" class="spin" /> <span>{{ t('canvas.restarting') }}</span>
      </div>
    </div>

    <div v-if="hint" class="code-hint" role="dialog" :aria-label="t('canvas.codeHint')" :style="{ left: `${hint.x}px`, top: `${hint.y}px` }">
      <p>{{ t('canvas.codeHint') }}</p>
      <div class="hint-actions">
        <button class="btn small outline" @click="ui.sourceOpen = true; hint = undefined">
          <FileCode :size="14" /> {{ t('canvas.openSource') }}
        </button>
        <button class="btn small" @click="ui.showRight('agent'); hint = undefined">
          <Sparkles :size="14" /> {{ t('canvas.askAgent') }}
        </button>
      </div>
      <button class="btn icon close" :aria-label="t('common.close')" @click="hint = undefined">
        <X :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  display: grid;
  place-items: center;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-canvas);
}
.slide-box {
  position: relative;
  background: var(--bg-surface);
  box-shadow: var(--slide-shadow);
}
.frame { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  color: var(--text-muted);
  font-size: var(--fs-md);
  text-align: center;
}
.overlay.dim { background: color-mix(in srgb, var(--bg-surface) 70%, transparent); }
.overlay.error { align-items: stretch; justify-content: center; text-align: left; color: var(--text); overflow: auto; }
.error-head { display: flex; align-items: center; gap: 8px; color: var(--danger); font-size: var(--fs-lg); }
.overlay.error p { color: var(--text-muted); }
.overlay.error .btn { align-self: flex-start; }
.log summary { cursor: default; font-size: var(--fs-sm); color: var(--text-muted); margin-bottom: 6px; }
.log pre {
  max-height: 180px;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border-radius: var(--radius);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  white-space: pre-wrap;
}
.code-hint {
  position: absolute;
  z-index: 20;
  width: 320px;
  transform: translateX(-50%);
  padding: 12px 34px 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-surface);
  box-shadow: var(--shadow);
  line-height: 1.45;
}
.hint-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.code-hint .close { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; }
</style>
