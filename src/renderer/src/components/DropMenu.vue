<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'

const props = withDefaults(defineProps<{ align?: 'left' | 'right', label?: string }>(), { align: 'left' })
const emit = defineEmits<{ open: [] }>()
const open = ref(false)
const root = ref<HTMLElement>()
const menu = ref<HTMLElement>()

function items() {
  return [...(menu.value?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled), [role="menuitemradio"]:not(:disabled)') ?? [])]
}

async function show(focusFirst = true) {
  if (open.value)
    return
  open.value = true
  emit('open')
  document.addEventListener('mousedown', onOutside, true)
  window.addEventListener('blur', close)
  await nextTick()
  if (focusFirst)
    items()[0]?.focus()
}

function close() {
  if (!open.value)
    return
  open.value = false
  document.removeEventListener('mousedown', onOutside, true)
  window.removeEventListener('blur', close)
}

function toggle() {
  if (open.value)
    close()
  else
    void show()
}

function onOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node))
    close()
}

function onKey(e: KeyboardEvent) {
  if (!open.value)
    return
  const list = items()
  const index = list.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
    root.value?.querySelector<HTMLElement>('[aria-haspopup]')?.focus()
  }
  else if (e.key === 'ArrowDown') {
    e.preventDefault()
    list[(index + 1) % list.length]?.focus()
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    list[(index - 1 + list.length) % list.length]?.focus()
  }
  else if (e.key === 'Tab') {
    close()
  }
}

function onMenuClick(e: MouseEvent) {
  // Clicking an item closes the menu; items that should keep it open stop propagation.
  if ((e.target as HTMLElement).closest('.menu-item, [role="menuitemradio"]'))
    close()
}

onBeforeUnmount(close)
defineExpose({ show, close, toggle })
</script>

<template>
  <div ref="root" class="dropmenu" @keydown="onKey">
    <slot name="trigger" :open="open" :toggle="toggle" />
    <div
      v-if="open" ref="menu" class="menu" role="menu" :aria-label="props.label"
      :class="props.align === 'right' ? 'align-right' : 'align-left'" @click="onMenuClick"
    >
      <slot :close="close" />
    </div>
  </div>
</template>

<style scoped>
.dropmenu { position: relative; display: inline-flex; }
.menu { top: calc(100% + 4px); }
.align-left { left: 0; }
.align-right { right: 0; }
</style>
