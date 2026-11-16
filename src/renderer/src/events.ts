// Backend events → stores. Installed once by App.vue.
import { api } from './api'
import { onExportProgress, runCommand } from './actions'
import { useAppStore } from './stores/app'
import { useDeckStore } from './stores/deck'

export function installEventHandlers(): () => void {
  const app = useAppStore()
  const deck = useDeckStore()
  const off = [
    api().on('progress', (event) => {
      app.onProgress(event)
      if (event.scope === 'export')
        onExportProgress(event)
    }),
    api().on('deck:changed', snapshot => deck.accept(snapshot)),
    api().on('server:status', status => deck.acceptServer(status)),
    api().on('thumbnail', event => deck.acceptThumbnail(event)),
    api().on('present:state', (state) => {
      deck.presentation = state
    }),
    api().on('agent', event => deck.acceptAgent(event)),
    api().on('open-request', ({ path }) => void app.openPath(path)),
    api().on('menu', ({ command }) => runCommand(command)),
  ]
  return () => off.forEach(fn => fn())
}
