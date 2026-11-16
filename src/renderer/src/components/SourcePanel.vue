<script setup lang="ts">
import { CircleAlert, X } from '@lucide/vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { parse as parseYaml } from 'yaml'
import { api, errorMessage } from '../api'
import { t } from '../i18n'
import { createDebouncedSave } from '../lib/debounce'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'
import CodeEditor from './CodeEditor.vue'

const deck = useDeckStore()
const ui = useUiStore()
const content = ref(deck.current?.content ?? '')
const frontmatter = ref(deck.current?.frontmatterRaw ?? '')
const yamlError = ref<string>()
const contentEditor = ref<InstanceType<typeof CodeEditor>>()
const fmEditor = ref<InstanceType<typeof CodeEditor>>()

const contentSaver = createDebouncedSave<number>((no, value) => deck.apply({ type: 'updateSlide', no, content: value }), 500)

const fmSaver = createDebouncedSave<number>(async (no, value) => {
  const id = deck.deckId
  if (!id)
    return
  try {
    const result = await api().applyOp(id, { type: 'updateSlide', no, frontmatterRaw: value })
    yamlError.value = undefined
    deck.accept(result.snapshot, result.select)
  }
  catch (err) {
    // Shown next to the editor; the typed text stays as it is.
    yamlError.value = errorMessage(err)
  }
}, 700)

watch(() => deck.current?.id, () => {
  void contentSaver.flush()
  void fmSaver.flush()
  yamlError.value = undefined
  content.value = deck.current?.content ?? ''
  frontmatter.value = deck.current?.frontmatterRaw ?? ''
  contentEditor.value?.reset(content.value)
  fmEditor.value?.reset(frontmatter.value)
})

watch(() => deck.current?.content, (value) => {
  if (!contentSaver.pending)
    content.value = value ?? ''
})
watch(() => deck.current?.frontmatterRaw, (value) => {
  if (!fmSaver.pending && !yamlError.value)
    frontmatter.value = value ?? ''
})

function onContent(value: string) {
  content.value = value
  if (deck.current)
    contentSaver.schedule(deck.currentNo, value)
}

function onFrontmatter(value: string) {
  frontmatter.value = value
  if (!deck.current)
    return
  try {
    const parsed: unknown = value.trim() ? parseYaml(value) : {}
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed)))
      throw new Error(t('source.yamlError', { msg: 'key: value' }))
    yamlError.value = undefined
    fmSaver.schedule(deck.currentNo, value)
  }
  catch (err) {
    fmSaver.cancel()
    yamlError.value = errorMessage(err).split('\n')[0]
  }
}

onBeforeUnmount(() => {
  void contentSaver.flush()
  void fmSaver.flush()
})
</script>

<template>
  <section class="source" :aria-label="t('source.title', { n: deck.currentNo })">
    <header class="head">
      <h2 class="section-title">{{ t('source.title', { n: deck.currentNo }) }}</h2>
      <span v-if="deck.current?.imported" class="hint">{{ t('source.imported', { file: deck.current.filepath }) }}</span>
      <button class="btn icon close" :aria-label="t('source.close')" :data-tip="t('source.close')" @click="ui.sourceOpen = false">
        <X :size="16" />
      </button>
    </header>
    <div class="editors">
      <div class="pane main">
        <div class="pane-label">{{ t('source.content') }}</div>
        <CodeEditor ref="contentEditor" :model-value="content" language="markdown" :label="t('source.content')" @update:model-value="onContent" />
      </div>
      <div class="pane side" :class="{ invalid: yamlError }">
        <div class="pane-label">{{ t('source.frontmatter') }}</div>
        <CodeEditor ref="fmEditor" :model-value="frontmatter" language="yaml" :label="t('source.frontmatter')" placeholder="layout: center" @update:model-value="onFrontmatter" />
        <p v-if="yamlError" class="yaml-error" role="alert">
          <CircleAlert :size="14" /> <span>{{ t('source.yamlError', { msg: yamlError }) }}</span>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.source {
  display: flex;
  flex-direction: column;
  height: 42%;
  min-height: 180px;
  flex: none;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
}
.head { display: flex; align-items: center; gap: 12px; height: 32px; padding: 0 4px 0 12px; border-bottom: 1px solid var(--border); }
.head .hint { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.close { margin-left: auto; width: 26px; height: 26px; }
.editors { display: flex; flex: 1; min-height: 0; }
.pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.main { flex: 2; border-right: 1px solid var(--border); }
.side { flex: 1; }
.pane > :deep(.code-editor) { flex: 1; }
.pane-label { padding: 4px 12px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-faint); background: var(--bg-panel); border-bottom: 1px solid var(--border); }
.invalid .pane-label { color: var(--danger); }
.yaml-error {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin: 0;
  padding: 8px 12px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: 1.4;
}
.yaml-error svg { flex: none; margin-top: 2px; }
</style>
