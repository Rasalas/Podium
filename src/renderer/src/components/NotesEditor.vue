<script setup lang="ts">
// Speaker notes as plain text. Slidev's click markers ("[click]", "[click:3]") stay in the
// file as they are and show here as numbered chips, so nobody has to type brackets.
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState, Prec, RangeSetBuilder } from '@codemirror/state'
import { Decoration, drawSelection, EditorView, keymap, placeholder as cmPlaceholder, ViewPlugin, WidgetType } from '@codemirror/view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ modelValue: string, label: string, placeholder?: string, clickLabel: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string], 'focus': [], 'blur': [] }>()
const host = ref<HTMLElement>()
let view: EditorView | undefined
let applyingExternal = false

const RE_CLICK = /\[click(?::(\d+))?\]/g

class ClickChip extends WidgetType {
  constructor(readonly step: number, readonly label: string) {
    super()
  }

  override eq(other: ClickChip) {
    return other.step === this.step && other.label === this.label
  }

  toDOM() {
    const chip = document.createElement('span')
    chip.className = 'click-chip'
    chip.textContent = `${this.label} ${this.step}`
    return chip
  }

  override ignoreEvent() {
    return false
  }
}

/** Numbered the way Slidev counts: "[click]" is the next step, "[click:5]" jumps to step 5. */
function clickChips(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  let step = 0
  for (const match of state.doc.toString().matchAll(RE_CLICK)) {
    step = match[1] ? Number(match[1]) : step + 1
    builder.add(match.index, match.index + match[0].length, Decoration.replace({ widget: new ClickChip(step, props.clickLabel) }))
  }
  return builder.finish()
}

const chips = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(editor: EditorView) {
    this.decorations = clickChips(editor.state)
  }

  update(update: ViewUpdate) {
    if (update.docChanged)
      this.decorations = clickChips(update.state)
  }
}, {
  decorations: plugin => plugin.decorations,
  // The caret steps over a chip and Backspace removes it whole.
  provide: plugin => EditorView.atomicRanges.of(editor => editor.plugin(plugin)?.decorations ?? Decoration.none),
})

/** Start the next click step here: on a line of its own unless the caret already is at a line start. */
function insertClickMarker(editor: EditorView): boolean {
  const { from, to } = editor.state.selection.main
  const line = editor.state.doc.lineAt(from)
  const before = line.text.slice(0, from - line.from)
  const lead = before.trim() ? '\n' : ''
  const insert = `${lead}[click] `
  editor.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: 'input' })
  editor.focus()
  return true
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--fs-md)', backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { padding: '2px 12px 10px', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-placeholder': { color: 'var(--text-faint)' },
  '.click-chip': {
    display: 'inline-block',
    margin: '0 4px 0 0',
    padding: '0 7px',
    borderRadius: '999px',
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--accent)',
    fontSize: 'var(--fs-xs)',
    fontWeight: '600',
    lineHeight: '1.6',
    verticalAlign: '1px',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
})

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        history(),
        drawSelection(),
        Prec.high(keymap.of([{ key: 'Mod-Enter', run: insertClickMarker }])),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        chips,
        theme,
        cmPlaceholder(props.placeholder ?? ''),
        EditorView.contentAttributes.of({ 'aria-label': props.label, 'spellcheck': 'true', 'autocorrect': 'on' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal)
            emit('update:modelValue', update.state.doc.toString())
          if (update.focusChanged && update.view.hasFocus)
            emit('focus')
          else if (update.focusChanged)
            emit('blur')
        }),
      ],
    }),
  })
})

function show(value: string) {
  if (!view || value === view.state.doc.toString())
    return
  applyingExternal = true
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  applyingExternal = false
}

// Outside changes (agent, undo) replace the text unless the user is typing here.
watch(() => props.modelValue, (value) => {
  if (view && !view.hasFocus)
    show(value)
})

onBeforeUnmount(() => view?.destroy())

defineExpose({
  /** Force the editor to show `value`, used when switching slides while focused. */
  reset: show,
  insertClick() {
    if (view)
      insertClickMarker(view)
  },
  /** Height the whole text needs, for fitting the panel to it. */
  contentHeight: () => view?.contentHeight ?? 0,
})
</script>

<template>
  <div ref="host" class="notes-editor" />
</template>

<style scoped>
.notes-editor { flex: 1; min-height: 0; overflow: hidden; }
.notes-editor:focus-within { box-shadow: inset 0 0 0 2px var(--accent); }
</style>
