// Renders build/icon.png from the inline SVG below. Run once: node scripts/make-icon.mjs
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="64" y="64" width="896" height="896" rx="200" fill="#2a56d6"/>
  <rect x="212" y="250" width="600" height="380" rx="36" fill="#fff"/>
  <rect x="276" y="330" width="300" height="46" rx="23" fill="#2a56d6"/>
  <rect x="276" y="420" width="420" height="30" rx="15" fill="#b9c8f2"/>
  <rect x="276" y="486" width="340" height="30" rx="15" fill="#b9c8f2"/>
  <rect x="490" y="630" width="44" height="110" fill="#fff"/>
  <rect x="352" y="740" width="320" height="44" rx="22" fill="#fff"/>
</svg>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`)
await page.screenshot({ path: resolve(import.meta.dirname, '../build/icon.png'), omitBackground: true })
await browser.close()
