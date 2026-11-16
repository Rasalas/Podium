import type { PodiumBridge } from '@shared/ipc'

let current: PodiumBridge | undefined

/** The backend. In Electron this is `window.podium`; in a plain browser main.ts installs the mock. */
export function api(): PodiumBridge {
  if (!current)
    throw new Error('Podium backend not installed')
  return current
}

export function setApi(bridge: PodiumBridge) {
  current = bridge
}

export function isMock(): boolean {
  return Boolean((current as { __mock?: boolean } | undefined)?.__mock)
}

/** Readable message from anything a rejected IPC call can throw. */
export function errorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error)
  // Electron prefixes remote errors with "Error invoking remote method 'podium:invoke': Error: ".
  message = message.replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '')
  return message
}
