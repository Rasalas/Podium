// Scripts for the presentation's Slidev pages (no preload), run through
// webContents.executeJavaScript against Slidev's client API `window.__slidev__.nav`
// (see @slidev/client/composables/useNav.ts), which Slidev exposes in dev mode.
import type { PresentPosition } from '../../shared/types'

/** Expression that evaluates to the current PresentPosition, or null while Slidev is not up yet. */
export const READ_POSITION = `(() => {
  const nav = window.__slidev__ && window.__slidev__.nav
  // Until the router resolved the URL, Slidev reports slide 1 whatever the URL says.
  if (!nav || !nav.currentSlideRoute || nav.hasPrimarySlide === false)
    return null
  const clicksTotal = Math.max(0, Number(nav.clicksTotal) || 0)
  // Going back onto a slide asks for "all clicks" with a huge number; report what is visible.
  const clicks = Math.min(Math.max(0, Number(nav.clicks) || 0), clicksTotal)
  return { no: Number(nav.currentSlideNo) || 1, clicks, clicksTotal, total: Number(nav.total) || 0 }
})()`

/** Expression that runs Slidev's own "next" (the same as a clicker press) and resolves true when it ran. */
export const NEXT_STEP = `(async () => {
  const nav = window.__slidev__ && window.__slidev__.nav
  if (!nav)
    return false
  await nav.next()
  return true
})()`

export function samePosition(a: PresentPosition | undefined, b: PresentPosition | undefined): boolean {
  if (!a || !b)
    return a === b
  return a.no === b.no && a.clicks === b.clicks && a.clicksTotal === b.clicksTotal && a.total === b.total
}

export function parsePosition(value: unknown): PresentPosition | undefined {
  if (!value || typeof value !== 'object')
    return undefined
  const v = value as Record<string, unknown>
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  if (!num(v.no))
    return undefined
  return { no: num(v.no), clicks: num(v.clicks), clicksTotal: num(v.clicksTotal), total: num(v.total) }
}
