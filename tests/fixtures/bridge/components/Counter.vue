<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <button class="pd-counter" @click="count++">Zähler {{ count }}</button>
</template>
