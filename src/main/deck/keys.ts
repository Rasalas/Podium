/**
 * Which keys of the entry file's first frontmatter block configure the deck and which
 * belong to slide 1.
 *
 * Rule: a key is deck-level when Slidev knows it as a deck configuration key, that is a
 * key of `getDefaultConfig()` (theme, title, aspectRatio, fonts, transition, ...) or one
 * of the headmatter-only keys below (`defaults`, `config`). Every other key is
 * slide-level and belongs to slide 1, including layout fields Slidev does not know.
 *
 * Keys that exist on both levels in Slidev's types (`title`, `transition`,
 * `clickAnimation`) count as deck-level in the first block, because there they set the
 * deck title and the default for all slides.
 */
import { getDefaultConfig } from '@slidev/parser'

const HEADMATTER_ONLY = ['defaults', 'config']

export const DECK_KEYS: ReadonlySet<string> = new Set([...Object.keys(getDefaultConfig()), ...HEADMATTER_ONLY])

export function isDeckKey(key: string): boolean {
  return DECK_KEYS.has(key)
}
