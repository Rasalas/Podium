<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AgentPanel from '../components/AgentPanel.vue'
import CheckPanel from '../components/CheckPanel.vue'
import Inspector from '../components/Inspector.vue'
import LayoutPicker from '../components/LayoutPicker.vue'
import NotesPanel from '../components/NotesPanel.vue'
import PresentBanner from '../components/PresentBanner.vue'
import SlideCanvas from '../components/SlideCanvas.vue'
import SlideList from '../components/SlideList.vue'
import SourcePanel from '../components/SourcePanel.vue'
import Toolbar from '../components/Toolbar.vue'
import { useDeckStore } from '../stores/deck'
import { useUiStore } from '../stores/ui'

const deck = useDeckStore()
const ui = useUiStore()

// Below this width the right column floats over the canvas and starts closed.
const NARROW = 1200
const narrow = ref(window.innerWidth < NARROW)
function onResize() {
  narrow.value = window.innerWidth < NARROW
}
watch(narrow, (isNarrow) => {
  ui.rightCollapsed = isNarrow
}, { immediate: true })

function onRightKey(e: KeyboardEvent) {
  if (narrow.value && e.key === 'Escape' && !e.defaultPrevented)
    ui.rightCollapsed = true
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>

<template>
  <div class="editor">
    <Toolbar />
    <PresentBanner v-if="deck.presentation.active && deck.presentation.deckId === deck.deckId" />
    <div class="workspace" :class="{ narrow }">
      <SlideList />
      <main class="center">
        <SlideCanvas />
        <SourcePanel v-if="ui.sourceOpen" />
        <NotesPanel v-else />
        <CheckPanel v-if="ui.checkOpen" />
      </main>
      <aside
        v-if="!ui.rightCollapsed" class="right" :class="{ floating: narrow, wide: ui.rightPanel === 'agent' }"
        @keydown="onRightKey"
      >
        <AgentPanel v-if="ui.rightPanel === 'agent'" />
        <Inspector v-else />
      </aside>
    </div>
    <LayoutPicker v-if="ui.layoutPicker" />
  </div>
</template>

<style scoped>
.editor { display: flex; flex-direction: column; height: 100%; min-width: 0; }
.workspace { position: relative; display: flex; flex: 1; min-height: 0; }
.center { position: relative; display: flex; flex-direction: column; flex: 1; min-width: 0; }
.right {
  width: 280px;
  flex: none;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  overflow: hidden;
}
.right.wide { width: 340px; }
.right.floating {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  box-shadow: var(--shadow-lg);
}
@media (max-width: 1060px) {
  .workspace { --list-w: 140px; }
}
</style>
