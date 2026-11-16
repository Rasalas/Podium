/**
 * Script injected into a hidden Slidev page when the launcher's bridge client
 * (`window.__podium__`) is missing. Same contract as PodiumPageApi, built on
 * Slidev's own `window.__slidev__` (dev server only).
 */
export const FALLBACK_SCRIPT = String.raw`(() => {
  if (window.__podium__ || window.__podiumFallback) return
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const frames = async n => { for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(() => r())) }
  const until = async (fn, ms, what) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      try { const v = fn(); if (v) return v } catch {}
      await sleep(40)
    }
    throw new Error('timeout waiting for ' + what)
  }
  const style = document.createElement('style')
  style.id = 'podium-fallback-style'
  const CSS = '.slidev-nav,.slidev-nav-button,#slidev-goto-dialog,.slidev-controls,.slidev-vclick-hidden-placeholder{display:none!important}'
    + '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}'
    + 'html,body{overflow:hidden!important}*{cursor:none!important}'
  const api = {
    async ready() {
      const ctx = await until(() => window.__slidev__ && window.__slidev__.nav && window.__slidev__.nav.total > 0 && window.__slidev__, 60000, 'slidev')
      await until(() => document.querySelector('.slidev-page'), 30000, 'first slide')
      await document.fonts.ready
      return { total: ctx.nav.total }
    },
    setMode(mode) {
      if (!style.isConnected) { style.textContent = CSS; document.head.appendChild(style) }
      api.mode = mode
    },
    async goto(no) {
      const nav = window.__slidev__.nav
      await nav.go(no, 9999)
      await until(() => nav.currentSlideNo === no && document.querySelector('[data-slidev-no="' + no + '"]'), 20000, 'slide ' + no)
      const root = document.querySelector('[data-slidev-no="' + no + '"]')
      await until(() => !root.querySelector('.slidev-slide-loading'), 20000, 'slide loading')
      await document.fonts.ready
      const imgs = [...root.querySelectorAll('img')]
      await Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = () => r(0) })))
      await Promise.all(imgs.map(i => i.decode ? i.decode().catch(() => {}) : 0))
      await frames(2)
      await sleep(60)
      await frames(2)
    },
    measure() {
      const nav = window.__slidev__.nav
      const no = nav.currentSlideNo
      const root = document.querySelector('[data-slidev-no="' + no + '"]') || document
      const layout = root.querySelector('.slidev-layout') || root.querySelector('.slidev-page')
      if (!layout) return { no, overflowX: 0, overflowY: 0 }
      const r = layout.getBoundingClientRect()
      const scale = layout.offsetWidth ? r.width / layout.offsetWidth : 1
      let ox = layout.scrollWidth - layout.clientWidth
      let oy = layout.scrollHeight - layout.clientHeight
      for (const el of layout.querySelectorAll('*')) {
        const b = el.getBoundingClientRect()
        if (!b.width && !b.height) continue
        oy = Math.max(oy, (b.bottom - r.bottom) / scale)
        ox = Math.max(ox, (b.right - r.right) / scale)
      }
      return { no, overflowX: Math.max(0, Math.round(ox)), overflowY: Math.max(0, Math.round(oy)) }
    },
  }
  window.__podiumFallback = api
})()`

/** Expression that yields the page API (real bridge client or fallback). */
export const API_EXPR = '(window.__podium__ || window.__podiumFallback)'
