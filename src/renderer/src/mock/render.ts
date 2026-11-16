// HTML and thumbnail rendering for the mock backend's slides.
import type { DeckSnapshot, SlideSnapshot } from '@shared/types'
import { blockRefs, inlineToHtml, parseBlocks } from './markdown'

export const THEME_COLORS: Record<string, { background: string, foreground: string, accent: string }> = {
  'klar': { background: '#ffffff', foreground: '#1d2433', accent: '#2f6fdf' },
  'seriph': { background: '#fbf7f0', foreground: '#2b2118', accent: '#a4572c' },
  'default': { background: '#ffffff', foreground: '#181818', accent: '#3d8a73' },
  'apple-basic': { background: '#111111', foreground: '#f5f5f5', accent: '#0a84ff' },
}

export function colorsFor(theme: string) {
  return THEME_COLORS[theme] ?? THEME_COLORS.default
}

function esc(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function imageUrl(src: string, base: string) {
  return src.startsWith('/') ? base + src : src
}

/** Inner HTML of one slide, with the data attributes the real launcher puts on editable blocks. */
export function renderSlideHtml(slide: SlideSnapshot, base: string): string {
  const refs = blockRefs(slide.content)
  const refByStart = new Map(refs.map(r => [r.block.start, r.ref]))
  const columns: Record<string, string[]> = { default: [] }
  let slot = 'default'
  let list: { tag: 'ul' | 'ol', items: string[] } | undefined
  const flush = () => {
    if (list)
      columns[slot].push(`<${list.tag}>${list.items.join('')}</${list.tag}>`)
    list = undefined
  }
  const lines = slide.content.split('\n')
  for (const block of parseBlocks(slide.content)) {
    const ref = refByStart.get(block.start)
    const attrs = ref
      ? ` data-pd-block="${block.kind === 'heading' ? 'heading' : block.tag === 'li' ? 'listitem' : 'paragraph'}" data-pd-editable="1" data-ref="${esc(JSON.stringify(ref))}"`
      : ''
    if (block.kind === 'li' || block.kind === 'oli') {
      const tag = block.kind === 'li' ? 'ul' : 'ol'
      if (list?.tag !== tag) {
        flush()
        list = { tag, items: [] }
      }
      list.items.push(`<li${attrs}>${inlineToHtml(block.markdown)}</li>`)
      continue
    }
    flush()
    switch (block.kind) {
      case 'slot':
        slot = block.slot
        columns[slot] ??= []
        break
      case 'heading':
        columns[slot].push(`<${block.tag}${attrs}>${inlineToHtml(block.markdown)}</${block.tag}>`)
        break
      case 'p':
        columns[slot].push(`<p${attrs}>${inlineToHtml(block.markdown)}</p>`)
        break
      case 'quote':
        columns[slot].push(`<blockquote><p${attrs}>${inlineToHtml(block.markdown)}</p></blockquote>`)
        break
      case 'code':
        columns[slot].push(`<pre data-pd-code="code"><code>${esc(lines.slice(block.start + 1, block.end - 1).join('\n'))}</code></pre>`)
        break
      case 'table': {
        const rows = lines.slice(block.start, block.end).filter(l => !/^\|[\s|:-]+\|$/.test(l.trim()))
        const cells = rows.map(r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inlineToHtml(c.trim())))
        const [head, ...body] = cells
        columns[slot].push(`<table data-pd-code="table"><thead><tr>${(head ?? []).map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
        break
      }
      case 'image': {
        const m = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(block.markdown)
        columns[slot].push(`<img data-pd-code="image" alt="${esc(m?.[1] ?? '')}" src="${esc(imageUrl(m?.[2] ?? '', base))}">`)
        break
      }
      case 'html':
        // The mock cannot run Vue components; show their source as a stand-in.
        columns[slot].push(`<div data-pd-code="html"><pre class="html-src">${esc(lines.slice(block.start, block.end).join('\n'))}</pre></div>`)
        break
    }
  }
  flush()
  const fm = slide.frontmatter
  const image = typeof fm.image === 'string' && fm.image ? imageUrl(fm.image, base) : ''
  const layout = slide.layout
  const body = (name: string) => `<div class="slot slot-${name}">${(columns[name] ?? []).join('\n')}</div>`
  if (layout === 'two-cols' || layout === 'two-cols-header')
    return `<div class="layout layout-${layout}">${body('default')}<div class="cols">${body('left')}${body('right')}</div></div>`
  if (layout === 'image-right' || layout === 'image-left')
    return `<div class="layout layout-${layout}">${body('default')}<div class="image" style="background-image:url('${esc(image)}')"></div></div>`
  const bg = image && layout === 'cover' ? ` style="background-image:url('${esc(image)}')"` : ''
  return `<div class="layout layout-${layout}"${bg}>${body('default')}</div>`
}

/** Simple picture of a slide for the slide list: colours, title and a bar per line. */
export function drawThumbnail(deck: DeckSnapshot, slide: SlideSnapshot): string {
  const width = 320
  const height = Math.round(width * deck.canvas.height / deck.canvas.width)
  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2
  const ctx = canvas.getContext('2d')
  if (!ctx)
    return ''
  ctx.scale(2, 2)
  const colors = colorsFor(deck.theme)
  const dark = slide.layout === 'section' || slide.layout === 'statement'
  ctx.fillStyle = dark ? colors.accent : colors.background
  ctx.fillRect(0, 0, width, height)
  const centered = ['cover', 'center', 'section', 'statement', 'fact', 'end', 'quote'].includes(slide.layout)
  ctx.fillStyle = dark ? colors.background : colors.foreground
  ctx.font = `600 ${centered ? 22 : 18}px system-ui, sans-serif`
  ctx.textAlign = centered ? 'center' : 'left'
  const x = centered ? width / 2 : 22
  let y = centered ? height / 2 - 6 : 38
  ctx.fillText(slide.title || '', x, y, width - 44)
  const rest = parseBlocks(slide.content).filter(b => b.kind !== 'heading' && b.kind !== 'slot').length
  ctx.fillStyle = dark ? 'rgba(255,255,255,.55)' : `${colors.foreground}55`
  y += 18
  const twoCols = slide.layout.startsWith('two-cols')
  for (let i = 0; i < Math.min(rest, 8); i++) {
    const w = centered ? 120 : twoCols ? 110 : 180 + (i % 3) * 30
    const bx = centered ? width / 2 - w / 2 : twoCols && i % 2 ? width / 2 + 10 : 22
    ctx.fillRect(bx, y, w, 6)
    if (!twoCols || i % 2)
      y += 14
  }
  if (slide.layout === 'image-right' || slide.layout === 'image-left') {
    ctx.fillStyle = `${colors.accent}55`
    ctx.fillRect(slide.layout === 'image-right' ? width / 2 : 0, 0, width / 2, height)
  }
  ctx.fillStyle = colors.accent
  ctx.fillRect(0, height - 4, width, 4)
  return canvas.toDataURL('image/png')
}
