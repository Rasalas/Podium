import { describe, expect, it } from 'vitest'
import { fieldTypeFor, humanise, scanVue, starterFromSlots } from '../../../src/main/templates/scanner'

describe('scanVue', () => {
  it('finds default and named slots, ignores dynamic ones and comments', () => {
    const scan = scanVue(`<template><div><!-- <slot name="gone" /> --><slot name="right"/><slot /><slot name='x'></slot><slot :name="n" /></div></template>`)
    expect(scan.slots).toEqual(['default', 'right', 'x'])
  })

  it('reads a TS type literal', () => {
    const scan = scanVue(`<script setup lang="ts">
defineProps<{
  url: string // where
  scale?: number
  on: boolean; label: 'a' | 'b'
  cb: (x: number) => void
}>()
</script>`)
    expect(scan.props).toEqual([
      { key: 'url', kind: 'string' },
      { key: 'scale', kind: 'number' },
      { key: 'on', kind: 'boolean' },
      { key: 'label', kind: 'string' },
      { key: 'cb', kind: 'other' },
    ])
  })

  it('reads a type alias or interface and withDefaults', () => {
    const scan = scanVue(`<script setup lang="ts">
interface Props { image?: string, size: number }
const props = withDefaults(defineProps<Props>(), { size: 2 })
</script>`)
    expect(scan.props.map(p => p.key)).toEqual(['image', 'size'])
  })

  it('reads runtime props with nested objects', () => {
    const scan = scanVue(`<script setup>
const props = defineProps({
  image: { type: String, default: 'a,b' },
  size: Number,
  dark: { type: Boolean, default: false },
  other: { type: Object, default: () => ({ a: 1, b: 2 }) },
})
</script>`)
    expect(scan.props).toEqual([
      { key: 'image', kind: 'string' },
      { key: 'size', kind: 'number' },
      { key: 'dark', kind: 'boolean' },
      { key: 'other', kind: 'other' },
    ])
  })

  it('reads the options API', () => {
    expect(scanVue(`<script>export default { props: ['a', 'b'] }</script>`).props.map(p => p.key)).toEqual(['a', 'b'])
  })

  it('copes with a layout that has no script', () => {
    expect(scanVue('<template><div /></template>')).toEqual({ slots: [], props: [] })
  })
})

describe('helpers', () => {
  it('humanises names', () => {
    expect(humanise('two-cols-header')).toBe('Two cols header')
    expect(humanise('backgroundSize')).toBe('Background size')
  })
  it('guesses field types', () => {
    expect(fieldTypeFor({ key: 'heroImage', kind: 'string' })).toBe('image')
    expect(fieldTypeFor({ key: 'background', kind: 'string' })).toBe('image')
    expect(fieldTypeFor({ key: 'homepageUrl', kind: 'string' })).toBe('url')
    expect(fieldTypeFor({ key: 'accentColor', kind: 'string' })).toBe('color')
    expect(fieldTypeFor({ key: 'x', kind: 'boolean' })).toBe('boolean')
    expect(fieldTypeFor({ key: 'x', kind: 'number' })).toBe('number')
    expect(fieldTypeFor({ key: 'title', kind: 'string' })).toBe('text')
  })
  it('builds starter text from slots', () => {
    expect(starterFromSlots(['default', 'right'], 'Two', 'Text')).toBe('# Two\n\nText\n\n::right::\n\nText')
  })
})
