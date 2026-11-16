<script setup lang="ts">
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap, lineNumbers, placeholder as cmPlaceholder } from '@codemirror/view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ modelValue: string, language: 'markdown' | 'yaml', label: string, placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const host = ref<HTMLElement>()
let view: EditorView | undefined
let applyingExternal = false

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--bg-surface)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'var(--bg-panel)', color: 'var(--text-faint)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-placeholder': { color: 'var(--text-faint)' },
})

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        props.language === 'markdown' ? markdown() : yaml(),
        EditorView.lineWrapping,
        theme,
        cmPlaceholder(props.placeholder ?? ''),
        EditorView.contentAttributes.of({ 'aria-label': props.label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal)
            emit('update:modelValue', update.state.doc.toString())
        }),
      ],
    }),
  })
})

// Outside changes (canvas edits, agent, undo) replace the text unless the user is typing here.
watch(() => props.modelValue, (value) => {
  if (!view || view.hasFocus || value === view.state.doc.toString())
    return
  applyingExternal = true
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  applyingExternal = false
})

onBeforeUnmount(() => view?.destroy())

defineExpose({
  /** Force the editor to show `value`, used when switching slides while focused. */
  reset(value: string) {
    if (!view || value === view.state.doc.toString())
      return
    applyingExternal = true
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    applyingExternal = false
  },
})
</script>

<template>
  <div ref="host" class="code-editor" />
</template>

<style scoped>
.code-editor { height: 100%; min-height: 0; overflow: hidden; }
</style>
