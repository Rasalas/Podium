import type { FieldType, LayoutInfo, LayoutSketch, Locale } from '../../shared/types'

/** Text that is either one string for every language or a per-language map. */
export type Localized = string | { de?: string, en?: string }

export interface CatalogField {
  key: string
  type: FieldType
  label: Localized
  description?: Localized
  options?: { value: string, label: Localized }[]
  default?: unknown
}

export interface CatalogSlot {
  name: string
  label: Localized
}

/** Metadata about one layout, in both languages. Used by the built-in catalog and by podium.json. */
export interface LayoutMeta {
  label?: Localized
  description?: Localized
  category?: LayoutInfo['category']
  sketch?: LayoutSketch
  slots?: CatalogSlot[]
  fields?: CatalogField[]
  starter?: Localized
  hidden?: boolean
}

/** Contents of a theme's podium.json. */
export interface ThemeManifest {
  label?: Localized
  description?: Localized
  colors?: { background: string, foreground: string, accent: string }
  /** Path of the starter deck, relative to the theme folder. */
  starter?: string
  layouts?: Record<string, LayoutMeta>
}

export function localize(value: Localized | undefined, locale: Locale): string {
  if (value === undefined)
    return ''
  if (typeof value === 'string')
    return value
  return value[locale] ?? value.en ?? value.de ?? ''
}
