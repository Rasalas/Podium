<script setup lang="ts">
import type { RecentDeck } from '@shared/types'
import { FolderOpen, LoaderCircle, Plus, Settings, X } from '@lucide/vue'
import { onMounted } from 'vue'
import { formatDateTime, t } from '../i18n'
import { useAppStore } from '../stores/app'
import { useUiStore } from '../stores/ui'

const app = useAppStore()
const ui = useUiStore()

onMounted(() => {
  if (!app.templates.length)
    void app.loadTemplates()
})

function folderOf(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  parts.pop()
  const home = parts.findIndex(p => p === 'home' || p === 'Users')
  if (home >= 0)
    return ['~', ...parts.slice(home + 2)].join('/')
  return `/${parts.join('/')}`
}

function colorsOf(deck: RecentDeck) {
  return app.templates.find(tpl => tpl.id === deck.theme)?.colors ?? { background: '#ffffff', foreground: '#1b2130', accent: '#2c5bd0' }
}

function open(deck: RecentDeck) {
  if (deck.exists)
    void app.openPath(deck.path)
}
</script>

<template>
  <main class="start">
    <header class="head">
      <h1 class="app-name">{{ t('app.name') }}</h1>
      <div class="head-actions">
        <button class="btn icon" :aria-label="t('editor.settings')" :data-tip="t('editor.settings')" @click="ui.settingsOpen = true">
          <Settings :size="18" />
        </button>
      </div>
    </header>

    <div class="content">
      <section v-if="!app.recents.length" class="empty">
        <h2>{{ t('start.emptyTitle') }}</h2>
        <p>{{ t('start.emptyText') }}</p>
        <div class="actions">
          <button class="btn primary large" :disabled="app.opening" @click="ui.newDeckOpen = true">
            <Plus :size="18" /> {{ t('start.newDeck') }}
          </button>
          <button class="btn outline large" :disabled="app.opening" @click="app.openDialog()">
            <FolderOpen :size="18" /> {{ t('start.open') }}
          </button>
        </div>
      </section>

      <template v-else>
        <div class="row">
          <h2 class="section-heading">{{ t('start.recent') }}</h2>
          <div class="actions">
            <button class="btn outline" :disabled="app.opening" @click="app.openDialog()">
              <FolderOpen :size="16" /> {{ t('start.open') }}
            </button>
            <button class="btn primary" :disabled="app.opening" @click="ui.newDeckOpen = true">
              <Plus :size="16" /> {{ t('start.newDeck') }}
            </button>
          </div>
        </div>
        <ul class="grid">
          <li v-for="deck in app.recents" :key="deck.path" class="tile" :class="{ missing: !deck.exists }">
            <button
              class="open" :disabled="app.opening || !deck.exists"
              :aria-label="deck.exists ? deck.title : `${deck.title}, ${t('start.missing')}`"
              @click="open(deck)"
            >
              <div class="thumb" :style="{ background: colorsOf(deck).background, color: colorsOf(deck).foreground }">
                <img v-if="deck.thumbnail" :src="deck.thumbnail" alt="">
                <template v-else>
                  <span class="thumb-title">{{ deck.title }}</span>
                  <span class="thumb-accent" :style="{ background: colorsOf(deck).accent }" />
                </template>
                <span v-if="!deck.exists" class="missing-badge">{{ t('start.missing') }}</span>
              </div>
              <div class="meta">
                <span class="title">{{ deck.title }}</span>
                <span class="folder" :title="deck.path">{{ folderOf(deck.path) }}</span>
                <span class="when">{{ deck.exists ? formatDateTime(deck.lastOpened) : t('start.missingHint') }}</span>
              </div>
            </button>
            <button
              class="btn icon remove" :aria-label="`${t('start.removeFromList')}: ${deck.title}`"
              :data-tip="t('start.removeFromList')" @click="app.removeRecent(deck.path)"
            >
              <X :size="15" />
            </button>
          </li>
        </ul>
      </template>
    </div>

    <div v-if="app.opening" class="opening" role="status">
      <LoaderCircle :size="18" class="spin" /> {{ t('start.opening') }}
    </div>
  </main>
</template>

<style scoped>
.start { display: flex; flex-direction: column; height: 100%; overflow: auto; }
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 32px;
}
.app-name { font-size: var(--fs-lg); font-weight: 700; color: var(--accent-ink); }
.content { width: 100%; max-width: 1180px; margin: 0 auto; padding: 16px 32px 48px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.section-heading { font-size: var(--fs-xl); font-weight: 650; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tile { position: relative; }
.open {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  border-radius: var(--radius);
}
.open:focus-visible { box-shadow: var(--focus-ring); border-radius: var(--radius); }
.thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.open:hover:not(:disabled) .thumb { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb-title { padding: 0 16px; font-size: 15px; font-weight: 650; text-align: center; }
.thumb-accent { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; }
.meta { display: flex; flex-direction: column; gap: 1px; padding: 8px 2px 0; min-width: 0; }
.title { font-weight: 600; font-size: var(--fs-md); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder, .when { font-size: var(--fs-sm); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.missing .thumb { filter: grayscale(1); opacity: 0.55; }
.missing .title { color: var(--text-muted); }
.missing-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-surface);
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
  opacity: 0;
}
.tile:hover .remove, .remove:focus-visible, .missing .remove { opacity: 1; }
.remove:hover { background: var(--bg-surface) !important; color: var(--danger); }
.empty { max-width: 520px; margin: 12vh auto 0; text-align: center; }
.empty h2 { font-size: var(--fs-xxl); font-weight: 650; margin-bottom: 10px; }
.empty p { font-size: var(--fs-md); color: var(--text-muted); line-height: 1.55; margin-bottom: 24px; }
.empty .actions { justify-content: center; }
.opening {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: var(--radius);
  background: var(--bg-surface);
  box-shadow: var(--shadow);
  font-weight: 600;
}
</style>
