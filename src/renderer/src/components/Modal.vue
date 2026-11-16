<script setup lang="ts">
import { X } from '@lucide/vue'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '../i18n'

const props = withDefaults(defineProps<{ title: string, width?: number, closable?: boolean }>(), { width: 520, closable: true })
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
let returnFocus: HTMLElement | null = null
const titleId = `modal-${Math.random().toString(36).slice(2)}`

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.closable) {
    e.stopPropagation()
    emit('close')
  }
  if (e.key === 'Tab' && panel.value) {
    // Keep focus inside the dialog.
    const items = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!items.length)
      return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    }
    else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

onMounted(async () => {
  returnFocus = document.activeElement as HTMLElement | null
  await nextTick()
  const auto = panel.value?.querySelector<HTMLElement>('[autofocus]') ?? panel.value?.querySelector<HTMLElement>(`.modal-body ${FOCUSABLE}`)
  ;(auto ?? panel.value)?.focus()
})
onBeforeUnmount(() => returnFocus?.focus?.())
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @mousedown.self="closable && emit('close')">
      <div
        ref="panel" class="modal" role="dialog" aria-modal="true" :aria-labelledby="titleId"
        :style="{ width: `min(${width}px, calc(100vw - 32px))` }" tabindex="-1" @keydown="onKey"
      >
        <header class="modal-head">
          <h2 :id="titleId">{{ title }}</h2>
          <button v-if="closable" class="btn icon" :aria-label="t('common.close')" data-tip-skip @click="emit('close')">
            <X :size="18" />
          </button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="modal-foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: var(--scrim);
  animation: fade 0.12s ease-out;
}
.modal {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 48px);
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  animation: rise 0.14s ease-out;
}
.modal:focus-visible { box-shadow: var(--shadow-lg); }
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 8px 24px;
}
.modal-head h2 { font-size: var(--fs-lg); font-weight: 650; }
.modal-body { padding: 8px 24px 20px; overflow: auto; }
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 24px;
  border-top: 1px solid var(--border);
}
@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
</style>
