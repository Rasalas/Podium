import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// Bridge client tests drive a real Slidev dev server (started by the spec itself) in Chromium.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: join(tmpdir(), 'podium-bridge-test-results'),
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1200, height: 800 },
  },
})
