import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// App tests start the built Electron app (`npx electron-vite build` first). Without a display
// run them under xvfb: xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test -c tests/e2e/app/playwright.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: join(tmpdir(), 'podium-app-test-results'),
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
})
