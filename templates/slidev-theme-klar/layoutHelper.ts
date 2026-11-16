import type { CSSProperties } from 'vue'

/** Turns "/images/x.png" into a URL that respects the deck's base path. */
export function resolveAssetUrl(url: string) {
  if (url.startsWith('/'))
    return import.meta.env.BASE_URL + url.slice(1)
  return url
}

/** Background style from a frontmatter value: a colour or an image URL. */
export function backgroundStyle(value?: string, size = 'cover', dim = false): CSSProperties {
  if (!value)
    return {}
  const isColor = ['#', 'rgb', 'hsl'].some(v => value.startsWith(v))
  if (isColor)
    return { background: value }
  const url = `url("${resolveAssetUrl(value)}")`
  return {
    backgroundImage: dim ? `linear-gradient(#0a0e1699, #0a0e16cc), ${url}` : url,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
    backgroundSize: size,
  }
}
