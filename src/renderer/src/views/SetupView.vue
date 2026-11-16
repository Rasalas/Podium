<script setup lang="ts">
import { CircleAlert, RefreshCw } from '@lucide/vue'
import { computed } from 'vue'
import ProgressBar from '../components/ProgressBar.vue'
import { t } from '../i18n'
import { useAppStore } from '../stores/app'

const app = useAppStore()
const fraction = computed(() => app.runtimeProgress?.fraction)
</script>

<template>
  <main class="setup">
    <section class="card" aria-live="polite">
      <template v-if="!app.runtimeError">
        <h1>{{ t('setup.title') }}</h1>
        <p class="intro">{{ t('setup.intro') }}</p>
        <ProgressBar :fraction="fraction" :label="t('setup.title')" />
        <div class="status">
          <span>{{ app.runtimeProgress?.message ?? t('common.loading') }}</span>
          <span v-if="fraction !== undefined" class="pct">{{ Math.round(fraction * 100) }} %</span>
        </div>
        <p class="hint">{{ t('setup.working') }}</p>
      </template>
      <template v-else>
        <h1 class="failed"><CircleAlert :size="22" /> {{ t('setup.failed') }}</h1>
        <p class="intro">{{ t('setup.failedHint') }}</p>
        <p class="error selectable">{{ app.runtimeError }}</p>
        <div class="actions">
          <button class="btn primary large" autofocus @click="app.setupRuntime()">
            <RefreshCw :size="16" /> {{ t('common.retry') }}
          </button>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.setup { display: grid; place-items: center; height: 100%; padding: 24px; }
.card { width: min(520px, 100%); }
.app-name { font-size: var(--fs-md); font-weight: 700; color: var(--accent-ink); margin-bottom: 10px; }
h1 { display: flex; align-items: center; gap: 10px; font-size: var(--fs-xxl); font-weight: 650; margin-bottom: 10px; }
.failed { color: var(--danger); }
.intro { font-size: var(--fs-md); color: var(--text-muted); line-height: 1.55; margin-bottom: 24px; }
.status { display: flex; justify-content: space-between; margin-top: 10px; font-size: var(--fs); }
.pct { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.hint { margin-top: 24px; }
.error { padding: 10px 12px; border-radius: var(--radius); background: var(--danger-soft); font-size: var(--fs); margin-bottom: 20px; }
.actions { display: flex; gap: 8px; }
</style>
