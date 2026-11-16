/// <reference types="vite/client" />
import type { PodiumBridge } from '@shared/ipc'

declare global {
  interface Window {
    /** Missing when the renderer runs in a plain browser; main.ts then installs the mock. */
    podium: PodiumBridge | undefined
  }
  // src/shared/types.ts names NodeJS.Platform; the web build has no Node typings.
  namespace NodeJS {
    type Platform = 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<object, object, unknown>
  export default component
}
