import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { createTemplateStore, findThemeFolders, parseTemplateSource } from '../../../src/main/templates/import'

const root = mkdtempSync(join(tmpdir(), 'podium-import-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function theme(dir: string, name: string, version = '1.0.0'): string {
  mkdirSync(join(dir, 'layouts'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, keywords: ['slidev-theme'] }))
  writeFileSync(join(dir, 'layouts', 'cover.vue'), `<template><div class="slidev-layout">${version}<slot /></div></template>\n`)
  return dir
}

describe('what the user can type as a template source', () => {
  it('reads repository addresses, also the address of a folder page', () => {
    expect(parseTemplateSource('https://github.com/name/vorlage')).toEqual({ kind: 'git', url: 'https://github.com/name/vorlage.git', subdir: undefined })
    expect(parseTemplateSource(' https://github.com/name/vorlage.git/ ')).toMatchObject({ kind: 'git', url: 'https://github.com/name/vorlage.git' })
    expect(parseTemplateSource('https://github.com/name/talk/tree/main/packages/slidev-theme-haus')).toEqual({
      kind: 'git',
      url: 'https://github.com/name/talk.git',
      ref: 'main',
      subdir: 'packages/slidev-theme-haus',
    })
    expect(parseTemplateSource('https://gitlab.example.org/gruppe/unter/talk/-/tree/v2/packages/thema')).toEqual({
      kind: 'git',
      url: 'https://gitlab.example.org/gruppe/unter/talk.git',
      ref: 'v2',
      subdir: 'packages/thema',
    })
    expect(parseTemplateSource('git@gitlab.example.org:gruppe/talk.git', '/packages/thema/')).toEqual({ kind: 'git', url: 'git@gitlab.example.org:gruppe/talk.git', subdir: 'packages/thema' })
  })

  it('reads zip links and folders', () => {
    expect(parseTemplateSource('https://example.org/vorlage.zip')).toMatchObject({ kind: 'zip', url: 'https://example.org/vorlage.zip' })
    expect(parseTemplateSource('/home/anna/vorlage')).toMatchObject({ kind: 'folder', url: '/home/anna/vorlage' })
    expect(parseTemplateSource('~/vorlage')).toMatchObject({ kind: 'folder' })
    expect(parseTemplateSource('C:\\Vorlagen\\haus')).toMatchObject({ kind: 'folder' })
  })

  it('says what is wrong with anything else', () => {
    expect(() => parseTemplateSource('')).toThrow(/Adresse oder einen Ordner/)
    expect(() => parseTemplateSource('irgendwas')).toThrow(/weder eine Adresse/)
    expect(() => parseTemplateSource('ftp://example.org/x')).toThrow(/https/)
  })
})

describe('finding the theme in what was fetched', () => {
  it('takes the folder itself or looks a few levels down, skipping node_modules', () => {
    const own = theme(join(root, 'find', 'own'), 'slidev-theme-own')
    expect(findThemeFolders(own).map(t => t.name)).toEqual(['slidev-theme-own'])

    const repo = join(root, 'find', 'repo')
    theme(join(repo, 'packages', 'slidev-theme-haus'), 'slidev-theme-haus')
    theme(join(repo, 'node_modules', 'slidev-theme-trap'), 'slidev-theme-trap')
    mkdirSync(join(repo, 'packages', 'not-a-theme'), { recursive: true })
    writeFileSync(join(repo, 'packages', 'not-a-theme', 'package.json'), JSON.stringify({ name: 'something-else' }))
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'talk', workspaces: ['packages/*'] }))
    expect(findThemeFolders(repo).map(t => t.name)).toEqual(['slidev-theme-haus'])
  })
})

describe('the user\'s template store', () => {
  const storeDir = join(root, 'store')
  const store = createTemplateStore(storeDir, name => name === 'slidev-theme-klar')

  it('adds a theme from a folder and keeps it', async () => {
    const source = theme(join(root, 'src', 'slidev-theme-ordner'), 'slidev-theme-ordner', '1.2.0')
    mkdirSync(join(source, 'node_modules', 'left-behind'), { recursive: true })
    const entry = await store.add(parseTemplateSource(source))
    expect(entry).toMatchObject({ name: 'slidev-theme-ordner', version: '1.2.0', source: { kind: 'folder' } })
    expect(existsSync(join(storeDir, entry.folder, 'layouts', 'cover.vue'))).toBe(true)
    expect(existsSync(join(storeDir, entry.folder, 'node_modules'))).toBe(false)
    // A second store on the same folder sees it: it survives a restart.
    expect(createTemplateStore(storeDir).list().map(t => t.name)).toEqual(['slidev-theme-ordner'])
    // The source folder is the user's and stays untouched.
    expect(existsSync(join(source, 'package.json'))).toBe(true)
  })

  it('fetches a theme from a subfolder of a git repository and fetches it again on refresh', async () => {
    const repo = join(root, 'git', 'talk')
    theme(join(repo, 'packages', 'slidev-theme-git'), 'slidev-theme-git', '1.0.0')
    writeFileSync(join(repo, 'slides.md'), '# Talk\n')
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.org', ...args], { cwd: repo })
    git('init', '-q', '-b', 'main')
    git('add', '-A')
    git('commit', '-q', '-m', 'first')

    const entry = await store.add({ kind: 'git', url: repo })
    expect(entry).toMatchObject({ name: 'slidev-theme-git', version: '1.0.0', source: { kind: 'git', subdir: 'packages/slidev-theme-git' } })
    expect(existsSync(join(storeDir, entry.folder, '.git'))).toBe(false)

    theme(join(repo, 'packages', 'slidev-theme-git'), 'slidev-theme-git', '1.1.0')
    git('commit', '-q', '-am', 'second')
    const again = await store.refresh('slidev-theme-git')
    expect(again.version).toBe('1.1.0')
    expect(readFileSync(join(storeDir, again.folder, 'layouts', 'cover.vue'), 'utf8')).toContain('1.1.0')
    expect(store.list().map(t => t.name)).toEqual(['slidev-theme-git', 'slidev-theme-ordner'])
  })

  it('unpacks a zip the way repository downloads are packed, and drops entries that point outside', async () => {
    const zip = zipSync({
      'vorlage-main/package.json': strToU8(JSON.stringify({ name: 'slidev-theme-zip', version: '0.3.0' })),
      'vorlage-main/layouts/cover.vue': strToU8('<template><div /></template>'),
      '../outside.txt': strToU8('nope'),
    })
    const file = join(root, 'vorlage.zip')
    writeFileSync(file, zip)
    const entry = await store.add(parseTemplateSource(pathToFileURL(file).href))
    expect(entry).toMatchObject({ name: 'slidev-theme-zip', version: '0.3.0', source: { kind: 'zip' } })
    expect(existsSync(join(tmpdir(), 'outside.txt'))).toBe(false)
  })

  it('removes a template', () => {
    const folder = store.list().find(t => t.name === 'slidev-theme-zip')!.folder
    store.remove('slidev-theme-zip')
    expect(store.list().map(t => t.name)).toEqual(['slidev-theme-git', 'slidev-theme-ordner'])
    expect(existsSync(join(storeDir, folder))).toBe(false)
  })

  it('explains what is wrong with a source', async () => {
    const empty = join(root, 'empty')
    mkdirSync(empty, { recursive: true })
    await expect(store.add(parseTemplateSource(empty))).rejects.toThrow(/keine Slidev-Vorlage/)
    await expect(store.add(parseTemplateSource(join(root, 'gibt-es-nicht')))).rejects.toThrow(/Ordner gibt es nicht/)

    const two = join(root, 'two')
    theme(join(two, 'a'), 'slidev-theme-a')
    theme(join(two, 'b'), 'slidev-theme-b')
    await expect(store.add(parseTemplateSource(two))).rejects.toThrow(/mehrere Vorlagen: a, b/)
    // With the subfolder it is clear which one is meant.
    await expect(store.add(parseTemplateSource(two, 'b'))).resolves.toMatchObject({ name: 'slidev-theme-b' })
    await expect(store.add(parseTemplateSource(two, '../src'))).rejects.toThrow(/Unterordner/)

    await expect(store.add(parseTemplateSource(theme(join(root, 'klar'), 'slidev-theme-klar')))).rejects.toThrow(/schon enthalten/)
    await expect(store.add({ kind: 'git', url: join(root, 'kein-repo') })).rejects.toThrow(/kein Repository|nicht geholt/)
  })
})
