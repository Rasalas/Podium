/**
 * End-to-end tests for launcher/bridge-client.js against a real Slidev dev server.
 *
 * Run: npx playwright test -c tests/e2e/bridge/playwright.config.ts
 *
 * The spec starts its own launcher on PORT, drives a host page with an iframe (postMessage
 * protocol) and plain pages (window.__podium__), and restores the fixture deck afterwards.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Browser, Frame, Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test } from '@playwright/test'
import MarkdownIt from 'markdown-it'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..')
const DECK = join(ROOT, 'tests/fixtures/bridge')
const ENTRY = join(DECK, 'slides.md')
const PORT = 3531
const URL_BASE = `http://localhost:${PORT}`
const TAG = 'podium-bridge'

const original = readFileSync(ENTRY, 'utf8')

let server: ChildProcessWithoutNullStreams | undefined
let browser: Browser
let host: Page
let cursor = 0

type Msg = Record<string, any> & { type: string }

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function startServer() {
  const proc = spawn(process.execPath, [
    join(ROOT, 'launcher/launcher.mjs'),
    '--runtime',
    join(ROOT, '.dev-runtime'),
    '--entry',
    ENTRY,
    '--port',
    String(PORT),
    '--bridge',
    join(ROOT, 'launcher/bridge-client.js'),
  ], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
  server = proc
  let log = ''
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`launcher not ready:\n${log}`)), 90_000)
    proc.stdout.on('data', (chunk) => {
      log += chunk
      if (log.includes('@@podium {"event":"ready"')) {
        clearTimeout(timer)
        resolveReady()
      }
      else if (log.includes('@@podium {"event":"error"')) {
        clearTimeout(timer)
        reject(new Error(log))
      }
    })
    proc.stderr.on('data', chunk => (log += chunk))
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`launcher exited with ${code}:\n${log}`))
    })
  })
}

async function stopServer() {
  const proc = server
  if (!proc || proc.exitCode != null)
    return
  const exited = new Promise(r => proc.once('exit', r))
  proc.stdin.end() // the launcher shuts down when stdin closes
  const timeout = new Promise(r => setTimeout(r, 5000, 'timeout'))
  if (await Promise.race([exited, timeout]) === 'timeout')
    proc.kill('SIGKILL')
}

function restoreFixture() {
  if (readFileSync(ENTRY, 'utf8') !== original)
    writeFileSync(ENTRY, original)
}

// ---------------------------------------------------------------------------
// Host page helpers
// ---------------------------------------------------------------------------

const IFRAME = { width: 1100, height: 619 } // not the native 980x552, so the slide is scaled

async function openHost(no = 1) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await page.setContent(`<!doctype html><html><body style="margin:0">
    <iframe id="slides" src="${URL_BASE}/${no}" style="position:absolute;left:0;top:0;border:0;width:${IFRAME.width}px;height:${IFRAME.height}px"></iframe>
    <button id="toolbar" style="position:absolute;left:0;top:700px">Fett</button>
    <script>
      window.msgs = []
      window.addEventListener('message', e => { if (e.data && e.data.tag === '${TAG}') window.msgs.push(e.data) })
      window.hostSend = m => document.getElementById('slides').contentWindow.postMessage(Object.assign({ tag: '${TAG}' }, m), '*')
    </script>
  </body></html>`)
  return page
}

function slides(): Frame {
  const frame = host.frames().find(f => f.url().startsWith(URL_BASE))
  if (!frame)
    throw new Error('slide frame missing')
  return frame
}

async function hostSend(msg: Record<string, unknown>) {
  await host.evaluate(m => (window as any).hostSend(m), msg)
}

/** Skip everything received so far. */
async function drain() {
  cursor = await host.evaluate(() => (window as any).msgs.length)
}

/** Wait for the next message of `type` after the cursor and move the cursor past it. */
async function expectMsg(type: string, timeout = 10_000): Promise<Msg> {
  const handle = await host.waitForFunction(({ type, from }) => {
    const msgs = (window as any).msgs as Msg[]
    for (let i = from; i < msgs.length; i++) {
      if (msgs[i].type === type)
        return { index: i, msg: msgs[i] }
    }
    return null
  }, { type, from: cursor }, { timeout })
  const { index, msg } = await handle.jsonValue() as { index: number, msg: Msg }
  cursor = index + 1
  return msg
}

/** Messages received after the cursor (does not move it), ignoring formatState noise. */
async function pending(): Promise<Msg[]> {
  await host.waitForTimeout(150)
  const all = await host.evaluate(from => (window as any).msgs.slice(from), cursor) as Msg[]
  return all.filter(m => m.type !== 'formatState')
}

async function gotoSlide(no: number) {
  await hostSend({ type: 'goto', no })
  await expect.poll(() => slides().evaluate(() => (window as any).__slidev__.nav.currentSlideNo)).toBe(no)
  // Wait until the previous slide has left; both are visible for a frame.
  await slides().waitForFunction(n => [...document.querySelectorAll('#slideshow > [data-slidev-no]')]
    .every(el => (el.getAttribute('data-slidev-no') === String(n)) === ((el as HTMLElement).style.display !== 'none'))
    && !!document.querySelector(`#slide-content [data-slidev-no="${n}"] .slidev-layout`), no)
  await drain()
}

/** Page coordinates of a character inside the slide frame (iframe sits at 0,0 of the host). */
async function charPoint(selector: string, needle: string, offsetInNeedle = 0) {
  const point = await slides().evaluate(({ selector, needle, offsetInNeedle }) => {
    const el = document.querySelector(selector)!
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.nodeValue || '').indexOf(needle)
      if (i < 0)
        continue
      const range = document.createRange()
      range.setStart(n, i + offsetInNeedle)
      range.setEnd(n, i + offsetInNeedle + 1)
      const r = range.getBoundingClientRect()
      return { x: r.left + 1, y: r.top + r.height / 2 }
    }
    return null
  }, { selector, needle, offsetInNeedle })
  if (!point)
    throw new Error(`text ${needle} not found in ${selector}`)
  return point
}

async function clickText(selector: string, needle: string, offsetInNeedle = 0) {
  const { x, y } = await charPoint(selector, needle, offsetInNeedle)
  await host.mouse.click(x, y)
}

async function postSlide(no: number, edit: (content: string) => string) {
  const res = await fetch(`${URL_BASE}/__slidev/slides/${no}.json`)
  const slide = await res.json() as { content: string }
  const post = await fetch(`${URL_BASE}/__slidev/slides/${no}.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: edit(slide.content) }),
  })
  expect(post.ok).toBe(true)
}

const sel = (no: number, rest = '') => `#slide-content [data-slidev-no="${no}"] ${rest}`.trim()

// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(180_000)
  restoreFixture()
  await startServer()
  browser = await chromium.launch()
  // Warm up Vite's dependency optimisation so the first real test does not time out.
  const warm = await browser.newPage()
  await warm.goto(`${URL_BASE}/1`)
  await warm.waitForSelector(sel(1, '.slidev-layout'), { timeout: 120_000 })
  await warm.close()
})

test.afterAll(async () => {
  restoreFixture()
  await browser?.close()
  await stopServer()
})

test('stays passive without a host', async () => {
  const page = await browser.newPage({ viewport: { width: 980, height: 552 } })
  await page.goto(`${URL_BASE}/1`)
  await page.waitForSelector(sel(1, '.slidev-layout'))
  expect(await page.evaluate(() => typeof (window as any).__podium__?.goto)).toBe('function')
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-podium-mode'))).toBe(false)
  expect(await page.evaluate(() => !!document.getElementById('podium-bridge-style'))).toBe(false)
  // Slidev's own keyboard navigation still works.
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(() => (window as any).__slidev__.nav.currentSlideNo)).toBe(2)
  // A click on a block does nothing special.
  await page.locator(sel(2, 'h1')).click()
  expect(await page.locator(sel(2, 'h1')).getAttribute('contenteditable')).toBeNull()
  await page.close()
})

test('hello → ready, chrome hidden, clicks revealed, navigation keys forwarded', async () => {
  host = await openHost(1)
  await slides().waitForFunction(() => !!(window as any).__podium__)
  await hostSend({ type: 'hello', mode: 'edit', locale: 'de' })
  const ready = await expectMsg('ready', 30_000)
  expect(ready).toMatchObject({ no: 1, total: 7 })

  const frame = slides()
  expect(await frame.evaluate(() => document.documentElement.getAttribute('data-podium-mode'))).toBe('edit')
  // The nav bar lives in the controls slot of the main slide container.
  const chrome = await frame.evaluate(() => [...document.querySelectorAll('#slide-container > :not(#slide-content)')].map(el => getComputedStyle(el).display))
  expect(chrome.length).toBeGreaterThan(0)
  expect(chrome.every(d => d === 'none')).toBe(true)

  await gotoSlide(5)
  const opacities = await frame.evaluate(s => [...document.querySelectorAll(s)].map(el => getComputedStyle(el).opacity), sel(5, '.slidev-vclick-target'))
  expect(opacities).toEqual(['1', '1', '1'])

  // No slide navigation by keyboard; app shortcuts reach the host.
  await frame.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await host.locator('#slides').focus()
  await host.keyboard.press('ArrowRight')
  expect(await expectMsg('shortcut')).toMatchObject({ key: 'ArrowRight', ctrl: false })
  await host.keyboard.press('Control+s')
  expect(await expectMsg('shortcut')).toMatchObject({ key: 's', ctrl: true })
  await host.keyboard.press(' ')
  await host.waitForTimeout(200)
  expect(await frame.evaluate(() => (window as any).__slidev__.nav.currentSlideNo)).toBe(5)
  expect(await frame.evaluate(() => (window as any).__slidev__.nav.clicks)).toBe(0)

  await gotoSlide(1)
})

test('view mode keeps Slidev behaviour', async () => {
  await hostSend({ type: 'setMode', mode: 'view' })
  await gotoSlide(5)
  const frame = slides()
  await expect.poll(() => frame.evaluate(s => getComputedStyle(document.querySelector(s)!).opacity, sel(5, '.slidev-vclick-target'))).toBe('0')
  await frame.locator('body').press('ArrowRight')
  await expect.poll(() => frame.evaluate(() => (window as any).__slidev__.nav.clicks)).toBe(1)
  await hostSend({ type: 'setMode', mode: 'edit' })
  await gotoSlide(1)
  expect(await frame.evaluate(() => (window as any).__slidev__.nav.clicks)).toBe(0)
})

test('the canvas shows what a theme hides around a click step', async () => {
  const frame = slides()
  const card = () => frame.evaluate(s => getComputedStyle(document.querySelector(s)!).opacity, sel(6, '.karte'))
  // The fixture hides the whole card with a rule on Slidev's "hidden" class, the way themes do.
  await gotoSlide(6)
  await expect.poll(card).toBe('1')
  await hostSend({ type: 'setMode', mode: 'view' })
  await expect.poll(card).toBe('0')
  await frame.locator('body').press('ArrowRight')
  await expect.poll(card).toBe('1')
  // Back on the canvas at step 0: Slidev hides the content again and the canvas uncovers it again.
  await hostSend({ type: 'setMode', mode: 'edit' })
  await expect.poll(() => frame.evaluate(() => (window as any).__slidev__.nav.clicks)).toBe(0)
  await expect.poll(card).toBe('1')
  await gotoSlide(1)
})

test('goto with clicks shows that click step in view mode, edit mode ignores it', async () => {
  const frame = slides()
  const navState = () => frame.evaluate(() => {
    const nav = (window as any).__slidev__.nav
    return [nav.currentSlideNo, nav.clicks]
  })
  const opacities = () => frame.evaluate(s => [...document.querySelectorAll(s)].map(el => getComputedStyle(el).opacity), sel(5, '.slidev-vclick-target'))

  await hostSend({ type: 'setMode', mode: 'view' })
  await gotoSlide(1)
  // Straight onto a slide that was not mounted yet: the step must survive Slidev's clamping.
  await hostSend({ type: 'goto', no: 5, clicks: 2 })
  await expect.poll(navState).toEqual([5, 2])
  await expect.poll(opacities).toEqual(['1', '1', '0'])
  await hostSend({ type: 'goto', no: 5, clicks: 1 })
  await expect.poll(navState).toEqual([5, 1])
  await hostSend({ type: 'goto', no: 5, clicks: 3 })
  await expect.poll(opacities).toEqual(['1', '1', '1'])
  // Without clicks the old behaviour stays: back to step 0.
  await hostSend({ type: 'goto', no: 5 })
  await expect.poll(navState).toEqual([5, 0])

  await hostSend({ type: 'setMode', mode: 'edit' })
  await hostSend({ type: 'goto', no: 5, clicks: 2 })
  await host.waitForTimeout(300)
  expect(await navState()).toEqual([5, 0])
  await expect.poll(opacities).toEqual(['1', '1', '1'])
  await gotoSlide(1)

  // Same through window.__podium__.
  const page = await browser.newPage({ viewport: { width: 980, height: 552 } })
  await page.goto(`${URL_BASE}/1`)
  await page.waitForFunction(() => !!(window as any).__podium__)
  await page.evaluate(() => (window as any).__podium__.ready())
  await page.evaluate(() => (window as any).__podium__.setMode('view'))
  await page.evaluate(() => (window as any).__podium__.goto(5, 2))
  expect(await page.evaluate(() => [(window as any).__slidev__.nav.currentSlideNo, (window as any).__slidev__.nav.clicks])).toEqual([5, 2])
  await page.close()
})

test('click puts the caret where clicked, Enter commits inline markdown', async () => {
  await gotoSlide(1)
  // Caret right before "Absatz".
  await clickText(sel(1, 'p'), 'Absatz')
  const selected = await expectMsg('blockSelected')
  expect(selected).toMatchObject({
    no: 1,
    editable: true,
    block: { tag: 'p', text: 'Ein Absatz mit fett, kursiv, code und einem Link.', occurrence: 0, tagIndex: 0 },
  })
  expect(selected.rect.width).toBeGreaterThan(100)
  await expectMsg('editStarted')
  await host.keyboard.type('neuer ')
  await host.keyboard.press('Enter')
  const commit = await expectMsg('blockCommit')
  expect(commit.markdown).toBe('Ein neuer Absatz mit **fett**, *kursiv*, `code` und einem [Link](https://example.com).')
  expect(commit.block).toMatchObject({ tag: 'p', occurrence: 0, tagIndex: 0 })
  // Vue's own nodes are back until the file changes.
  expect(await slides().locator(sel(1, 'p')).first().textContent()).toBe('Ein Absatz mit fett, kursiv, code und einem Link.')
  expect(await slides().locator(sel(1, 'p')).first().getAttribute('contenteditable')).toBeNull()
})

test('unchanged edit and Escape send editCancelled and restore the block', async () => {
  await drain()
  await clickText(sel(1, 'h1'), 'Podium')
  await expectMsg('editStarted')
  await host.keyboard.press('Enter')
  await expectMsg('editCancelled')
  expect((await pending()).some(m => m.type === 'blockCommit')).toBe(false)

  await clickText(sel(1, 'h1'), 'Podium')
  await expectMsg('editStarted')
  await host.keyboard.type('Quatsch')
  await host.keyboard.press('Escape')
  await expectMsg('editCancelled')
  expect(await slides().locator(sel(1, 'h1')).innerHTML()).toBe('Hallo Podium')
  expect((await pending()).some(m => m.type === 'blockCommit')).toBe(false)
})

test('commit survives hot reload and editing keeps working afterwards', async () => {
  await drain()
  await clickText(sel(1, 'h1'), 'Podium', 5)
  await expectMsg('editStarted')
  await host.keyboard.press('End')
  await host.keyboard.type(' live')
  await host.keyboard.press('Enter')
  const commit = await expectMsg('blockCommit')
  expect(commit).toMatchObject({ markdown: 'Hallo Podium live', block: { tag: 'h1', text: 'Hallo Podium', occurrence: 0, tagIndex: 0 } })

  await postSlide(1, c => c.replace('# Hallo Podium', `# ${commit.markdown}`))
  const frame = slides()
  await frame.waitForFunction(s => document.querySelector(s)?.textContent === 'Hallo Podium live', sel(1, 'h1'))
  expect(await frame.evaluate(() => document.documentElement.getAttribute('data-podium-mode'))).toBe('edit')
  expect(await frame.evaluate(() => !!document.getElementById('podium-bridge-style'))).toBe(true)

  await drain()
  await clickText(sel(1, 'h1'), 'live')
  const started = await expectMsg('editStarted')
  expect(started.block).toMatchObject({ tag: 'h1', text: 'Hallo Podium live' })
  await host.keyboard.type('sehr ')
  await host.keyboard.press('Enter')
  expect((await expectMsg('blockCommit')).markdown).toBe('Hallo Podium sehr live')

  await postSlide(1, c => c.replace('# Hallo Podium live', '# Hallo Podium'))
  await frame.waitForFunction(s => document.querySelector(s)?.textContent === 'Hallo Podium', sel(1, 'h1'))
})

test('bold/italic by keyboard, line breaks, plain-text paste', async () => {
  await drain()
  const para = sel(1, 'p:nth-of-type(2)')
  await clickText(para, 'Zweiter')
  await expectMsg('editStarted')
  await host.keyboard.press('End')
  await host.keyboard.press('Control+b')
  await host.keyboard.type(' fett')
  await host.keyboard.press('Control+b')
  await host.keyboard.type(' und ')
  await host.keyboard.press('Control+i')
  await host.keyboard.type('schief')
  await host.keyboard.press('Control+i')
  await host.keyboard.press('Shift+Enter')
  await host.keyboard.type('neu')
  // Paste HTML: only the text arrives.
  await slides().evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/html', '<b>Fett</b> <i>kursiv</i>')
    data.setData('text/plain', ' *Stern*\nZeile')
    document.querySelector('[data-pd-editing]')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await host.keyboard.press('Enter')
  const commit = await expectMsg('blockCommit')
  expect(commit.markdown).toBe('Zweiter Absatz mit https://slidev.dev als Link. **fett** und *schief*<br>neu \\*Stern\\* Zeile')
})

test('format messages from the host toolbar apply to the selection', async () => {
  await drain()
  const para = sel(1, 'p:nth-of-type(2)')
  await clickText(para, 'Absatz')
  await expectMsg('editStarted')
  const frame = slides()
  await frame.evaluate(() => {
    const el = document.querySelector('[data-pd-editing]')!
    const text = el.firstChild!
    const range = document.createRange()
    range.setStart(text, 8) // "Absatz"
    range.setEnd(text, 14)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
  })
  // Clicking the host toolbar takes focus out of the frame; the edit must stay open.
  await host.click('#toolbar')
  await host.waitForTimeout(100)
  expect(await frame.evaluate(() => !!document.querySelector('[data-pd-editing]'))).toBe(true)
  await drain()

  await hostSend({ type: 'format', command: 'bold' })
  expect(await expectMsg('formatState')).toMatchObject({ bold: true, italic: false })
  await hostSend({ type: 'format', command: 'italic' })
  expect(await expectMsg('formatState')).toMatchObject({ bold: true, italic: true })
  await hostSend({ type: 'format', command: 'bold' })
  expect(await expectMsg('formatState')).toMatchObject({ bold: false, italic: true })
  await hostSend({ type: 'format', command: 'link', value: 'https://podium.example' })
  expect(await expectMsg('formatState')).toMatchObject({ link: true })
  await hostSend({ type: 'endEdit', commit: true })
  const commit = await expectMsg('blockCommit')
  expect(commit.markdown).toBe('Zweiter [*Absatz*](https://podium.example) mit https://slidev.dev als Link.')

  await clickText(para, 'Absatz')
  await expectMsg('editStarted')
  await frame.evaluate(() => {
    const el = document.querySelector('[data-pd-editing]')!
    const range = document.createRange()
    range.selectNodeContents(el)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
  })
  await hostSend({ type: 'format', command: 'code' })
  await hostSend({ type: 'endEdit', commit: true })
  expect((await expectMsg('blockCommit')).markdown).toBe('`Zweiter Absatz mit https://slidev.dev als Link.`')

  await clickText(para, 'Absatz')
  await expectMsg('editStarted')
  await hostSend({ type: 'endEdit', commit: false })
  await expectMsg('editCancelled')
})

test('list items: refs, split on Enter, remove when empty', async () => {
  await gotoSlide(2)
  // Second "Erster Punkt" is the fifth list item on the slide.
  await clickText(`${sel(2, 'ul')} > li:nth-of-type(3) > span`, 'Punkt')
  const started = await expectMsg('editStarted')
  expect(started.block).toEqual({ tag: 'li', text: 'Erster Punkt', occurrence: 1, tagIndex: 4 })
  await host.keyboard.press('Escape')
  await expectMsg('editCancelled')

  // Nested list item.
  await clickText(sel(2), 'Verschachtelt zwei', 0)
  expect((await expectMsg('editStarted')).block).toEqual({ tag: 'li', text: 'Verschachtelt zwei', occurrence: 0, tagIndex: 3 })
  await host.keyboard.press('Escape')
  await expectMsg('editCancelled')

  // Split inside a formatted item: caret before "ter".
  await clickText(sel(2), 'Zweiter', 4)
  expect((await expectMsg('editStarted')).block).toEqual({ tag: 'li', text: 'Zweiter Punkt', occurrence: 0, tagIndex: 1 })
  await host.keyboard.press('Enter')
  const split = await expectMsg('listItemSplit')
  expect(split).toMatchObject({ no: 2, markdown: 'Zwei', rest: 'ter **Punkt**', block: { tag: 'li', text: 'Zweiter Punkt' } })
  expect(await slides().evaluate(() => !!document.querySelector('[data-pd-editing]'))).toBe(false)

  // Ordered list item emptied, then Backspace once more.
  await clickText(sel(2, 'ol'), 'Nummer zwei', 3)
  expect((await expectMsg('editStarted')).block).toEqual({ tag: 'li', text: 'Nummer zwei', occurrence: 0, tagIndex: 6 })
  await host.keyboard.press('Control+a')
  await host.keyboard.press('Backspace')
  await host.keyboard.press('Backspace')
  const removed = await expectMsg('blockRemove')
  expect(removed.block).toEqual({ tag: 'li', text: 'Nummer zwei', occurrence: 0, tagIndex: 6 })
  expect(await slides().locator(sel(2, 'ol li:nth-of-type(2)')).textContent()).toBe('Nummer zwei')
})

test('loose lists, inline HTML and components are classified', async () => {
  await gotoSlide(3)
  await clickText(sel(3), 'Locker zwei', 2)
  expect((await expectMsg('editStarted')).block).toEqual({ tag: 'li', text: 'Locker zwei', occurrence: 0, tagIndex: 1 })
  await host.keyboard.press('Escape')
  await expectMsg('editCancelled')

  // A paragraph with inline HTML is not editable as a block, but each piece of its text is.
  await slides().locator(sel(3, '.text-red')).click()
  await expect(slides().locator(sel(3, '.text-red [data-pd-text]'))).toHaveText('HTML')
  await host.keyboard.press('ControlOrMeta+A')
  await host.keyboard.type('Farbe')
  await host.keyboard.press('Enter')
  expect((await expectMsg('textCommit')).edit).toEqual({
    before: 'HTML',
    after: 'Farbe',
    block: { tag: 'p', text: 'Text mit HTML drin.', occurrence: 0, tagIndex: 0 },
    occurrence: 0,
    total: 1,
  })
  // Vue's own text node is back in place until the file change arrives.
  expect(await slides().locator(sel(3, '.text-red')).innerHTML()).toBe('HTML')
  // Escape leaves the text as it was and sends no change.
  await slides().locator(sel(3, '.text-red')).click()
  await host.keyboard.type('weg')
  await host.keyboard.press('Escape')
  await expectMsg('editCancelled')
  expect(await slides().locator(sel(3, '.text-red')).innerHTML()).toBe('HTML')

  await slides().locator(sel(3, '.pd-counter')).click()
  expect(await expectMsg('blockSelected')).toMatchObject({ editable: false, block: { tag: 'p', text: 'Text mit Zähler 0 Komponente.', tagIndex: 1 } })
  expect(await expectMsg('codeClicked')).toMatchObject({ what: 'component' })
  // The component did not receive the click.
  expect(await slides().locator(sel(3, '.pd-counter')).textContent()).toBe('Zähler 0')

  // Empty area below the content.
  await host.mouse.click(900, 550)
  await expectMsg('backgroundClicked')
})

test('code, image and two-column layout', async () => {
  await gotoSlide(6)
  await slides().locator(sel(6, 'pre')).click()
  expect(await expectMsg('codeClicked')).toMatchObject({ what: 'code', no: 6 })
  await slides().locator(sel(6, 'img')).click()
  expect(await expectMsg('codeClicked')).toMatchObject({ what: 'image', no: 6 })

  await gotoSlide(4)
  await clickText(sel(4, '.col-right'), 'Rechter Text', 3)
  expect((await expectMsg('editStarted')).block).toEqual({ tag: 'p', text: 'Rechter Text', occurrence: 0, tagIndex: 1 })
  await host.keyboard.press('Escape')
  await expectMsg('editCancelled')
  await clickText(sel(4, '.col-right'), 'Rechts', 2)
  expect((await expectMsg('editStarted')).block).toEqual({ tag: 'h1', text: 'Rechts', occurrence: 0, tagIndex: 1 })
  await host.keyboard.press('Escape')
  await expectMsg('editCancelled')
})

test('focusBlock waits for a block that appears with the next hot reload', async () => {
  await gotoSlide(4)
  writeFileSync(ENTRY, original.replace('Rechter Text\n', 'Rechter Text\n\nNeu rechts\n'))
  await hostSend({ type: 'focusBlock', block: { tag: 'p', text: 'Neu rechts', occurrence: 0, tagIndex: 2 }, selectAll: true })
  const started = await expectMsg('editStarted', 15_000)
  expect(started.block).toEqual({ tag: 'p', text: 'Neu rechts', occurrence: 0, tagIndex: 2 })
  expect(await slides().evaluate(() => getSelection()!.toString())).toBe('Neu rechts')
  await host.keyboard.type('Ersetzt')
  await host.keyboard.press('Enter')
  expect((await expectMsg('blockCommit')).markdown).toBe('Ersetzt')

  restoreFixture()
  await slides().waitForFunction(s => !document.querySelector(s)?.textContent?.includes('Neu rechts'), sel(4))
  // Editing still works on the re-rendered slide.
  await drain()
  await clickText(sel(4, '.col-left'), 'Linker')
  await expectMsg('editStarted')
  await host.keyboard.press('Escape')
  await expectMsg('editCancelled')
})

test('measure reports overflow in slide pixels', async () => {
  await gotoSlide(7)
  await hostSend({ type: 'measure', requestId: 'm7' })
  const m7 = await expectMsg('measured')
  expect(m7.requestId).toBe('m7')
  expect(m7.report.no).toBe(7)
  expect(m7.report.overflowY).toBeGreaterThan(200)
  expect(m7.report.overflowX).toBeGreaterThan(50)

  await gotoSlide(1)
  await hostSend({ type: 'measure', requestId: 'm1' })
  expect((await expectMsg('measured')).report).toEqual({ no: 1, overflowX: 0, overflowY: 0 })
  await host.close()
})

test('window.__podium__ drives a hidden capture window', async () => {
  // Native slide size 980x552 at two different window sizes: the numbers must agree.
  const results: number[] = []
  for (const viewport of [{ width: 980, height: 552 }, { width: 1960, height: 1104 }]) {
    const page = await browser.newPage({ viewport })
    await page.goto(`${URL_BASE}/1`)
    await page.waitForFunction(() => !!(window as any).__podium__)
    expect(await page.evaluate(() => (window as any).__podium__.ready())).toEqual({ total: 7 })
    await page.evaluate(() => (window as any).__podium__.setMode('capture'))
    const started = Date.now()
    await page.evaluate(() => (window as any).__podium__.goto(5))
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(await page.evaluate(() => (window as any).__slidev__.nav.currentSlideNo)).toBe(5)
    const state = await page.evaluate(() => ({
      opacity: [...document.querySelectorAll('#slide-content [data-slidev-no="5"] .slidev-vclick-target')].map(el => getComputedStyle(el).opacity),
      transition: getComputedStyle(document.querySelector('#slide-content [data-slidev-no="5"] .slidev-vclick-target')!).transitionDuration,
      pointer: getComputedStyle(document.getElementById('slide-container')!).pointerEvents,
    }))
    expect(state).toEqual({ opacity: ['1', '1', '1'], transition: '0s', pointer: 'none' })

    await page.evaluate(() => (window as any).__podium__.goto(6))
    expect(await page.evaluate(() => (document.querySelector('#slide-content [data-slidev-no="6"] img') as HTMLImageElement).complete)).toBe(true)

    await page.evaluate(() => (window as any).__podium__.goto(7))
    const report = await page.evaluate(() => (window as any).__podium__.measure())
    expect(report.no).toBe(7)
    results.push(report.overflowY)
    // Out-of-range numbers are clamped and still resolve.
    await page.evaluate(() => (window as any).__podium__.goto(99))
    expect(await page.evaluate(() => (window as any).__slidev__.nav.currentSlideNo)).toBe(7)
    await page.close()
  }
  expect(Math.abs(results[0] - results[1])).toBeLessThanOrEqual(1)
})

test('DOM → markdown conversion round-trips through markdown-it', async () => {
  const page = await browser.newPage()
  await page.goto(`${URL_BASE}/1`)
  await page.waitForFunction(() => !!(window as any).__podiumInternals__)
  const toMd = (html: string) => page.evaluate((h) => {
    const div = document.createElement('div')
    div.innerHTML = h
    return (window as any).__podiumInternals__.toMarkdown(div) as string
  }, html)
  const textOf = (html: string) => page.evaluate((h) => {
    const div = document.createElement('div')
    div.innerHTML = h
    div.querySelectorAll('br').forEach(br => br.replaceWith(' '))
    return (div.textContent || '').replace(/[\s​]+/g, ' ').trim()
  }, html)

  const expected: [string, string][] = [
    ['a <strong>b </strong>c', 'a **b** c'],
    ['<strong>a</strong> b', '**a** b'],
    ['<strong>a </strong><strong>b</strong>', '**a b**'],
    ['<strong>a <em>b</em></strong><em> c</em>', '**a *b*** *c*'],
    ['<s>alt</s> neu', '~~alt~~ neu'],
    ['<code>x `y`</code>', '`` x `y` ``'],
    ['<a href="https://x.de">https://x.de</a>', 'https://x.de'],
    ['<a href="https://x.de">Seite </a>danach', '[Seite](https://x.de) danach'],
    ['a<br>b<br>', 'a<br>b'],
    ['Preis: 5 * 3 = 15_000 [x] &lt;tag&gt; `t`', 'Preis: 5 \\* 3 = 15\\_000 \\[x] \\<tag> \\`t\\`'],
    ['# kein Titel', '\\# kein Titel'],
    ['- kein Punkt', '\\- kein Punkt'],
    ['+ kein Punkt', '\\+ kein Punkt'],
    ['1. keine Nummer', '1\\. keine Nummer'],
    ['&gt; kein Zitat', '\\> kein Zitat'],
    ['<span class="x">span</span> text', 'span text'],
    ['  mit&nbsp;Abstand  ', 'mit Abstand'],
    ['<strong>​</strong>zw', 'zw'],
  ]
  for (const [html, md] of expected)
    expect(await toMd(html), html).toBe(md)

  const mdit = new MarkdownIt({ html: true, linkify: true })
  for (const [html] of expected) {
    const md1 = await toMd(html)
    const html2 = mdit.renderInline(md1)
    expect(await toMd(html2), `${html} → ${md1} → ${html2}`).toBe(md1)
    expect(await textOf(html2), html).toBe(await textOf(html))
  }
  await page.close()
})
