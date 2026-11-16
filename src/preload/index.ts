import type { PodiumApiMethod, PodiumBridge, PodiumEvents } from '../shared/ipc'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_METHODS, IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL } from '../shared/ipc'

type Listener = (payload: unknown) => void
const listeners = new Map<string, Set<Listener>>()

ipcRenderer.on(IPC_EVENT_CHANNEL, (_event, name: string, payload: unknown) => {
  for (const listener of listeners.get(name) ?? []) listener(payload)
})

const bridge: Record<string, unknown> = {
  on<K extends keyof PodiumEvents>(event: K, listener: (payload: PodiumEvents[K]) => void) {
    const set = listeners.get(event) ?? new Set<Listener>()
    listeners.set(event, set)
    set.add(listener as Listener)
    return () => set.delete(listener as Listener)
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
}

for (const method of API_METHODS as PodiumApiMethod[])
  bridge[method] = (...args: unknown[]) => ipcRenderer.invoke(IPC_INVOKE_CHANNEL, method, args)

contextBridge.exposeInMainWorld('podium', bridge as unknown as PodiumBridge)
