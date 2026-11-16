<script setup lang="ts">
interface Props {
  background?: string
  author?: string
  class?: string
}
defineProps<Props>()
</script>

<template>
  <div class="cover"><slot /><slot name="author" /></div>
</template>
