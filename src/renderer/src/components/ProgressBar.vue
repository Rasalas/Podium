<script setup lang="ts">
defineProps<{ fraction?: number, label?: string }>()
</script>

<template>
  <div
    class="bar" role="progressbar" :aria-label="label"
    :aria-valuenow="fraction !== undefined ? Math.round(fraction * 100) : undefined" aria-valuemin="0" aria-valuemax="100"
  >
    <div v-if="fraction !== undefined" class="fill" :style="{ width: `${Math.max(3, fraction * 100)}%` }" />
    <div v-else class="fill indeterminate" />
  </div>
</template>

<style scoped>
.bar { position: relative; height: 6px; overflow: hidden; border-radius: 3px; background: var(--bg-active); }
.fill { height: 100%; border-radius: 3px; background: var(--accent); transition: width 0.3s ease; }
.indeterminate { position: absolute; width: 35%; animation: slide 1.3s ease-in-out infinite; }
@keyframes slide { from { left: -35%; } to { left: 100%; } }
</style>
