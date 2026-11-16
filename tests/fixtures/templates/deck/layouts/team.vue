<script setup lang="ts">
defineProps({ portrait: String })
</script>
<template><div><slot /><slot name="members" /></div></template>
