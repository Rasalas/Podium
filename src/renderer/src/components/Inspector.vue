<script setup lang="ts">
import { LayoutTemplate, X } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { changeTemplate } from '../actions'
import { t } from '../i18n'
import { useAppStore } from '../stores/app'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'
import FieldControl from './FieldControl.vue'
import LayoutSketch from './LayoutSketch.vue'

const app = useAppStore()
const deck = useDeckStore()
const ui = useUiStore()

onMounted(() => {
  if (!app.templates.length)
    void app.loadTemplates()
})

const layout = computed(() => deck.currentLayout)
const slots = computed(() => layout.value?.slots ?? [])
const aspect = computed(() => String(deck.snapshot?.headmatter.aspectRatio ?? '16/9').replace(/\s/g, ''))
const templates = computed(() => {
  const list = [...app.templates]
  const theme = deck.snapshot?.theme
  // A deck can name a theme that is not in the catalogue; keep it selectable.
  if (theme && !list.some(tpl => tpl.id === theme))
    list.push({ id: theme, packageName: theme, label: theme, description: '', builtin: false, installed: true })
  return list
})

function setField(key: string, value: unknown) {
  if (!deck.current)
    return
  void deck.apply({ type: 'updateSlide', no: deck.currentNo, frontmatter: { [key]: value } })
}

const templateKey = ref(0)
async function onTemplate(id: string) {
  await changeTemplate(id)
  // Re-render the select so a cancelled change shows the deck's real template again.
  templateKey.value++
}

function setAspect(value: string) {
  if (value !== aspect.value)
    void deck.apply({ type: 'setHeadmatter', patch: { aspectRatio: value } })
}
</script>

<template>
  <div class="inspector">
    <header class="panel-head">
      <h2>{{ t('editor.inspector') }}</h2>
      <button class="btn icon" :aria-label="t('inspector.collapse')" :data-tip="t('inspector.collapse')" @click="ui.rightCollapsed = true">
        <X :size="16" />
      </button>
    </header>

    <div class="scroll">
      <section v-if="deck.current" class="section">
        <h3 class="section-title">{{ t('inspector.layout') }} · {{ t('slides.slideN', { n: deck.currentNo }) }}</h3>
        <div class="layout-row">
          <div class="layout-tile">
            <LayoutSketch :sketch="layout?.sketch ?? 'generic'" />
          </div>
          <div class="layout-info">
            <span class="layout-name">{{ layout?.label ?? deck.current.layout }}</span>
            <button class="btn outline small" aria-haspopup="dialog" @click="ui.layoutPicker = 'change'">
              <LayoutTemplate :size="14" /> {{ t('inspector.changeLayout') }}
            </button>
          </div>
        </div>
        <p v-if="slots.length > 1" class="hint slots">
          {{ t('inspector.areasHint', { list: slots.map(s => s.label).join(', ') }) }}
        </p>
      </section>
      <section v-else class="section">
        <p class="hint">{{ t('inspector.noSlide') }}</p>
      </section>

      <section v-if="deck.current && layout?.fields.length" class="section">
        <h3 class="section-title">{{ t('inspector.fields') }}</h3>
        <div class="fields">
          <FieldControl
            v-for="field in layout.fields" :key="`${deck.current.id}-${field.key}`" :field="field"
            :value="deck.current.frontmatter[field.key]" @change="setField(field.key, $event)"
          />
        </div>
      </section>

      <section class="section">
        <h3 class="section-title">{{ t('inspector.deck') }}</h3>
        <div class="fields">
          <div>
            <label class="label" for="insp-template">{{ t('inspector.template') }}</label>
            <select id="insp-template" :key="templateKey" class="select" :value="deck.snapshot?.theme" @change="onTemplate(($event.target as HTMLSelectElement).value)">
              <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">
                {{ tpl.label }}{{ tpl.installed ? '' : ` (${t('newDeck.needsDownload')})` }}
              </option>
            </select>
          </div>
          <div>
            <span id="insp-aspect" class="label">{{ t('inspector.aspect') }}</span>
            <div class="segmented" role="radiogroup" aria-labelledby="insp-aspect">
              <button role="radio" :aria-checked="aspect === '16/9'" :class="{ on: aspect === '16/9' }" @click="setAspect('16/9')">
                {{ t('inspector.aspectWide') }}
              </button>
              <button role="radio" :aria-checked="aspect === '4/3'" :class="{ on: aspect === '4/3' }" @click="setAspect('4/3')">
                {{ t('inspector.aspectClassic') }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.inspector { display: flex; flex-direction: column; height: 100%; }
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 6px 0 14px;
  border-bottom: 1px solid var(--border);
}
.panel-head h2 { font-size: var(--fs-md); font-weight: 650; }
.scroll { flex: 1; overflow-y: auto; }
.section { padding: 14px; border-bottom: 1px solid var(--border); }
.section-title { margin-bottom: 10px; }
.layout-row { display: flex; gap: 12px; align-items: center; }
.layout-tile { width: 96px; flex: none; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.layout-info { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
.layout-name { font-weight: 600; font-size: var(--fs-md); }
.slots { margin-top: 10px; line-height: 1.45; }
.fields { display: flex; flex-direction: column; gap: 14px; }
.segmented { display: flex; border: 1px solid var(--border-strong); border-radius: var(--radius); overflow: hidden; }
.segmented button {
  flex: 1;
  height: 28px;
  border: 0;
  background: var(--bg-surface);
  font-size: var(--fs-sm);
}
.segmented button + button { border-left: 1px solid var(--border-strong); }
.segmented button:hover:not(.on) { background: var(--bg-hover); }
.segmented button.on { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.segmented button:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); border-radius: 0; }
</style>
