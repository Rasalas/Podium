<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, LoaderCircle, X } from '@lucide/vue'
import { t } from '../i18n'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="toast in ui.toasts" :key="toast.id" class="toast" :class="toast.kind" :role="toast.kind === 'error' ? 'alert' : 'status'">
        <span class="icon">
          <CircleAlert v-if="toast.kind === 'error'" :size="18" />
          <CircleCheck v-else-if="toast.kind === 'success'" :size="18" />
          <LoaderCircle v-else-if="toast.kind === 'progress'" :size="18" class="spin" />
          <Info v-else :size="18" />
        </span>
        <div class="text">
          <div class="message">{{ toast.message }}</div>
          <div v-if="toast.detail" class="detail selectable">{{ toast.detail }}</div>
        </div>
        <button v-if="toast.action" class="btn small action" @click="toast.action.run(); ui.dismiss(toast.id)">
          {{ toast.action.label }}
        </button>
        <button v-if="toast.kind !== 'progress'" class="btn icon close" :aria-label="t('common.close')" @click="ui.dismiss(toast.id)">
          <X :size="15" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: min(420px, calc(100vw - 32px));
  padding: 10px 8px 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-surface);
  box-shadow: var(--shadow);
  pointer-events: auto;
}
.icon { display: flex; padding-top: 1px; color: var(--text-muted); }
.error { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.error .icon { color: var(--danger); }
.success .icon { color: var(--success); }
.progress .icon { color: var(--accent); }
.text { flex: 1; min-width: 0; padding-top: 1px; }
.message { font-weight: 600; }
.detail { margin-top: 2px; color: var(--text-muted); font-size: var(--fs-sm); overflow-wrap: anywhere; }
.action { color: var(--accent-ink); font-weight: 600; }
.close { width: 24px; height: 24px; color: var(--text-faint); }
.toast-enter-active, .toast-leave-active { transition: opacity 0.15s, transform 0.15s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(6px); }
</style>
