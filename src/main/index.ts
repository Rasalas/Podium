import type { MenuCommand, PodiumApiMethod, PodiumEvents } from '../shared/ipc'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL } from '../shared/ipc'
import { createApi } from './api'
import { buildMenu } from './menu'
import { loadRenderer, PRELOAD_PATH } from './renderer-page'

// Tests and development point the app at a throwaway profile.
if (process.env.PODIUM_USER_DATA)
  app.setPath('userData', resolve(process.env.PODIUM_USER_DATA))

const resourcesDir = app.isPackaged ? process.resourcesPath : app.getAppPath()
let mainWindow: BrowserWindow | undefined
let pendingOpen: string | undefined = deckPathFromArgv(process.argv)

function deckPathFromArgv(argv: string[]): string | undefined {
  return argv.slice(1).find(arg => !arg.startsWith('-') && existsSync(arg) && (/\.(?:podium|md)$/.test(arg) || existsSync(join(arg, 'slides.md'))))
}

let presenting = false

/**
 * The editor steps aside while a presentation runs and comes back when it ends, the way
 * PowerPoint does it. Otherwise it sits behind the presenter view as a second Podium window.
 */
function followPresentation(active: boolean): void {
  if (active === presenting)
    return
  presenting = active
  if (!mainWindow || mainWindow.isDestroyed())
    return
  if (active) {
    mainWindow.hide()
  }
  else {
    mainWindow.show()
    mainWindow.focus()
  }
}

function emit<K extends keyof PodiumEvents>(event: K, payload: PodiumEvents[K]): void {
  if (event === 'present:state')
    followPresentation((payload as PodiumEvents['present:state']).active)
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(IPC_EVENT_CHANNEL, event, payload)
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Podium',
    backgroundColor: '#f6f5f2',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !/^https?:\/\/(?:localhost|127\.0\.0\.1)[:/]/.test(url))
      void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('did-finish-load', () => {
    if (pendingOpen) {
      emit('open-request', { path: pendingOpen })
      pendingOpen = undefined
    }
  })
  void loadRenderer(window)
  return window
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
}
else {
  app.on('second-instance', (_event, argv) => {
    const path = deckPathFromArgv(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized())
        mainWindow.restore()
      mainWindow.focus()
      if (path)
        emit('open-request', { path })
    }
  })

  // macOS hands over files through this event instead of argv.
  app.on('open-file', (event, path) => {
    event.preventDefault()
    if (mainWindow)
      emit('open-request', { path })
    else
      pendingOpen = path
  })

  void app.whenReady().then(() => {
    const services = createApi({ userDataDir: app.getPath('userData'), resourcesDir, emit })

    ipcMain.handle(IPC_INVOKE_CHANNEL, async (_event, method: PodiumApiMethod, args: unknown[]) => {
      const handler = services.api[method] as ((...a: unknown[]) => Promise<unknown>) | undefined
      if (typeof handler !== 'function')
        throw new Error(`Unknown API method: ${String(method)}`)
      return handler(...args)
    })

    const sendMenu = (command: MenuCommand) => {
      // These two work while the editor is hidden, so they do not go through it.
      if (command === 'stop-presentation')
        void services.api.stopPresentation()
      else if (command === 'swap-displays')
        void services.api.swapPresentationDisplays()
      else
        emit('menu', { command })
    }
    Menu.setApplicationMenu(buildMenu(services.locale(), sendMenu))

    mainWindow = createWindow()
    mainWindow.on('closed', () => {
      mainWindow = undefined
    })
    services.updater.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0)
        mainWindow = createWindow()
    })

    let quitting = false
    app.on('before-quit', (event) => {
      if (quitting)
        return
      event.preventDefault()
      quitting = true
      // Closing decks stops their Slidev servers. If one of them never answers, the app still has to quit.
      const giveUp = new Promise<void>(resolve => setTimeout(resolve, 6000))
      void Promise.race([services.shutdown().catch(() => {}), giveUp]).then(() => {
        // Everything is saved and closed: the moment a loaded update can take the app's place.
        services.updater.installOnQuit()
        app.quit()
      })
    })
  })

  app.on('window-all-closed', () => app.quit())
}
