import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'

const shared = resolve(import.meta.dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    // Dependencies are bundled into the main bundle, so the packaged app carries no
    // node_modules. @slidev/types alone would drag in several hundred megabytes.
    build: { externalizeDeps: false },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      // Sandboxed preload scripts must be CommonJS and self-contained.
      externalizeDeps: false,
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    resolve: { alias: { '@shared': shared, '@': resolve(import.meta.dirname, 'src/renderer/src') } },
    plugins: [vue()],
  },
})
