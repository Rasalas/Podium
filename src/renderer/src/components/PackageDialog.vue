<script setup lang="ts">
import { Package, ShieldAlert, ShieldCheck } from '@lucide/vue'
import { t } from '../i18n'
import { useAppStore } from '../stores/app'
import Modal from './Modal.vue'
import ProgressBar from './ProgressBar.vue'

const app = useAppStore()
</script>

<template>
  <Modal v-if="app.packagePrompt" :title="t('packages.title')" :width="520" @close="app.answerPackagePrompt(false)">
    <p class="intro">{{ t('packages.intro') }}</p>
    <ul class="list">
      <li v-for="pkg in app.packagePrompt.packages" :key="pkg.name">
        <Package :size="18" class="pkg-icon" />
        <div class="pkg">
          <span class="name selectable">{{ pkg.name }}</span>
          <span class="kind">{{ t(`packages.kind.${pkg.kind}`) }}</span>
        </div>
        <span class="trust" :class="{ trusted: pkg.trusted }">
          <ShieldCheck v-if="pkg.trusted" :size="14" />
          <ShieldAlert v-else :size="14" />
          {{ pkg.trusted ? t('packages.trusted') : t('packages.untrusted') }}
        </span>
      </li>
    </ul>
    <p class="warning">{{ t('packages.warning') }}</p>
    <template #footer>
      <button class="btn outline" @click="app.answerPackagePrompt(false)">{{ t('common.cancel') }}</button>
      <button class="btn primary" autofocus @click="app.answerPackagePrompt(true)">{{ t('packages.install') }}</button>
    </template>
  </Modal>

  <Modal v-else-if="app.installing" :title="t('packages.installing')" :width="460" :closable="false">
    <ProgressBar :fraction="app.packageProgress?.fraction" :label="t('packages.installing')" />
    <p class="status" aria-live="polite">{{ app.packageProgress?.message ?? app.installing.join(', ') }}</p>
  </Modal>
</template>

<style scoped>
.intro { margin-bottom: 12px; font-size: var(--fs-md); }
.list { display: flex; flex-direction: column; gap: 6px; margin: 0 0 16px; padding: 0; list-style: none; }
.list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.pkg-icon { color: var(--text-muted); flex: none; }
.pkg { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.name { font-family: var(--font-mono); font-size: var(--fs-sm); overflow-wrap: anywhere; }
.kind { font-size: var(--fs-sm); color: var(--text-muted); }
.trust { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-sm); font-weight: 600; color: var(--warn); white-space: nowrap; }
.trust.trusted { color: var(--success); }
.warning {
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--warn-soft);
  line-height: 1.5;
}
.status { margin-top: 10px; color: var(--text-muted); }
</style>
