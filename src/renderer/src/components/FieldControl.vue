<script setup lang="ts">
import type { LayoutField } from '@shared/types'
import { ImagePlus, Trash2 } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { api } from '../api'
import { t } from '../i18n'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'

const props = defineProps<{ field: LayoutField, value: unknown }>()
const emit = defineEmits<{ change: [value: unknown] }>()
const deck = useDeckStore()
const ui = useUiStore()
const id = `field-${props.field.key}`

const effective = computed(() => props.value ?? props.field.default)
const text = ref(String(effective.value ?? ''))
watch(effective, (v) => {
  text.value = v === undefined || v === null ? '' : String(v)
})

const imageUrl = computed(() => {
  const v = typeof props.value === 'string' ? props.value : ''
  if (!v)
    return ''
  return v.startsWith('/') && deck.server?.url ? deck.server.url + v : v
})

function commitText() {
  const raw = text.value.trim()
  const current = effective.value === undefined || effective.value === null ? '' : String(effective.value)
  if (raw === current)
    return
  if (!raw)
    emit('change', null)
  else if (props.field.type === 'number')
    emit('change', Number.isFinite(Number(raw)) ? Number(raw) : raw)
  else
    emit('change', raw)
}

async function chooseImage() {
  const deckId = deck.deckId
  if (!deckId)
    return
  const src = await ui.attempt(() => api().importImage(deckId))
  if (src)
    emit('change', src)
}
</script>

<template>
  <div class="field">
    <template v-if="field.type === 'boolean'">
      <label class="check">
        <input type="checkbox" :checked="Boolean(effective)" @change="emit('change', ($event.target as HTMLInputElement).checked)">
        <span>{{ field.label }}</span>
      </label>
    </template>
    <template v-else>
      <label class="label" :for="id">{{ field.label }}</label>
      <div v-if="field.type === 'image'" class="image">
        <div class="preview">
          <img v-if="imageUrl" :src="imageUrl" alt="">
          <span v-else class="none">{{ t('inspector.noImage') }}</span>
        </div>
        <div class="image-actions">
          <button :id="id" class="btn outline small" @click="chooseImage">
            <ImagePlus :size="14" /> {{ t('inspector.chooseImage') }}
          </button>
          <button v-if="value" class="btn small icon danger" :aria-label="t('inspector.removeImage')" :data-tip="t('inspector.removeImage')" @click="emit('change', null)">
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
      <select
        v-else-if="field.type === 'select'" :id="id" class="select" :value="effective ?? ''"
        @change="emit('change', ($event.target as HTMLSelectElement).value || null)"
      >
        <option v-for="opt in field.options ?? []" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <div v-else-if="field.type === 'color'" class="color">
        <input
          :id="id" type="color" class="swatch" :value="typeof effective === 'string' && /^#[0-9a-f]{6}$/i.test(effective) ? effective : '#000000'"
          @change="emit('change', ($event.target as HTMLInputElement).value)"
        >
        <input v-model="text" class="input" :aria-label="field.label" @change="commitText">
      </div>
      <textarea v-else-if="field.type === 'longtext'" :id="id" v-model="text" class="textarea" rows="3" @change="commitText" />
      <input
        v-else :id="id" v-model="text" class="input" :type="field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'"
        :placeholder="field.type === 'url' ? 'https://' : undefined" @change="commitText" @keydown.enter="commitText"
      >
    </template>
    <p v-if="field.description" class="hint">{{ field.description }}</p>
  </div>
</template>

<style scoped>
.field { display: flex; flex-direction: column; }
.check { display: flex; align-items: center; gap: 8px; font-size: var(--fs); }
.check input { width: 16px; height: 16px; accent-color: var(--accent); }
.image { display: flex; flex-direction: column; gap: 6px; }
.preview {
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
}
.preview img { width: 100%; height: 100%; object-fit: cover; }
.none { font-size: var(--fs-sm); color: var(--text-faint); }
.image-actions { display: flex; gap: 4px; }
.image-actions .icon { width: 24px; }
.color { display: flex; gap: 6px; }
.swatch { width: 36px; height: var(--control-h); padding: 2px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--bg-surface); flex: none; }
.hint { margin-top: 4px; }
</style>
