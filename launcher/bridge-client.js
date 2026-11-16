// @ts-check
/**
 * Podium bridge client: runs inside every Slidev page Podium serves.
 * Frame side of src/shared/bridge.ts. Plain browser ES module, no imports, no build step.
 *
 * Stays passive until a host says `hello` (postMessage from window.parent) or a hidden
 * window calls `window.__podium__.setMode`. Until then the page is plain Slidev.
 *
 * Ground rules that keep this working across Slidev's hot reload:
 *  - All listeners are delegated on `window` in the capture phase, so they run before
 *    Slidev's own handlers and never point at stale nodes.
 *  - Styling hangs off one <style> in <head> keyed by `html[data-podium-mode]`.
 *  - While a block is edited, its original child nodes (which Vue tracks) are parked and
 *    the user edits clones. They are put back before Vue can patch again, so a re-render
 *    after the commit lands on the nodes Vue expects.
 */

/**
 * @typedef {'edit' | 'view' | 'capture'} BridgeMode
 * @typedef {{ tag: string, text: string, occurrence: number, tagIndex: number }} BlockRef
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ no: number, overflowX: number, overflowY: number }} OverflowReport
 * @typedef {{ bold?: boolean, italic?: boolean, strike?: boolean, link?: string }} Fmt
 * @typedef {{ kind: 'text', text: string, fmt: Fmt } | { kind: 'code', text: string, fmt: Fmt } | { kind: 'br', fmt: Fmt } | { kind: 'raw', text: string, fmt: Fmt }} Run
 * @typedef {{
 *   el: HTMLElement,
 *   no: number,
 *   ref: BlockRef,
 *   kind: string,
 *   originals: Node[],
 *   originalMarkdown: string,
 *   wasEditable: string | null,
 * }} EditState
 */

(() => {
  if (/** @type {any} */ (window).__podium__)
    return

  // Slidev reports each page's position by POSTing its shared `nav` state
  // (vite-plugin-vue-server-ref), and the other pages follow. Two kinds of reports must not count:
  //  - Pages Podium embeds (editor canvas, thumbnails, export) are viewers on this computer, and
  //    Slidev's presenter page follows such viewers: picking a slide in the editor would move a
  //    running presentation.
  //  - A presenter page reports where its URL says right after loading, before the slide's click
  //    steps are known. A phone joining mid-talk would reset everyone. So a presenter page
  //    leads only once someone used it (key, click, tap); until then it follows.
  let used = false
  for (const type of ['keydown', 'pointerdown', 'touchstart']) {
    window.addEventListener(type, (event) => {
      if (event.isTrusted)
        used = true
    }, { capture: true, passive: true })
  }
  const sendFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (method === 'POST' && /^\/@server-(?:reactive|ref)\/nav$/.test(new URL(url, location.href).pathname)) {
      const embedded = new URLSearchParams(location.search).has('embedded')
      const presenterNotUsed = location.pathname.startsWith('/presenter') && !used
      if (embedded || presenterNotUsed)
        return Promise.resolve(new Response(''))
    }
    return sendFetch(input, init)
  }

  const TAG = 'podium-bridge'
  const ATTR_BLOCK = 'data-pd-block'
  const ATTR_EDITABLE = 'data-pd-editable'
  const ACCENT = '#2f6fed'
  const ZWSP = '\u200B'
  const FOCUS_RETRY_MS = 3000
  const GOTO_TIMEOUT_MS = 10000
  const READY_TIMEOUT_MS = 30000

  /** @type {BridgeMode | null} */
  let mode = null
  /** @type {Window | null} */
  let host = null
  /** @type {EditState | null} */
  let editing = null
  /** @type {{ no: number, ref: BlockRef } | null} */
  let selected = null
  let lastNo = 0
  let lastFormatState = ''
  let focusToken = 0
  let gotoToken = 0

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  /** @param {Record<string, unknown>} msg */
  function send(msg) {
    if (!host)
      return
    try {
      host.postMessage({ tag: TAG, ...msg }, '*')
    }
    catch {}
  }

  window.addEventListener('message', (event) => {
    const data = event.data
    if (!data || data.tag !== TAG)
      return
    if (window.parent === window || event.source !== window.parent)
      return
    host = window.parent
    handleHostMessage(data)
  })

  /** @param {any} msg */
  function handleHostMessage(msg) {
    switch (msg.type) {
      case 'hello':
        setMode(msg.mode)
        ready().then(({ total }) => send({ type: 'ready', no: currentNo(), total }))
        break
      case 'setMode':
        setMode(msg.mode)
        break
      case 'goto':
        goto(Number(msg.no), msg.clicks == null ? undefined : Number(msg.clicks))
        break
      case 'focusBlock':
        focusBlock(msg.block, !!msg.selectAll)
        break
      case 'format':
        applyFormat(msg.command, msg.value)
        break
      case 'endEdit':
        endEdit(msg.commit !== false)
        break
      case 'clearSelection':
        endEdit(true)
        clearSelected()
        break
      case 'measure':
        send({ type: 'measured', requestId: msg.requestId, report: measure() })
        break
    }
  }

  // ---------------------------------------------------------------------------
  // Slidev access
  // ---------------------------------------------------------------------------

  /** @returns {any} */
  function slidevNav() {
    return /** @type {any} */ (window).__slidev__?.nav
  }

  function currentNo() {
    const no = Number(slidevNav()?.currentSlideNo)
    return Number.isFinite(no) && no > 0 ? no : 1
  }

  function totalSlides() {
    return Number(slidevNav()?.total) || 0
  }

  /** The page element of a slide in the main slide container. Neighbours stay mounted but hidden by v-show. */
  /** @param {number} [no] */
  function slidePage(no = currentNo()) {
    return /** @type {HTMLElement | null} */ (document.querySelector(`#slide-content [data-slidev-no="${no}"]`))
  }

  function slideContent() {
    return /** @type {HTMLElement | null} */ (document.getElementById('slide-content'))
  }

  /** @param {number} no */
  function slideRendered(no, lenient = false) {
    const page = slidePage(no)
    if (!page || page.style.display === 'none')
      return false
    // The previous slide stays visible until its leave transition ends.
    const siblings = page.parentElement ? [...page.parentElement.children] : []
    if (siblings.some(el => el !== page && el.hasAttribute('data-slidev-no') && el instanceof HTMLElement && el.style.display !== 'none'))
      return false
    if (page.querySelector('.slidev-layout'))
      return true
    return lenient && !!page.firstElementChild
  }

  /** @param {number} ms */
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  // Hidden windows (thumbnails, export) produce few or no animation frames, so a frame
  // wait must never depend on requestAnimationFrame alone.
  const frame = () => new Promise((resolve) => {
    const done = () => resolve(undefined)
    requestAnimationFrame(done)
    setTimeout(done, 60)
  })

  /**
   * @param {() => boolean} test
   * @param {number} deadline
   */
  async function until(test, deadline) {
    while (Date.now() < deadline) {
      try {
        if (test())
          return true
      }
      catch {}
      await sleep(30)
    }
    return false
  }

  /**
   * @template T
   * @param {Promise<T>} promise
   * @param {number} deadline
   */
  function withDeadline(promise, deadline) {
    return Promise.race([promise, sleep(Math.max(0, deadline - Date.now()))])
  }

  async function vueFlush() {
    const app = /** @type {any} */ (document.getElementById('app'))?.__vue_app__
    const nextTick = app?._instance?.proxy?.$nextTick
    if (typeof nextTick === 'function')
      await nextTick()
    else
      await sleep(0)
  }

  /** @param {HTMLElement} root */
  function imagesSettled(root) {
    const pending = [...root.querySelectorAll('img')]
      .filter(img => !img.complete)
      .map(img => new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true })
        img.addEventListener('error', resolve, { once: true })
      }))
    return Promise.all(pending)
  }

  /** @returns {Promise<{ total: number }>} */
  async function ready() {
    const deadline = Date.now() + READY_TIMEOUT_MS
    await until(() => !!slidevNav()?.currentSlideRoute, deadline)
    const soft = Date.now() + 3000
    await until(() => slideRendered(currentNo(), Date.now() > soft), deadline)
    await vueFlush()
    return { total: totalSlides() }
  }

  /**
   * @param {number} no
   * @param {number} [clicks] click step to show in view mode (edit/capture reveal everything)
   */
  async function goto(no, clicks) {
    const deadline = Date.now() + GOTO_TIMEOUT_MS
    const token = ++gotoToken
    try {
      await until(() => !!slidevNav()?.go, deadline)
      const nav = slidevNav()
      if (!nav)
        return
      const target = Math.min(Math.max(1, Math.round(no) || 1), Math.max(1, nav.total))
      if (editing && editing.no !== target)
        endEdit(true)
      const step = mode === 'view' && Number.isFinite(clicks) ? Math.max(0, Math.round(/** @type {number} */ (clicks))) : 0
      if (nav.currentSlideNo !== target || nav.clicks !== step)
        await withDeadline(Promise.resolve(nav.go(target, step)).catch(() => {}), deadline)
      const soft = Date.now() + 2000
      await until(() => currentNo() === target && slideRendered(target, Date.now() > soft), deadline)
      await withDeadline(vueFlush(), deadline)
      // Slidev clamps the step to the slide's click count, which is only known once it is mounted.
      // Only the latest goto may do this, or a slow earlier one would undo a newer step.
      if (token === gotoToken && step > 0 && nav.clicks !== Math.min(step, Number(nav.clicksTotal) || 0)) {
        await withDeadline(Promise.resolve(nav.go(target, step)).catch(() => {}), deadline)
        await withDeadline(vueFlush(), deadline)
      }
      await withDeadline(document.fonts?.ready ?? Promise.resolve(), deadline)
      const page = slidePage(target)
      if (page)
        await withDeadline(imagesSettled(page), deadline)
      await withDeadline(frame(), deadline)
      await withDeadline(frame(), deadline)
      checkNavigation()
    }
    catch {}
  }

  // ---------------------------------------------------------------------------
  // Modes and styling
  // ---------------------------------------------------------------------------

  const STYLE_ID = 'podium-bridge-style'
  const M = 'html[data-podium-mode]'
  const EDIT = 'html[data-podium-mode="edit"]'
  const REVEAL = ':is(html[data-podium-mode="edit"], html[data-podium-mode="capture"])'
  const CSS = `
/* Slidev chrome: nav bar (controls slot of the main SlideContainer), goto dialog, context menu, drawing toolbar, remote cursors */
${M} #slide-container > :not(#slide-content) { display: none !important; }
${M} #slidev-goto-dialog, ${M} .z-context-menu, ${M} .z-nav { display: none !important; }
${M} #slide-content > div.pointer-events-none.text-xl { display: none !important; }
${M} body { cursor: auto !important; }
/* Slidev letterboxes in black. Embedded, that shows as a hairline next to the slide. */
${M}, ${M} body, ${M} #page-root, ${M} #slide-container { background: transparent !important; }

/* All v-clicks revealed, nothing animated */
${REVEAL} .slidev-vclick-hidden {
  opacity: 1 !important; pointer-events: auto !important; user-select: auto !important;
  translate: none !important; scale: none !important;
}
${REVEAL} *, ${REVEAL} *::before, ${REVEAL} *::after {
  transition: none !important; animation: none !important;
}
${REVEAL}::view-transition-group(*), ${REVEAL}::view-transition-old(*), ${REVEAL}::view-transition-new(*) { animation: none !important; }
html[data-podium-mode="capture"] #slide-container { pointer-events: none !important; }
html[data-podium-mode="capture"] * { caret-color: transparent !important; }

/* Edit canvas */
${EDIT} #slide-content [${ATTR_BLOCK}] { cursor: default; border-radius: 3px; }
${EDIT} #slide-content [${ATTR_BLOCK}][${ATTR_EDITABLE}], ${EDIT} #slide-content [data-pd-editing] { cursor: text; }
${EDIT} #slide-content [${ATTR_BLOCK}]:hover:not([data-pd-editing]) {
  outline: 1px solid color-mix(in srgb, ${ACCENT} 70%, transparent);
  outline-offset: 3px;
}
${EDIT} #slide-content [${ATTR_BLOCK}]:not([${ATTR_EDITABLE}]):hover:not([data-pd-editing]) { outline-style: dashed; }
${EDIT} #slide-content [data-pd-selected]:not([data-pd-editing]) {
  outline: 2px dashed ${ACCENT};
  outline-offset: 3px;
}
${EDIT} #slide-content [data-pd-editing] {
  outline: 2px solid ${ACCENT} !important;
  outline-offset: 3px;
  box-shadow: 0 0 0 5px color-mix(in srgb, ${ACCENT} 18%, transparent);
  background-color: color-mix(in srgb, ${ACCENT} 6%, transparent);
  caret-color: ${ACCENT};
}
${EDIT} #slide-content [data-pd-editing], ${EDIT} #slide-content [data-pd-editing] * {
  user-select: text !important; -webkit-user-select: text !important;
}
/* An emptied inline item would collapse to nothing and hide the caret. */
${EDIT} #slide-content span[data-pd-editing] { display: inline-block; min-width: 1ch; }
${EDIT} #slide-content [data-pd-editing]:is(h1, h2, h3, h4, h5, h6, p, li):empty { min-height: 1lh; }
/* The stand-in for a single text node flows with the line it is in, so nothing shifts while typing. */
${EDIT} #slide-content span[data-pd-text]:not(:empty) { display: inline; }
${EDIT}[data-pd-over-text] #slide-content * { cursor: text !important; }
${EDIT} #slide-content [data-pd-editing] ::selection { background: color-mix(in srgb, ${ACCENT} 32%, transparent); }
${EDIT} #slide-content [data-pd-editing] a { cursor: text; }
`

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID)
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      ;(document.head || document.documentElement).appendChild(style)
    }
    if (style.textContent !== CSS)
      style.textContent = CSS
  }

  function syncModeAttr() {
    const root = document.documentElement
    if (!mode) {
      root.removeAttribute('data-podium-mode')
      return
    }
    if (root.getAttribute('data-podium-mode') !== mode)
      root.setAttribute('data-podium-mode', mode)
    ensureStyle()
  }

  // ---------------------------------------------------------------------------
  // Click steps on the canvas
  //
  // The editor and the thumbnails show a slide with everything on it. Overriding the look of
  // Slidev's "hidden" class is not enough: a theme may hang its own rules on that class, for
  // example hiding a whole card while its content is still to come
  // (`.card:has(> .slidev-vclick-hidden)`). So the classes themselves come off, and stay off:
  // Slidev sets them again whenever the click step changes.
  // ---------------------------------------------------------------------------

  const CLICK_HIDING = ['slidev-vclick-hidden', 'slidev-vclick-hidden-explicitly', 'slidev-vclick-gone', 'slidev-vclick-display-none']
  const CLICK_HIDING_SELECTOR = CLICK_HIDING.map(name => `.${name}`).join(', ')
  /** What was taken off which element, to give it back when the page returns to plain viewing. */
  /** @type {Map<Element, string[]>} */
  const uncovered = new Map()

  /** @param {Element} el */
  function uncover(el) {
    const found = CLICK_HIDING.filter(name => el.classList.contains(name))
    if (!found.length)
      return
    // Slides re-render with every edit; forget elements that are gone.
    if (uncovered.size > 400) {
      for (const old of uncovered.keys()) {
        if (!old.isConnected)
          uncovered.delete(old)
      }
    }
    uncovered.set(el, [...new Set([...(uncovered.get(el) || []), ...found])])
    el.classList.remove(...found)
  }

  /** @param {ParentNode} root */
  function uncoverAll(root) {
    if (root instanceof Element)
      uncover(root)
    for (const el of root.querySelectorAll(CLICK_HIDING_SELECTOR))
      uncover(el)
  }

  const clickObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element)
        uncover(record.target)
      for (const node of record.addedNodes) {
        if (node instanceof Element)
          uncoverAll(node)
      }
    }
  })
  let uncovering = false

  function syncClickReveal() {
    const wanted = mode === 'edit' || mode === 'capture'
    if (wanted === uncovering)
      return
    uncovering = wanted
    if (wanted) {
      uncoverAll(document)
      clickObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
      return
    }
    clickObserver.disconnect()
    for (const [el, names] of uncovered) {
      if (el.isConnected)
        el.classList.add(...names)
    }
    uncovered.clear()
  }

  /** @param {BridgeMode} next */
  function setMode(next) {
    if (next !== 'edit' && next !== 'view' && next !== 'capture')
      return
    if (mode === 'edit' && next !== 'edit') {
      endEdit(true)
      clearSelected()
    }
    mode = next
    syncModeAttr()
    syncClickReveal()
    if (mode !== 'view') {
      // Clicks are revealed by CSS; drop a clicks query so Slidev's own state matches.
      const nav = slidevNav()
      if (nav && nav.clicks !== 0 && typeof nav.go === 'function')
        Promise.resolve(nav.go(nav.currentSlideNo, 0)).catch(() => {})
    }
  }

  function checkNavigation() {
    syncModeAttr()
    if (!slidevNav())
      return
    const no = currentNo()
    if (no !== lastNo) {
      const first = lastNo === 0
      lastNo = no
      if (editing && editing.no !== no)
        endEdit(true)
      if (selected && selected.no !== no)
        clearSelected()
      if (!first || host)
        send({ type: 'navigated', no })
    }
    if (editing && !editing.el.isConnected) {
      // The slide was replaced underneath us (outside change). Nothing left to commit into.
      editing = null
      send({ type: 'editCancelled' })
    }
  }
  setInterval(checkNavigation, 100)

  // ---------------------------------------------------------------------------
  // Blocks and BlockRef
  // ---------------------------------------------------------------------------

  /** @param {string} s */
  const collapse = s => s.replace(/\u200B/g, '').replace(/\s+/g, ' ').trim()

  /** @param {Element} el */
  function isEmptyListItem(el) {
    return el.tagName === 'LI' && !el.hasAttribute(ATTR_BLOCK) && !el.querySelector('*') && collapse(el.textContent || '') === ''
  }

  /** @param {Element} el */
  function blockKind(el) {
    return el.getAttribute(ATTR_BLOCK) || (isEmptyListItem(el) ? 'listitem' : '')
  }

  /** @param {Element} el */
  function refTag(el) {
    return blockKind(el) === 'listitem' ? 'li' : el.tagName.toLowerCase()
  }

  /** @param {Element} el */
  function isEditable(el) {
    if (el.getAttribute(ATTR_EDITABLE) === '1')
      return true
    // Empty blocks (a fresh heading or list item) carry no inline tokens, so the launcher cannot mark them.
    return !el.querySelector('*') && collapse(el.textContent || '') === ''
  }

  /** Tagged blocks of the current slide in DOM order, plus empty list items the markdown rule cannot tag. */
  /** @param {number} [no] */
  function slideBlocks(no) {
    const page = slidePage(no)
    if (!page)
      return []
    return [...page.querySelectorAll(`[${ATTR_BLOCK}], li`)].filter(el => el.hasAttribute(ATTR_BLOCK) || isEmptyListItem(el))
  }

  /**
   * @param {Element} el
   * @param {number} [no]
   * @returns {BlockRef}
   */
  function blockRef(el, no) {
    const tag = refTag(el)
    const text = collapse(el.textContent || '')
    let occurrence = 0
    let tagIndex = 0
    for (const other of slideBlocks(no)) {
      if (other === el)
        break
      if (refTag(other) !== tag)
        continue
      tagIndex++
      if (collapse(other.textContent || '') === text)
        occurrence++
    }
    return { tag, text, occurrence, tagIndex }
  }

  /** @param {BlockRef} ref */
  function findBlockExact(ref) {
    const text = ref.text
    return slideBlocks().filter(el => refTag(el) === ref.tag && collapse(el.textContent || '') === text)[ref.occurrence] || null
  }

  /** @param {BlockRef} ref */
  function findBlock(ref) {
    const same = slideBlocks().filter(el => refTag(el) === ref.tag)
    const byText = same.filter(el => collapse(el.textContent || '') === ref.text)
    return byText[ref.occurrence] || same[ref.tagIndex] || null
  }

  /** @param {Element} el @returns {Rect} */
  function rectOf(el) {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }

  function clearSelected() {
    for (const el of document.querySelectorAll('[data-pd-selected]'))
      el.removeAttribute('data-pd-selected')
    if (selected) {
      selected = null
      send({ type: 'selectionCleared' })
    }
  }

  /** @param {Element} el */
  function markSelected(el) {
    for (const other of document.querySelectorAll('[data-pd-selected]')) {
      if (other !== el)
        other.removeAttribute('data-pd-selected')
    }
    el.setAttribute('data-pd-selected', '')
  }

  // ---------------------------------------------------------------------------
  // Editing lifecycle
  // ---------------------------------------------------------------------------

  /** @param {HTMLElement} el */
  function startEdit(el) {
    const no = currentNo()
    const ref = blockRef(el, no)
    const kind = blockKind(el)
    const originals = [...el.childNodes]
    // Vue holds references to the original nodes; the user types into clones.
    el.replaceChildren(...originals.map(n => n.cloneNode(true)))
    editing = {
      el,
      no,
      ref,
      kind,
      originals,
      originalMarkdown: toMarkdown(el),
      wasEditable: el.getAttribute('contenteditable'),
    }
    el.setAttribute('contenteditable', 'true')
    el.setAttribute('spellcheck', 'true')
    el.setAttribute('data-pd-editing', '')
    selected = { no, ref }
    markSelected(el)
    lastFormatState = ''
    const rect = rectOf(el)
    send({ type: 'blockSelected', no, block: ref, editable: true, rect })
    send({ type: 'editStarted', no, block: ref, rect })
  }

  /** Put Vue's nodes back and leave edit state. */
  function teardownEdit() {
    const state = editing
    if (!state)
      return null
    editing = null
    const { el } = state
    if (state.kind === 'text') {
      if (el.isConnected)
        el.replaceWith(state.originals[0])
      return state
    }
    if (el.isConnected) {
      el.replaceChildren(...state.originals)
      if (state.wasEditable == null)
        el.removeAttribute('contenteditable')
      else
        el.setAttribute('contenteditable', state.wasEditable)
      el.removeAttribute('spellcheck')
      el.removeAttribute('data-pd-editing')
      if (document.activeElement === el)
        el.blur()
    }
    return state
  }

  /** @param {boolean} commit */
  function endEdit(commit) {
    const state = editing
    if (!state)
      return
    if (state.kind === 'text') {
      const after = commit && state.el.isConnected ? collapse(state.el.textContent || '') : null
      teardownEdit()
      if (after != null && after !== collapse(state.text.before))
        send({ type: 'textCommit', no: state.no, edit: { ...state.text, after } })
      else
        send({ type: 'editCancelled' })
      return
    }
    const markdown = commit && state.el.isConnected ? toMarkdown(state.el) : null
    teardownEdit()
    if (markdown != null && markdown !== state.originalMarkdown)
      send({ type: 'blockCommit', no: state.no, block: state.ref, markdown })
    else
      send({ type: 'editCancelled' })
  }

  /** @param {BlockRef} ref @param {boolean} selectAll */
  async function focusBlock(ref, selectAll) {
    const token = ++focusToken
    const deadline = Date.now() + FOCUS_RETRY_MS
    /** @type {Element | null} */
    let el = null
    // The request usually arrives before Slidev has re-rendered the slide. Until then
    // only an exact text match counts: falling back to the position would pick a
    // neighbouring block from the old DOM. The position is the last resort.
    while (token === focusToken) {
      el = mode === 'edit' && ref ? findBlockExact(ref) : null
      if (el)
        break
      if (Date.now() > deadline) {
        el = mode === 'edit' && ref ? findBlock(ref) : null
        break
      }
      await sleep(60)
    }
    if (!el || token !== focusToken || !(el instanceof HTMLElement))
      return
    if (editing?.el === el)
      return
    endEdit(true)
    if (!isEditable(el)) {
      selectNonEditable(el)
      return
    }
    startEdit(el)
    el.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(el)
    if (!selectAll)
      range.collapse(false)
    const sel = getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    sendFormatState()
  }

  /** @param {Element} el */
  function selectNonEditable(el) {
    const no = currentNo()
    const ref = blockRef(el, no)
    selected = { no, ref }
    markSelected(el)
    send({ type: 'blockSelected', no, block: ref, editable: false, rect: rectOf(el) })
  }

  // ---------------------------------------------------------------------------
  // Text outside the editable markdown blocks
  //
  // HTML in a slide, a heading with an icon in it, a kicker or footer the layout shows from
  // the slide's settings: none of it is a block the markdown rule could mark as editable.
  // It is still text people want to fix, so a click edits the one text node under the
  // pointer, and the deck model finds where that text comes from (src/main/deck/text.ts).
  // ---------------------------------------------------------------------------

  const NO_TEXT_EDIT = 'pre, .slidev-code-wrapper, .shiki, .monaco-editor, svg, math, .katex, .mermaid, textarea, input, select, button, iframe, video, audio, [contenteditable]'

  /** @param {Node} node @param {Element} page */
  function isLooseText(node, page) {
    const parent = node.parentElement
    if (node.nodeType !== 3 || !parent || !page.contains(parent))
      return false
    if (!collapse(node.nodeValue || '') || parent.closest(NO_TEXT_EDIT))
      return false
    const block = parent.closest(`[${ATTR_BLOCK}]`)
    // Editable blocks are edited as a whole, with their formatting.
    return !(block && page.contains(block) && isEditable(block))
  }

  /** The text node under the pointer, if the pointer is on its glyphs. */
  /** @param {number} x @param {number} y @param {Element} page */
  function looseTextAt(x, y, page) {
    const caret = document.caretRangeFromPoint?.(x, y)
    const node = caret?.startContainer
    if (!node || !isLooseText(node, page))
      return null
    const range = document.createRange()
    range.selectNodeContents(node)
    const hit = [...range.getClientRects()].some(r => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2)
    return hit ? /** @type {Text} */ (node) : null
  }

  /**
   * The text a click on `target` means: the text node under the pointer, or, beside the text
   * (a short kicker in a full-width line, the padding of a list item), the element's only text.
   */
  /** @param {Element} target @param {number} x @param {number} y @param {Element} page */
  function looseTextFor(target, x, y, page) {
    const direct = looseTextAt(x, y, page)
    if (direct)
      return { node: direct, beside: false }
    if (target === page || !page.contains(target) || target.classList.contains('slidev-layout') || target.querySelector(`[${ATTR_BLOCK}]`))
      return null
    const own = [...target.childNodes].filter(node => isLooseText(node, page))
    return own.length === 1 ? { node: /** @type {Text} */ (own[0]), beside: true } : null
  }

  /** How the deck model can tell this text node from others with the same text. */
  /** @param {Text} node @param {Element} page @param {number} no */
  function textRef(node, page, no) {
    const text = collapse(node.nodeValue || '')
    const parent = /** @type {Element} */ (node.parentElement)
    const blockEl = parent.closest(`[${ATTR_BLOCK}]`)
    const block = blockEl && page.contains(blockEl) ? blockEl : null
    const walker = document.createTreeWalker(block || page, NodeFilter.SHOW_TEXT)
    let occurrence = 0
    let total = 0
    for (let other = walker.nextNode(); other; other = walker.nextNode()) {
      if (!isLooseText(other, page) || collapse(other.nodeValue || '') !== text)
        continue
      // Without a block, only text outside all blocks counts: the deck model skips block lines too.
      if (!block && other.parentElement?.closest(`[${ATTR_BLOCK}]`))
        continue
      if (other === node)
        occurrence = total
      total++
    }
    return { before: node.nodeValue || '', block: block ? blockRef(block, no) : undefined, occurrence, total }
  }

  /** @param {Text} node @param {Element} page */
  function startTextEdit(node, page) {
    const no = currentNo()
    const text = textRef(node, page, no)
    const el = document.createElement('span')
    // Vue keeps its reference to the text node; the user types into a stand-in.
    el.textContent = node.nodeValue
    el.setAttribute('contenteditable', 'plaintext-only')
    el.setAttribute('spellcheck', 'true')
    el.setAttribute('data-pd-editing', '')
    el.setAttribute('data-pd-text', '')
    node.replaceWith(el)
    editing = { el, no, ref: null, kind: 'text', originals: [node], originalMarkdown: '', wasEditable: null, text }
    clearSelected()
    lastFormatState = ''
  }

  // ---------------------------------------------------------------------------
  // DOM -> inline markdown
  // ---------------------------------------------------------------------------

  /**
   * @param {Node} node
   * @param {Fmt} fmt
   * @param {Run[]} runs
   */
  function flatten(node, fmt, runs) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.nodeValue || '').replace(/\u200B/g, '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ')
        if (text)
          runs.push({ kind: 'text', text, fmt })
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE)
        continue
      const el = /** @type {Element} */ (child)
      switch (el.tagName) {
        case 'BR':
          runs.push({ kind: 'br', fmt })
          break
        case 'STRONG':
        case 'B':
          flatten(el, { ...fmt, bold: true }, runs)
          break
        case 'EM':
        case 'I':
          flatten(el, { ...fmt, italic: true }, runs)
          break
        case 'S':
        case 'DEL':
        case 'STRIKE':
          flatten(el, { ...fmt, strike: true }, runs)
          break
        case 'CODE':
        case 'KBD': {
          const text = (el.textContent || '').replace(/\u200B/g, '').replace(/\u00A0/g, ' ').replace(/\n/g, ' ')
          if (text)
            runs.push({ kind: 'code', text, fmt })
          break
        }
        case 'A': {
          const href = el.getAttribute('href') || ''
          flatten(el, href ? { ...fmt, link: href } : fmt, runs)
          break
        }
        case 'SCRIPT':
        case 'STYLE':
        case 'TEMPLATE':
          break
        default:
          flatten(el, fmt, runs)
      }
    }
  }

  /** @param {Fmt} a @param {Fmt} b */
  const sameFmt = (a, b) => !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike && (a.link || '') === (b.link || '')

  /** @param {string} text */
  function escapeText(text) {
    return text
      .replace(/[\\`*_[\]<~]/g, m => (m === ']' ? m : `\\${m}`))
      .replace(/&(?=#?\w+;)/g, '\\&')
  }

  /** @param {string} text */
  function codeSpan(text) {
    const longest = Math.max(0, ...(text.match(/`+/g) || []).map(s => s.length))
    const fence = '`'.repeat(longest + 1)
    const pad = /^`|`$/.test(text) || (/^ .*[^ ].* $/.test(text)) ? ' ' : ''
    return `${fence}${pad}${text}${pad}${fence}`
  }

  /**
   * Inline markdown for the content of a node.
   * @param {Node} node
   */
  function toMarkdown(node) {
    /** @type {Run[]} */
    const flat = []
    flatten(node, {}, flat)

    // Merge neighbours with the same formatting.
    /** @type {Run[]} */
    let runs = []
    for (const run of flat) {
      const prev = runs[runs.length - 1]
      if (prev && prev.kind === run.kind && (run.kind === 'text' || run.kind === 'code') && sameFmt(prev.fmt, run.fmt))
        /** @type {any} */ (prev).text += /** @type {any} */ (run).text
      else
        runs.push({ ...run })
    }

    // Collapse spaces across run borders, drop leading/trailing line breaks.
    for (let i = 1; i < runs.length; i++) {
      const prev = runs[i - 1]
      const run = runs[i]
      if (prev.kind === 'text' && run.kind === 'text' && prev.text.endsWith(' ') && run.text.startsWith(' '))
        run.text = run.text.slice(1)
    }
    runs = runs.filter(r => r.kind !== 'text' || r.text)
    while (runs.length && runs[runs.length - 1].kind === 'br')
      runs.pop()
    while (runs.length && runs[0].kind === 'br')
      runs.shift()

    // Whitespace-only runs keep only formats both neighbours share, so markers never wrap blanks.
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]
      if (run.kind !== 'text' || run.text.trim())
        continue
      const prev = runs[i - 1]?.fmt || {}
      const next = runs[i + 1]?.fmt || {}
      run.fmt = {
        bold: run.fmt.bold && prev.bold && next.bold,
        italic: run.fmt.italic && prev.italic && next.italic,
        strike: run.fmt.strike && prev.strike && next.strike,
        link: run.fmt.link && run.fmt.link === prev.link && run.fmt.link === next.link ? run.fmt.link : undefined,
      }
    }

    // A link whose text is its own URL goes back to the bare URL (linkify renders it again).
    for (let i = 0; i < runs.length; i++) {
      const href = runs[i].fmt.link
      if (!href)
        continue
      let j = i
      let text = ''
      let plain = true
      while (j < runs.length && runs[j].fmt.link === href) {
        const r = runs[j]
        if (r.kind !== 'text' || !sameFmt(r.fmt, runs[i].fmt))
          plain = false
        else
          text += r.text
        j++
      }
      const bare = href.replace(/^mailto:/, '')
      if (plain && text.trim() === bare) {
        const fmt = { ...runs[i].fmt, link: undefined }
        /** @type {Run[]} */
        const replacement = []
        if (/^\s/.test(text))
          replacement.push({ kind: 'text', text: ' ', fmt })
        replacement.push({ kind: 'raw', text: bare, fmt })
        if (/\s$/.test(text) && text.trim())
          replacement.push({ kind: 'text', text: ' ', fmt })
        runs.splice(i, j - i, ...replacement)
        i += replacement.length - 1
      }
      else {
        i = j - 1
      }
    }

    /** @type {Array<{ key: string, close: string, open: string }>} */
    const stack = []
    let out = ''

    /** @param {Fmt} fmt */
    const needed = (fmt) => {
      /** @type {Array<{ key: string, open: string, close: string }>} */
      const list = []
      if (fmt.link)
        list.push({ key: `link:${fmt.link}`, open: '[', close: `](${/[\s()<>]/.test(fmt.link) ? `<${fmt.link.replace(/[<>]/g, encodeURIComponent)}>` : fmt.link})` })
      if (fmt.bold)
        list.push({ key: 'bold', open: '**', close: '**' })
      if (fmt.italic)
        list.push({ key: 'italic', open: '*', close: '*' })
      if (fmt.strike)
        list.push({ key: 'strike', open: '~~', close: '~~' })
      return list
    }

    /** How many runs from `i` on carry the format `key`; longer spans nest outside. */
    /** @param {number} i @param {string} key */
    const spanLength = (i, key) => {
      let n = 0
      while (i + n < runs.length && needed(runs[i + n].fmt).some(f => f.key === key))
        n++
      return n
    }

    const closeTop = () => {
      const top = stack.pop()
      if (!top)
        return
      if (out.endsWith(top.open)) {
        out = out.slice(0, -top.open.length)
        return
      }
      const ws = /\s*$/.exec(out)?.[0] || ''
      out = out.slice(0, out.length - ws.length) + top.close + ws
    }

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]
      const want = needed(run.fmt)
      const wantKeys = new Set(want.map(f => f.key))
      // Close down to the deepest format that is still wanted.
      let keep = 0
      while (keep < stack.length && wantKeys.has(stack[keep].key))
        keep++
      while (stack.length > keep)
        closeTop()
      const open = want.filter(f => !stack.some(s => s.key === f.key))
        .sort((a, b) => spanLength(i, b.key) - spanLength(i, a.key))

      let body = ''
      if (run.kind === 'text')
        body = escapeText(run.text)
      else if (run.kind === 'code')
        body = codeSpan(run.text)
      else if (run.kind === 'raw')
        body = run.text
      else
        body = '<br>'

      if (open.length) {
        const lead = /^\s*/.exec(body)?.[0] || ''
        out += lead
        body = body.slice(lead.length)
        for (const f of open) {
          out += f.open
          stack.push(f)
        }
      }
      out += body
    }
    while (stack.length)
      closeTop()

    out = out.trim()
    // Plain text at the start of a line that markdown would read as block syntax.
    out = out
      .replace(/^#/, '\\#')
      .replace(/^>/, '\\>')
      .replace(/^([-+])(?=\s|$)/, '\\$1')
      .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2')
    return out
  }

  // ---------------------------------------------------------------------------
  // Inline formatting on the selection
  // ---------------------------------------------------------------------------

  const FORMAT_TAGS = {
    bold: ['STRONG', 'B'],
    italic: ['EM', 'I'],
    strike: ['S', 'DEL', 'STRIKE'],
    code: ['CODE', 'KBD'],
    link: ['A'],
  }
  const FORMAT_CREATE = { bold: 'strong', italic: 'em', strike: 's', code: 'code', link: 'a' }

  function editRange() {
    if (!editing)
      return null
    const sel = getSelection()
    if (!sel || !sel.rangeCount)
      return null
    const range = sel.getRangeAt(0)
    if (!editing.el.contains(range.commonAncestorContainer))
      return null
    return range
  }

  /**
   * @param {Node | null} node
   * @param {string[]} tags
   * @param {Element} root
   */
  function closestWithin(node, tags, root) {
    let cur = node && node.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (node) : node?.parentElement || null
    while (cur && cur !== root && root.contains(cur)) {
      if (tags.includes(cur.tagName))
        return cur
      cur = cur.parentElement
    }
    return null
  }

  /** @param {Node} root @param {string[]} tags */
  function unwrapIn(root, tags) {
    const found = /** @type {Element[]} */ ([...(/** @type {any} */ (root).querySelectorAll?.('*') || [])]).filter(el => tags.includes(el.tagName))
    for (const el of found)
      el.replaceWith(...el.childNodes)
  }

  /** @param {Range} range @param {string[]} tags @param {Element} root */
  function allInside(range, tags, root) {
    if (closestWithin(range.commonAncestorContainer, tags, root))
      return true
    if (range.collapsed)
      return false
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
    let any = false
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!range.intersectsNode(n) || !(n.nodeValue || '').replace(/\u200B/g, '').trim())
        continue
      any = true
      if (!closestWithin(n, tags, root))
        return false
    }
    return any
  }

  /** @param {Node[]} nodes */
  function selectNodes(nodes) {
    const sel = getSelection()
    if (!sel || !nodes.length)
      return
    const range = document.createRange()
    range.setStartBefore(nodes[0])
    range.setEndAfter(nodes[nodes.length - 1])
    sel.removeAllRanges()
    sel.addRange(range)
  }

  /** @param {Node} node @param {number} offset */
  function placeCaret(node, offset) {
    const sel = getSelection()
    if (!sel)
      return
    const range = document.createRange()
    range.setStart(node, offset)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  /**
   * Remove a format from the selection, splitting a surrounding element if needed.
   * @param {Range} range @param {string[]} tags @param {HTMLElement} root
   */
  function removeFormat(range, tags, root) {
    const anc = closestWithin(range.commonAncestorContainer, tags, root)
    if (range.collapsed) {
      if (anc) {
        // Step out of the formatted run so the next typed text is plain.
        const marker = document.createTextNode(ZWSP)
        anc.after(marker)
        placeCaret(marker, 1)
      }
      return
    }
    if (anc) {
      const before = document.createRange()
      before.setStart(anc, 0)
      before.setEnd(range.startContainer, range.startOffset)
      const after = document.createRange()
      after.setStart(range.endContainer, range.endOffset)
      after.setEnd(anc, anc.childNodes.length)
      const head = anc.cloneNode(false)
      head.appendChild(before.cloneContents())
      const tail = anc.cloneNode(false)
      tail.appendChild(after.cloneContents())
      const middle = range.cloneContents()
      unwrapIn(middle, tags)
      const middleNodes = [...middle.childNodes]
      const parts = []
      if (head.textContent)
        parts.push(head)
      parts.push(...middleNodes)
      if (tail.textContent)
        parts.push(tail)
      anc.replaceWith(...parts)
      selectNodes(middleNodes)
      return
    }
    const frag = range.extractContents()
    unwrapIn(frag, tags)
    const nodes = [...frag.childNodes]
    range.insertNode(frag)
    selectNodes(nodes)
  }

  /**
   * @param {Range} range @param {keyof typeof FORMAT_CREATE} format @param {HTMLElement} root @param {string} [href]
   */
  function addFormat(range, format, root, href) {
    const wrapper = document.createElement(FORMAT_CREATE[format])
    if (href)
      wrapper.setAttribute('href', href)
    if (range.collapsed) {
      wrapper.textContent = format === 'link' && href ? href : ZWSP
      range.insertNode(wrapper)
      if (format === 'link')
        selectNodes([wrapper])
      else
        placeCaret(/** @type {Node} */ (wrapper.firstChild), 1)
      return
    }
    const frag = range.extractContents()
    unwrapIn(frag, FORMAT_TAGS[format])
    if (format === 'code')
      wrapper.textContent = frag.textContent || ''
    else
      wrapper.appendChild(frag)
    range.insertNode(wrapper)
    selectNodes([wrapper])
  }

  /** Drop empty format elements left behind by splitting. @param {HTMLElement} root */
  function tidy(root) {
    for (const el of [...root.querySelectorAll('strong,b,em,i,s,del,strike,code,a')]) {
      if (!el.textContent && !el.querySelector('br'))
        el.remove()
    }
  }

  /**
   * @param {'bold' | 'italic' | 'code' | 'link' | 'clear' | 'strike'} command
   * @param {string} [value]
   */
  function applyFormat(command, value) {
    // Plain text has no formatting to apply: where it comes from may not be markdown at all.
    if (!editing || editing.kind === 'text')
      return
    const root = editing.el
    if (document.activeElement !== root)
      root.focus({ preventScroll: true })
    const range = editRange()
    if (!range)
      return
    if (command === 'clear') {
      const all = Object.values(FORMAT_TAGS).flat()
      for (let i = 0; i < 8; i++) {
        const r = editRange()
        if (!r)
          break
        const anc = closestWithin(r.commonAncestorContainer, all, root)
        if (!anc && (r.collapsed || !hasFormatted(r, all)))
          break
        removeFormat(r, anc ? [anc.tagName] : all, root)
        if (r.collapsed)
          break
      }
    }
    else if (command === 'link') {
      const anc = closestWithin(range.commonAncestorContainer, FORMAT_TAGS.link, root)
      if (anc && value)
        anc.setAttribute('href', value)
      else if (anc)
        removeFormat(range, FORMAT_TAGS.link, root)
      else if (value)
        addFormat(range, 'link', root, value)
    }
    else if (command in FORMAT_TAGS) {
      const tags = FORMAT_TAGS[/** @type {keyof typeof FORMAT_TAGS} */ (command)]
      if (allInside(range, tags, root))
        removeFormat(range, tags, root)
      else
        addFormat(range, /** @type {keyof typeof FORMAT_CREATE} */ (command), root)
    }
    tidy(root)
    sendFormatState(true)
  }

  /** @param {Range} range @param {string[]} tags */
  function hasFormatted(range, tags) {
    const frag = range.cloneContents()
    return [...frag.querySelectorAll('*')].some(el => tags.includes(el.tagName))
  }

  function sendFormatState(force = false) {
    if (!editing || editing.kind === 'text')
      return
    const range = editRange()
    if (!range)
      return
    const root = editing.el
    const state = {
      bold: allInside(range, FORMAT_TAGS.bold, root),
      italic: allInside(range, FORMAT_TAGS.italic, root),
      code: allInside(range, FORMAT_TAGS.code, root),
      link: allInside(range, FORMAT_TAGS.link, root),
    }
    const key = JSON.stringify(state)
    if (key === lastFormatState && !force)
      return
    lastFormatState = key
    send({ type: 'formatState', ...state })
  }

  document.addEventListener('selectionchange', () => {
    if (mode === 'edit' && editing)
      sendFormatState()
  })

  // ---------------------------------------------------------------------------
  // Pointer handling
  // ---------------------------------------------------------------------------

  /** @param {Element} el */
  function componentFile(el) {
    const comp = /** @type {any} */ (el).__vueParentComponent
    return String(comp?.type?.__file || comp?.type?.__name || '')
  }

  /** Is the element rendered by a Vue component other than the slide's own markdown? */
  /** @param {Element} el */
  function fromComponent(el) {
    const file = componentFile(el)
    return !!file && !/\.md(?:$|[?_])/.test(file) && !/\/layouts\//.test(file)
  }

  /**
   * @param {Element} target
   * @param {Element} page
   * @returns {'html' | 'component' | 'code' | 'image' | 'table' | 'other' | null} null = background
   */
  function classify(target, page) {
    if (target.closest('img, picture, video, svg, canvas'))
      return 'image'
    if (target.closest('pre, .slidev-code-wrapper, .shiki'))
      return 'code'
    if (target.closest('table'))
      return 'table'
    const block = target.closest(`[${ATTR_BLOCK}]`)
    if (block && page.contains(block)) {
      const parts = [target, ...block.querySelectorAll('*')]
      return parts.some(el => el !== block && block.contains(el) && fromComponent(el)) ? 'component' : 'html'
    }
    // Containers of blocks (layout, columns) and empty decoration count as background.
    if (target === page || target.classList.contains('slidev-layout') || target.querySelector(`[${ATTR_BLOCK}]`))
      return null
    if (!collapse(target.textContent || '') && !target.querySelector('img, svg, video, canvas, iframe'))
      return null
    for (let el = /** @type {Element | null} */ (target); el && el !== page; el = el.parentElement) {
      if (fromComponent(el))
        return 'component'
    }
    return 'html'
  }

  const BLOCKED_POINTER_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend', 'wheel']
  for (const type of BLOCKED_POINTER_EVENTS) {
    window.addEventListener(type, (event) => {
      if (mode === 'capture') {
        event.stopPropagation()
        if (type !== 'wheel')
          event.preventDefault()
        return
      }
      if (mode !== 'edit')
        return
      if (type === 'pointerdown')
        onEditPointerDown(/** @type {PointerEvent} */ (event))
      const target = /** @type {Element} */ (event.target)
      // Links must not open while the slide is edited.
      if ((type === 'click' || type === 'auxclick') && target instanceof Element && target.closest('a'))
        event.preventDefault()
      // Slidev navigates on clicks and swipes; components react to clicks. Neither should happen on the canvas.
      event.stopPropagation()
    }, { capture: true, passive: false })
  }

  /** @param {PointerEvent} event */
  function onEditPointerDown(event) {
    const target = event.target instanceof Element ? event.target : null
    if (!target)
      return
    if (editing && editing.el.contains(target))
      return // caret moves inside the block, natively
    const content = slideContent()
    const page = slidePage()
    if (!content || !page || !page.contains(target)) {
      if (content?.contains(target) || target.closest('#slide-container')) {
        endEdit(true)
        clearSelected()
        send({ type: 'backgroundClicked', no: currentNo() })
      }
      return
    }
    if (event.button !== 0 && event.button !== 2)
      return

    let block = /** @type {HTMLElement | null} */ (target.closest(`[${ATTR_BLOCK}], li`))
    let besideText = false
    if (block && block.tagName === 'LI' && !blockKind(block)) {
      // Click on the bullet or padding of an item: edit the item's own text.
      const own = /** @type {HTMLElement | null} */ (block.querySelector(`:scope > [${ATTR_BLOCK}], :scope > p > [${ATTR_BLOCK}]`))
      if (own) {
        block = own
        besideText = true
      }
    }
    const isBlock = block && page.contains(block) && blockKind(block)
    const visual = target.closest('img, picture, video, svg, canvas, pre, .slidev-code-wrapper, table')

    if (isBlock && block && isEditable(block) && !(visual && block.contains(visual))) {
      if (editing?.el === block)
        return
      endEdit(true)
      // contenteditable before the default mousedown action, so the browser puts the caret where the user clicked.
      startEdit(block)
      if (besideText) {
        event.preventDefault()
        block.focus({ preventScroll: true })
        const range = document.createRange()
        range.selectNodeContents(block)
        range.collapse(false)
        getSelection()?.removeAllRanges()
        getSelection()?.addRange(range)
      }
      return
    }

    const text = event.button === 0 && (!visual || visual.tagName === 'TABLE') ? looseTextFor(target, event.clientX, event.clientY, page) : null
    if (text) {
      endEdit(true)
      if (!text.node.isConnected)
        return
      // As above: editable before the default mousedown action, so the caret lands where the user clicked.
      startTextEdit(text.node, page)
      if (text.beside && editing) {
        event.preventDefault()
        editing.el.focus({ preventScroll: true })
        const range = document.createRange()
        range.selectNodeContents(editing.el)
        range.collapse(false)
        getSelection()?.removeAllRanges()
        getSelection()?.addRange(range)
      }
      return
    }

    endEdit(true)
    event.preventDefault()
    const what = classify(target, page)
    if (isBlock && block) {
      selectNonEditable(block)
      send({ type: 'codeClicked', no: currentNo(), what: what || 'html', rect: rectOf(block) })
      return
    }
    if (what == null) {
      clearSelected()
      send({ type: 'backgroundClicked', no: currentNo() })
      return
    }
    clearSelected()
    const box = visual || target
    send({ type: 'codeClicked', no: currentNo(), what, rect: rectOf(box) })
  }

  // Text outside the marked blocks has no element of its own to style on hover, so the
  // pointer says where typing is possible.
  let overTextFrame = 0
  window.addEventListener('pointermove', (event) => {
    if (mode !== 'edit' || overTextFrame)
      return
    overTextFrame = requestAnimationFrame(() => {
      overTextFrame = 0
      const page = mode === 'edit' && !editing ? slidePage() : null
      const target = event.target instanceof Element ? event.target : null
      const over = !!page && !!target && !target.closest('img, picture, video, svg, canvas, pre, .slidev-code-wrapper') && !!looseTextFor(target, event.clientX, event.clientY, page)
      document.documentElement.toggleAttribute('data-pd-over-text', over)
    })
  }, { capture: true, passive: true })

  window.addEventListener('focusout', (event) => {
    if (mode !== 'edit' || !editing || event.target !== editing.el)
      return
    const related = /** @type {Node | null} */ (event.relatedTarget)
    if (related && editing.el.contains(related))
      return
    const state = editing
    // Focus moving to the host window (toolbar click) keeps the edit open; `format` follows.
    // Whether focus left the frame is only known after the focus change settled.
    setTimeout(() => {
      if (editing !== state || !document.hasFocus())
        return
      if (document.activeElement === state.el)
        return
      endEdit(true)
    }, 0)
  }, true)

  window.addEventListener('paste', (event) => {
    if (mode !== 'edit' || !editing)
      return
    event.preventDefault()
    event.stopPropagation()
    const text = (event.clipboardData?.getData('text/plain') || '').replace(/\s*\r?\n\s*/g, ' ')
    if (text)
      document.execCommand('insertText', false, text)
  }, true)

  for (const type of ['drop', 'dragover']) {
    window.addEventListener(type, (event) => {
      if (mode === 'edit' && editing && event.target instanceof Node && editing.el.contains(event.target))
        event.preventDefault()
    }, true)
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  /** @param {KeyboardEvent} event */
  function looksLikeShortcut(event) {
    if (['Control', 'Meta', 'Shift', 'Alt', 'AltGraph'].includes(event.key))
      return false
    if (event.ctrlKey || event.metaKey)
      return true
    return ['Delete', 'Backspace', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'F5', 'Escape'].includes(event.key)
  }

  /** @param {KeyboardEvent} event */
  function forwardShortcut(event) {
    send({ type: 'shortcut', key: event.key, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey })
  }

  /** @param {HTMLElement} el */
  function isEmptyBlock(el) {
    return !(el.textContent || '').replace(/\u200B/g, '').trim() && !el.querySelector('img')
  }

  function splitListItem() {
    const state = editing
    const range = editRange()
    if (!state || !range)
      return
    if (!range.collapsed)
      range.deleteContents()
    const before = document.createRange()
    before.setStart(state.el, 0)
    before.setEnd(range.startContainer, range.startOffset)
    const after = document.createRange()
    after.setStart(range.startContainer, range.startOffset)
    after.setEnd(state.el, state.el.childNodes.length)
    const head = document.createElement('div')
    head.appendChild(before.cloneContents())
    const tail = document.createElement('div')
    tail.appendChild(after.cloneContents())
    const markdown = toMarkdown(head)
    const rest = toMarkdown(tail)
    teardownEdit()
    send({ type: 'listItemSplit', no: state.no, block: state.ref, markdown, rest })
  }

  window.addEventListener('keydown', (event) => {
    if (!mode)
      return
    if (mode === 'capture') {
      event.stopPropagation()
      event.preventDefault()
      return
    }
    if (mode === 'view') {
      if (event.ctrlKey || event.metaKey || event.key === 'F5') {
        if (!['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) {
          event.preventDefault()
          event.stopPropagation()
          forwardShortcut(event)
        }
      }
      return
    }

    // edit mode
    event.stopPropagation()
    if (!editing) {
      if (looksLikeShortcut(event)) {
        event.preventDefault()
        forwardShortcut(event)
      }
      else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
      }
      return
    }

    if (event.isComposing || event.keyCode === 229)
      return
    const el = editing.el
    const mod = event.ctrlKey || event.metaKey
    const key = event.key

    if (key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      if (editing.kind !== 'text')
        document.execCommand('insertLineBreak')
      return
    }
    if (key === 'Enter') {
      event.preventDefault()
      if (editing.kind === 'listitem')
        splitListItem()
      else
        endEdit(true)
      return
    }
    if (key === 'Escape') {
      event.preventDefault()
      endEdit(false)
      return
    }
    if ((key === 'Backspace' || key === 'Delete') && editing.kind !== 'text' && isEmptyBlock(el)) {
      event.preventDefault()
      const state = teardownEdit()
      if (state)
        send({ type: 'blockRemove', no: state.no, block: state.ref })
      return
    }
    if (mod && !event.altKey && !event.shiftKey && (key === 'b' || key === 'B')) {
      event.preventDefault()
      applyFormat('bold')
      return
    }
    if (mod && !event.altKey && !event.shiftKey && (key === 'i' || key === 'I')) {
      event.preventDefault()
      applyFormat('italic')
      return
    }
    if (mod && ['u', 'U'].includes(key)) {
      event.preventDefault() // markdown has no underline
      return
    }
    // Other app shortcuts (save, undo of the deck ...) still reach the host; text editing keys stay local.
    if (mod && !['a', 'c', 'x', 'v', 'z', 'y', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Backspace', 'Delete', 'Control', 'Meta', 'Shift', 'Alt'].includes(key.length === 1 ? key.toLowerCase() : key)) {
      event.preventDefault()
      forwardShortcut(event)
    }
  }, true)

  window.addEventListener('keyup', (event) => {
    if (mode === 'capture' || mode === 'edit')
      event.stopPropagation()
  }, true)

  // ---------------------------------------------------------------------------
  // Overflow measurement
  // ---------------------------------------------------------------------------

  /** @returns {OverflowReport} */
  function measure() {
    const no = currentNo()
    const report = { no, overflowX: 0, overflowY: 0 }
    const content = slideContent()
    const page = slidePage(no)
    if (!content || !page)
      return report
    const box = content.getBoundingClientRect()
    const scale = content.offsetWidth ? box.width / content.offsetWidth : 1
    if (!scale)
      return report
    const layout = /** @type {HTMLElement | null} */ (page.querySelector('.slidev-layout')) || page
    const pageScale = page.offsetWidth ? page.getBoundingClientRect().width / page.offsetWidth / scale : 1

    let x = Math.max(0, layout.scrollWidth - layout.clientWidth) * pageScale
    let y = Math.max(0, layout.scrollHeight - layout.clientHeight) * pageScale

    /** @param {Element} el */
    const visit = (el) => {
      const style = getComputedStyle(el)
      if (style.display === 'none')
        return
      if (style.display !== 'contents') {
        const r = el.getBoundingClientRect()
        const fullBleed = (style.position === 'absolute' || style.position === 'fixed')
          && r.width >= box.width - 1 && r.height >= box.height - 1
        if (r.width > 0 && r.height > 0 && !fullBleed && style.visibility !== 'hidden') {
          x = Math.max(x, (r.right - box.right) / scale, (box.left - r.left) / scale)
          y = Math.max(y, (r.bottom - box.bottom) / scale, (box.top - r.top) / scale)
        }
        // Clipped containers: their children cannot stick out further than they do.
        if (el !== layout && /(hidden|clip|auto|scroll)/.test(style.overflowX + style.overflowY))
          return
      }
      for (const child of el.children)
        visit(child)
    }
    for (const child of layout.children)
      visit(child)

    report.overflowX = x >= 1 ? Math.round(x) : 0
    report.overflowY = y >= 1 ? Math.round(y) : 0
    return report
  }

  // ---------------------------------------------------------------------------
  // Page API for hidden windows
  // ---------------------------------------------------------------------------

  /** @type {import('../src/shared/bridge').PodiumPageApi} */
  const api = {
    ready,
    goto,
    measure,
    setMode,
  }
  Object.defineProperty(window, '__podium__', { value: api, configurable: false, writable: false })

  // Exposed for tests only; not part of the contract.
  Object.defineProperty(window, '__podiumInternals__', { value: { toMarkdown, blockRef, slideBlocks }, configurable: true })
})()
