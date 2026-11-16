<script setup lang="ts">
// One tooltip for the whole window. Elements opt in with data-tip="text"; it shows on hover
// after a short delay and immediately on keyboard focus, and Escape hides it.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const text = ref('')
const pos = ref({ x: 0, y: 0, below: true })
let target: HTMLElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined

function place(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const below = r.bottom + 40 < window.innerHeight
  pos.value = { x: Math.min(Math.max(r.left + r.width / 2, 80), window.innerWidth - 80), y: below ? r.bottom + 6 : r.top - 6, below }
}

function show(el: HTMLElement, delay: number) {
  clearTimeout(timer)
  target = el
  timer = setTimeout(() => {
    if (target !== el || !el.isConnected)
      return
    text.value = el.dataset.tip ?? ''
    place(el)
  }, delay)
}

function hide() {
  clearTimeout(timer)
  target = null
  text.value = ''
}

function onOver(e: Event) {
  const el = (e.target as HTMLElement).closest?.<HTMLElement>('[data-tip]')
  if (el && el !== target)
    show(el, text.value ? 0 : 450)
  else if (!el && target)
    hide()
}
function onFocus(e: FocusEvent) {
  const el = (e.target as HTMLElement).closest?.<HTMLElement>('[data-tip]')
  if (el && el.matches(':focus-visible'))
    show(el, 0)
  else
    hide()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape')
    hide()
}

onMounted(() => {
  document.addEventListener('mouseover', onOver)
  document.addEventListener('focusin', onFocus)
  document.addEventListener('focusout', hide)
  document.addEventListener('mousedown', hide, true)
  document.addEventListener('keydown', onKey)
  window.addEventListener('blur', hide)
})
onBeforeUnmount(() => {
  document.removeEventListener('mouseover', onOver)
  document.removeEventListener('focusin', onFocus)
  document.removeEventListener('focusout', hide)
  document.removeEventListener('mousedown', hide, true)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('blur', hide)
})
</script>

<template>
  <div
    v-if="text" class="tooltip" role="tooltip"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px`, transform: pos.below ? 'translateX(-50%)' : 'translate(-50%, -100%)' }"
  >
    {{ text }}
  </div>
</template>

<style scoped>
.tooltip {
  position: fixed;
  z-index: 300;
  max-width: 280px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: #20242d;
  color: #f2f3f6;
  font-size: var(--fs-sm);
  line-height: 1.35;
  pointer-events: none;
  box-shadow: var(--shadow-sm);
}
</style>
