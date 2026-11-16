<script setup lang="ts">
import { computed } from 'vue'
import { backgroundStyle } from '../layoutHelper'

const props = defineProps({
  background: { type: String, default: '' },
  class: { type: String },
})
const style = computed(() => backgroundStyle(props.background, 'cover', true))
</script>

<template>
  <div class="slidev-layout cover" :class="[props.class, { 'has-image': !!props.background && !props.background.startsWith('#') }]" :style="style">
    <div class="cover-body">
      <slot />
    </div>
  </div>
</template>
