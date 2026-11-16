<script setup lang="ts">
// Props as a TS type literal
const props = defineProps<{
  heroImage?: string
  homepageUrl: string
  highlight?: boolean
  columns?: number
  accentColor?: string
}>()
</script>

<template>
  <div class="cards">
    <header><slot name="header" /></header>
    <slot />
    <aside><slot name="side" /></aside>
    <footer><slot :name="dynamic" /></footer>
  </div>
</template>
