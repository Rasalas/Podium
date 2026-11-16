import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createTemplateRegistry } from '../../../src/main/templates'
import { fakeRuntime, FIXTURES, fixtureRuntime, registryOptions, ROOT } from './helpers'

// Two tests read the real themes of the development runtime; a fresh checkout (CI) has none.
const hasDevRuntime = existsSync(join(ROOT, '.dev-runtime', 'node_modules', '@slidev', 'theme-seriph', 'package.json'))
const empty = mkdtempSync(join(tmpdir(), 'podium-tpl-'))
afterAll(() => rmSync(empty, { recursive: true, force: true }))

const deck = (theme: string, addons: string[] = [], dir = empty) => ({ dir, theme, addons })
const by = <T extends { name: string }>(list: T[], name: string) => list.find(l => l.name === name)

describe('layoutsFor: Slidev base layouts', () => {
  it('describes every base layout and hides the technical ones', async () => {
    const reg = createTemplateRegistry(registryOptions(fakeRuntime()))
    const layouts = await reg.layoutsFor(deck('default'))
    const names = layouts.map(l => l.name)
    for (const n of ['cover', 'default', 'center', 'two-cols', 'two-cols-header', 'image-left', 'image-right', 'image', 'iframe', 'quote', 'statement', 'fact', 'section', 'end', 'full'])
      expect(names).toContain(n)
    for (const n of ['404', 'error', 'none'])
      expect(by(layouts, n)?.hidden).toBe(true)
    expect(layouts.filter(l => !l.hidden).every(l => l.label && l.description)).toBe(true)
    expect(layouts.at(-1)?.hidden).toBe(true)
  })

  it('uses plain German labels', async () => {
    const reg = createTemplateRegistry(registryOptions(fakeRuntime()))
    const layouts = await reg.layoutsFor(deck('seriph'))
    expect(by(layouts, 'cover')?.label).toBe('Titelfolie')
    expect(by(layouts, 'default')?.label).toBe('Titel und Inhalt')
    expect(by(layouts, 'two-cols')?.label).toBe('Zwei Spalten')
    expect(by(layouts, 'image-left')?.label).toBe('Bild links')
    expect(by(layouts, 'section')?.label).toBe('Abschnitt')
    expect(by(layouts, 'quote')?.label).toBe('Zitat')
    expect(by(layouts, 'fact')?.label).toBe('Kennzahl')
    expect(by(layouts, 'statement')?.label).toBe('Aussage')
    expect(by(layouts, 'end')?.label).toBe('Schlussfolie')
  })

  it('follows the locale', async () => {
    const reg = createTemplateRegistry(registryOptions(fakeRuntime(), 'en'))
    const layouts = await reg.layoutsFor(deck('default'))
    expect(by(layouts, 'cover')?.label).toBe('Title slide')
    expect(by(layouts, 'two-cols')?.starter).toContain('# Left')
  })

  it.skipIf(!hasDevRuntime)('has the right slots, fields and starters', async () => {
    const reg = createTemplateRegistry(registryOptions(fakeRuntime()))
    const layouts = await reg.layoutsFor(deck('default'))
    expect(by(layouts, 'two-cols')?.slots.map(s => s.name)).toEqual(['default', 'right'])
    expect(by(layouts, 'two-cols')?.starter).toContain('::right::')
    expect(by(layouts, 'two-cols-header')?.slots.map(s => s.name)).toEqual(['default', 'left', 'right', 'bottom'])
    expect(by(layouts, 'image-left')?.fields.find(f => f.key === 'image')?.type).toBe('image')
    expect(by(layouts, 'cover')?.fields.find(f => f.key === 'background')?.type).toBe('image')
    expect(by(layouts, 'iframe')?.fields.find(f => f.key === 'url')?.type).toBe('url')
    expect(by(layouts, 'default')?.fields.find(f => f.key === 'class')?.type).toBe('text')
    expect(by(layouts, 'cover')?.origin).toBe('theme')
    expect(by(layouts, 'center')?.origin).toBe('slidev')
  })

  it('sorts by category, common layouts first', async () => {
    const reg = createTemplateRegistry(registryOptions(fakeRuntime()))
    const visible = (await reg.layoutsFor(deck('default'))).filter(l => !l.hidden)
    const order = ['title', 'content', 'media', 'emphasis', 'special']
    const cats = visible.map(l => order.indexOf(l.category))
    expect(cats).toEqual([...cats].sort((a, b) => a - b))
    expect(visible[0].name).toBe('cover')
    expect(visible.filter(l => l.category === 'content').map(l => l.name).slice(0, 3)).toEqual(['default', 'two-cols', 'two-cols-header'])
  })

  it.skipIf(!hasDevRuntime)('seriph cover warns about the online photo', async () => {
    const reg = createTemplateRegistry(registryOptions(fakeRuntime()))
    const seriph = by(await reg.layoutsFor(deck('seriph')), 'cover')
    expect(seriph?.fields.find(f => f.key === 'background')?.description).toContain('Internet')
  })
})

describe('layoutsFor: scanner, manifest, addons, deck', () => {
  const reg = createTemplateRegistry(registryOptions(fixtureRuntime()))

  it('derives slots and fields for unknown layouts', async () => {
    const cards = by(await reg.layoutsFor(deck('fake')), 'cards')!
    expect(cards.origin).toBe('theme')
    expect(cards.label).toBe('Cards')
    expect(cards.sketch).toBe('generic')
    expect(cards.category).toBe('special')
    expect(cards.slots.map(s => s.name)).toEqual(['default', 'header', 'side'])
    expect(cards.fields.map(f => [f.key, f.type])).toEqual([
      ['heroImage', 'image'], ['homepageUrl', 'url'], ['highlight', 'boolean'], ['columns', 'number'], ['accentColor', 'color'],
    ])
    expect(cards.starter).toContain('::header::')
  })

  it('reads the options API props', async () => {
    const old = by(await reg.layoutsFor(deck('fake')), 'old')!
    expect(old.fields.map(f => [f.key, f.type])).toEqual([['photo', 'image'], ['count', 'number'], ['dark', 'boolean']])
  })

  it('keeps catalog metadata for known names and adds extra props and slots', async () => {
    const cover = by(await reg.layoutsFor(deck('fake')), 'cover')!
    expect(cover.label).toBe('Titelfolie')
    expect(cover.fields.map(f => f.key)).toEqual(['background', 'class', 'author'])
    expect(cover.slots.map(s => s.name)).toEqual(['default', 'author'])
  })

  it('lets a manifest win over catalog and scanner', async () => {
    const layouts = await reg.layoutsFor(deck('manifest'))
    const cover = by(layouts, 'cover')!
    expect(cover.label).toBe('Eigener Titel')
    expect(cover.category).toBe('special')
    expect(cover.sketch).toBe('center')
    expect(cover.fields.map(f => f.key)).toEqual(['logo'])
    expect(cover.starter).toBe('# Mein Titel')
    const cards = by(layouts, 'cards')!
    expect(cards.label).toBe('Karten')
    expect(cards.hidden).toBe(true)
  })

  it('layers addons and the deck folder, later ones override', async () => {
    const layouts = await reg.layoutsFor(deck('fake', ['cards'], join(FIXTURES, 'deck')))
    expect(by(layouts, 'gallery')?.origin).toBe('addon')
    const team = by(layouts, 'team')!
    expect(team.origin).toBe('deck')
    expect(team.slots.map(s => s.name)).toEqual(['default', 'members'])
    expect(team.fields.map(f => f.key)).toEqual(['portrait'])
    expect(by(layouts, 'cover')?.origin).toBe('deck')
    expect(by(layouts, 'cover')?.label).toBe('Titelfolie')
    expect(by(layouts, 'center')?.origin).toBe('slidev')
  })

  it('resolves path-style themes relative to the deck', async () => {
    const layouts = await reg.layoutsFor(deck('./slidev-theme-fake', [], FIXTURES))
    expect(by(layouts, 'cards')?.origin).toBe('theme')
  })

  it('still lists base layouts when the theme is missing', async () => {
    const layouts = await reg.layoutsFor(deck('does-not-exist'))
    expect(by(layouts, 'two-cols')).toBeDefined()
  })
})

describe('list', () => {
  it('has the built-in templates first, then other installed themes', async () => {
    const reg = createTemplateRegistry(registryOptions(fixtureRuntime()))
    const list = await reg.list()
    expect(list.slice(0, 3).map(t => t.id)).toEqual(['klar', 'default', 'seriph'])
    expect(list.slice(0, 3).every(t => t.builtin && t.colors)).toBe(true)
    expect(list[0].label).toBe('Klar')
    expect(list[0].packageName).toBe('slidev-theme-klar')
    expect(list[0].colors?.accent).toBe('#2459d3')
    const manifest = list.find(t => t.id === 'manifest')!
    expect(manifest).toMatchObject({ label: 'Beispielvorlage', description: 'Nur zum Testen.', builtin: false, installed: true })
    expect(manifest.colors?.accent).toBe('#ff0000')
    const fake = list.find(t => t.id === 'fake')!
    expect(fake.description).toBe('A theme without a manifest')
    expect(fake.label).toBe('Fake')
  })

  it('does not list a built-in twice', async () => {
    const list = await createTemplateRegistry(registryOptions(fixtureRuntime())).list()
    expect(list.filter(t => t.packageName === '@slidev/theme-seriph')).toHaveLength(1)
  })
})

describe('starter', () => {
  const opts = (template: string, title = 'Mein Vortrag') => ({ title, template, parentDir: empty })

  it('uses the theme starter, fills in title and headmatter', async () => {
    const reg = createTemplateRegistry(registryOptions(fixtureRuntime()))
    const { slides } = await reg.starter(opts('manifest'))
    expect(slides.startsWith('---\ntheme: manifest\ntitle: Mein Vortrag\nlayout: cover\nclass: dark\n---\n')).toBe(true)
    expect(slides).toContain('# Mein Vortrag')
    expect(slides).not.toContain('wrong')
    expect(slides).toContain('# Zweite Folie')
  })

  it('picks the English starter file in English', async () => {
    const reg = createTemplateRegistry(registryOptions(fixtureRuntime(), 'en'))
    expect((await reg.starter(opts('manifest', 'My talk'))).slides).toContain('Example')
  })

  it('uses a generic starter for themes without one', async () => {
    const reg = createTemplateRegistry(registryOptions(fakeRuntime()))
    const { slides } = await reg.starter(opts('seriph', 'Titel: "Test"'))
    expect(slides.startsWith('---\ntheme: seriph\ntitle: "Titel: \\"Test\\""\nlayout: cover\n---\n')).toBe(true)
    const count = slides.split(/^---$/m).length
    expect(count).toBeGreaterThanOrEqual(9)
    expect(slides).toContain('layout: two-cols')
    expect(slides).toContain('Worum es geht')
  })

  it('English generic starter', async () => {
    const reg = createTemplateRegistry(registryOptions(fakeRuntime(), 'en'))
    expect((await reg.starter(opts('default', 'Talk'))).slides).toContain('What this is about')
  })

  it('ships the klar starter in both languages', async () => {
    const de = await createTemplateRegistry(registryOptions(fakeRuntime(), 'de')).starter(opts('klar', 'Vortrag'))
    const en = await createTemplateRegistry(registryOptions(fakeRuntime(), 'en')).starter(opts('klar', 'Talk'))
    expect(de.slides).toContain('theme: klar')
    expect(de.slides).toContain('# Vortrag')
    expect(de.slides).toContain('So funktioniert diese Vorlage')
    expect(en.slides).toContain('How this template works')
  })

  it('returns AGENTS.md, CLAUDE.md and .gitignore', async () => {
    const reg = createTemplateRegistry(registryOptions(fakeRuntime()))
    const { files } = await reg.starter(opts('klar'))
    expect(Object.keys(files).sort()).toEqual(['.gitignore', 'AGENTS.md', 'CLAUDE.md'])
    expect(files['CLAUDE.md']).toBe('@AGENTS.md\n')
    expect(files['.gitignore']).toBe('node_modules\ndist\n.slidev\n*.podium\n')
    expect(files['AGENTS.md']).toContain('`title-only`')
  })
})

describe('agentsFile', () => {
  it('describes the deck and lists layouts in English', async () => {
    const reg = createTemplateRegistry(registryOptions(fakeRuntime(), 'de'))
    const text = await reg.agentsFile({ ...deck('klar'), title: 'Quantum Talk' })
    expect(text).toContain('# Quantum Talk')
    expect(text).toContain('slides.md')
    expect(text).toContain('<!-- what to say -->')
    expect(text).toContain('public/images/')
    expect(text).toContain('/images/name.png')
    expect(text).toContain('__mcp')
    expect(text).toContain('slidev export')
    expect(text).toContain('| `two-cols` | Two contents side by side')
    expect(text).toContain('`::right::`')
    expect(text).toContain('`image` (image)')
    expect(text).not.toContain('| `404`')
    expect(text).not.toContain('Titelfolie')
    expect(text).not.toContain('—')
    expect(text).not.toContain('–')
  })

  it('includes deck-local layouts', async () => {
    const reg = createTemplateRegistry(registryOptions(fixtureRuntime()))
    const text = await reg.agentsFile({ ...deck('fake', ['cards'], join(FIXTURES, 'deck')), title: 'T' })
    expect(text).toContain('| `team` |')
    expect(text).toContain('`::members::`')
    expect(text).toContain('`gallery`')
  })
})

describe('klar theme package', () => {
  it('matches the spec', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const dir = join(ROOT, 'templates', 'slidev-theme-klar')
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('slidev-theme-klar')
    expect(pkg.version).toBe('0.1.0')
    expect(pkg.keywords).toEqual(expect.arrayContaining(['slidev-theme', 'slidev']))
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.slidev.defaults.fonts.provider).toBe('none')
    const manifest = JSON.parse(readFileSync(join(dir, 'podium.json'), 'utf8'))
    for (const name of Object.keys(manifest.layouts)) {
      expect(existsSync(join(dir, 'layouts', `${name}.vue`))).toBe(true)
      const l = manifest.layouts[name]
      for (const lang of ['de', 'en']) {
        expect(l.label[lang]).toBeTruthy()
        expect(l.description[lang]).toBeTruthy()
        expect(l.starter[lang]).toBeTruthy()
      }
      expect(JSON.stringify(l)).not.toMatch(/—|–/)
    }
    expect(Object.keys(manifest.layouts).sort()).toEqual(
      ['cover', 'default', 'end', 'fact', 'image-left', 'image-right', 'quote', 'section', 'statement', 'title-only', 'two-cols', 'two-cols-header'],
    )
  })

  it('every klar layout file is described', async () => {
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(join(ROOT, 'templates', 'slidev-theme-klar', 'layouts')).map(f => f.replace('.vue', ''))
    const layouts = await createTemplateRegistry(registryOptions(fakeRuntime())).layoutsFor(deck('klar'))
    for (const f of files)
      expect(by(layouts, f)?.origin).toBe('theme')
    expect(by(layouts, 'section')?.label).toBe('Abschnitt')
  })
})
