<script setup lang="ts">
import { computed } from 'vue'
import { backgroundStyle } from '../layoutHelper'

const props = defineProps({
  image: { type: String },
  class: { type: String },
  backgroundSize: { type: String, default: 'cover' },
})
const style = computed(() => backgroundStyle(props.image, props.backgroundSize))
</script>

<template>
  <div class="klar-image-split">
    <div class="slidev-layout default" :class="props.class"><slot /></div>
    <div class="image-pane" :style="style" />
  </div>
</template>
