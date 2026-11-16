<script setup lang="ts">
import type { LayoutSketch } from '@shared/types'

// Schematic of a layout for picker tiles: dark bars are headings, light bars text, tinted boxes pictures.
defineProps<{ sketch: LayoutSketch }>()
</script>

<template>
  <svg class="sketch" viewBox="0 0 80 45" aria-hidden="true">
    <rect width="80" height="45" class="bg" />
    <template v-if="sketch === 'cover'">
      <rect x="10" y="16" width="44" height="5" class="h" />
      <rect x="10" y="25" width="28" height="3" class="t" />
    </template>
    <template v-else-if="sketch === 'title-body'">
      <rect x="7" y="7" width="38" height="4.5" class="h" />
      <rect x="7" y="16" width="58" height="2.5" class="t" />
      <rect x="7" y="21" width="52" height="2.5" class="t" />
      <rect x="7" y="26" width="56" height="2.5" class="t" />
      <rect x="7" y="31" width="40" height="2.5" class="t" />
    </template>
    <template v-else-if="sketch === 'center' || sketch === 'statement'">
      <rect :x="sketch === 'statement' ? 12 : 18" y="18" :width="sketch === 'statement' ? 56 : 44" height="5" class="h" />
      <rect x="28" y="27" width="24" height="2.5" class="t" />
    </template>
    <template v-else-if="sketch === 'two-cols' || sketch === 'two-cols-header'">
      <rect v-if="sketch === 'two-cols-header'" x="7" y="6" width="40" height="4.5" class="h" />
      <rect x="7" :y="sketch === 'two-cols-header' ? 15 : 7" width="28" height="3.5" :class="sketch === 'two-cols-header' ? 't' : 'h'" />
      <rect x="7" y="22" width="30" height="2.5" class="t" />
      <rect x="7" y="27" width="26" height="2.5" class="t" />
      <rect x="44" :y="sketch === 'two-cols-header' ? 15 : 7" width="28" height="3.5" :class="sketch === 'two-cols-header' ? 't' : 'h'" />
      <rect x="44" y="22" width="30" height="2.5" class="t" />
      <rect x="44" y="27" width="24" height="2.5" class="t" />
      <line x1="40" y1="6" x2="40" y2="39" class="div" />
    </template>
    <template v-else-if="sketch === 'image-left' || sketch === 'image-right'">
      <rect :x="sketch === 'image-left' ? 0 : 40" y="0" width="40" height="45" class="img" />
      <rect :x="sketch === 'image-left' ? 46 : 6" y="12" width="26" height="4" class="h" />
      <rect :x="sketch === 'image-left' ? 46 : 6" y="20" width="28" height="2.5" class="t" />
      <rect :x="sketch === 'image-left' ? 46 : 6" y="25" width="22" height="2.5" class="t" />
    </template>
    <template v-else-if="sketch === 'image-full'">
      <rect x="0" y="0" width="80" height="45" class="img" />
      <path d="M0 36 L22 22 L36 32 L50 24 L80 38 L80 45 L0 45Z" class="img-dark" />
    </template>
    <template v-else-if="sketch === 'section'">
      <rect width="80" height="45" class="accent-bg" />
      <rect x="10" y="20" width="40" height="5" class="on-accent" />
    </template>
    <template v-else-if="sketch === 'quote'">
      <text x="10" y="22" class="quote-mark">“</text>
      <rect x="18" y="16" width="48" height="3.5" class="h" />
      <rect x="18" y="22" width="36" height="3.5" class="h" />
      <rect x="18" y="30" width="18" height="2.5" class="t" />
    </template>
    <template v-else-if="sketch === 'fact'">
      <rect x="24" y="11" width="32" height="12" class="accent" />
      <rect x="26" y="28" width="28" height="2.5" class="t" />
    </template>
    <template v-else-if="sketch === 'end'">
      <rect x="22" y="19" width="36" height="5" class="h" />
      <rect x="32" y="28" width="16" height="2.5" class="t" />
    </template>
    <template v-else-if="sketch === 'iframe'">
      <rect x="6" y="6" width="68" height="33" rx="1.5" class="frame" />
      <rect x="6" y="6" width="68" height="5" class="t" />
      <circle cx="9" cy="8.5" r="1" class="h" />
    </template>
    <template v-else-if="sketch === 'blank'" />
    <template v-else>
      <rect x="7" y="7" width="30" height="4" class="h" />
      <rect x="7" y="16" width="66" height="22" rx="1" class="frame" />
    </template>
  </svg>
</template>

<style scoped>
.sketch { display: block; width: 100%; height: auto; border-radius: 3px; }
.bg { fill: #ffffff; }
.h { fill: #3b4352; }
.t { fill: #c4c9d2; }
.img { fill: #c9d7f3; }
.img-dark { fill: #8fa8dc; }
.accent { fill: var(--accent); opacity: 0.85; }
.accent-bg { fill: var(--accent); }
.on-accent { fill: #ffffff; }
.div { stroke: #dfe2e8; stroke-width: 0.6; }
.frame { fill: none; stroke: #b7bdc8; stroke-width: 0.8; }
.quote-mark { font: 700 16px Georgia, serif; fill: var(--accent); }
</style>
