// Standalone Vite config for developing the renderer in a normal browser.
// Without Electron, window.podium is missing and the renderer falls back to its mock backend.
// The mock "Slidev server" lives at /__mock: /__mock/<n> serves public/mock-slide.html,
// /__mock/images/<name> serves a placeholder picture.
import type { Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const rendererRoot = resolve(import.meta.dirname, 'src/renderer')

function mockSlidevServer(): Plugin {
  return {
    name: 'podium-mock-slidev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/__mock/'))
          return next()
        const path = url.slice('/__mock'.length).split('?')[0]
        if (path.startsWith('/images/')) {
          const name = decodeURIComponent(path.slice('/images/'.length))
          let h = 0
          for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
          res.setHeader('Content-Type', 'image/svg+xml')
          res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 60% 75%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 45% 45%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><path d="M0 470 L220 260 L380 420 L520 300 L800 520 L800 600 L0 600Z" fill="hsl(${(h + 80) % 360} 35% 30%)" opacity=".8"/><circle cx="620" cy="140" r="56" fill="#fff" opacity=".7"/></svg>`)
          return
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(readFileSync(resolve(rendererRoot, 'public/mock-slide.html'), 'utf8'))
      })
    },
  }
}

export default defineConfig({
  root: rendererRoot,
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@': resolve(rendererRoot, 'src'),
    },
  },
  plugins: [vue(), mockSlidevServer()],
  server: { strictPort: true },
})
