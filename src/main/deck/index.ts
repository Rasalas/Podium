/**
 * deck/ — the document model: load, edit, save, watch, undo.
 *
 * Headmatter rule (see keys.ts): in the entry file's first frontmatter block, keys Slidev
 * knows as deck configuration (`getDefaultConfig()` keys plus `defaults` and `config`)
 * are deck-level and go to DeckSnapshot.headmatter; every other key belongs to slide 1.
 */
import type { NewDeckOptions } from '../../shared/types'
import type { DeckOptions, DeckSession, DeckStarter } from '../contracts'
import { existsSync } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { atomicWrite, folderNameFor, insideDir, shortHash, unpackTo } from './files'
import { Session } from './session'

async function findEntry(dir: string): Promise<string> {
  const slides = join(dir, 'slides.md')
  if (existsSync(slides))
    return slides
  const candidates = (await readdir(dir)).filter(name => name.endsWith('.md') && !/^(?:readme|agents|claude|changelog)\.md$/i.test(name))
  if (candidates.length === 1)
    return join(dir, candidates[0])
  throw new Error(`Im Ordner "${dir}" wurde keine Präsentation (slides.md) gefunden.`)
}

export async function openDeck(path: string, options: DeckOptions): Promise<DeckSession> {
  const opened = resolve(path)
  const info = await stat(opened).catch(() => undefined)
  if (!info)
    throw new Error(`"${opened}" wurde nicht gefunden.`)
  let dir: string
  let entry: string
  let bundlePath: string | undefined
  if (info.isDirectory()) {
    dir = opened
    entry = await findEntry(dir)
  }
  else if (extname(opened).toLowerCase() === '.podium') {
    bundlePath = opened
    dir = await unpackTo(opened, join(resolve(options.workDir), shortHash(opened)))
    entry = await findEntry(dir)
  }
  else if (/\.(?:md|markdown)$/i.test(opened)) {
    entry = opened
    dir = dirname(opened)
  }
  else {
    throw new Error(`"${opened}" ist weder ein Präsentationsordner noch eine Markdown- oder .podium-Datei.`)
  }
  const session = new Session({ deckId: shortHash(opened), dir, entry, bundlePath, options })
  await session.init()
  return session.api()
}

export async function createDeck(options: NewDeckOptions, starter: DeckStarter, deckOptions: DeckOptions): Promise<DeckSession> {
  const parent = resolve(options.parentDir)
  await mkdir(parent, { recursive: true })
  const base = options.folderName?.trim() || folderNameFor(options.title)
  if (/[\\/]/.test(base) || base === '.' || base === '..')
    throw new Error(`Ungültiger Ordnername: ${base}`)
  let name = base
  for (let i = 2; existsSync(join(parent, name)); i++)
    name = `${base}-${i}`
  const dir = join(parent, name)
  await mkdir(dir, { recursive: true })
  await atomicWrite(join(dir, 'slides.md'), starter.slides)
  for (const [relativePath, content] of Object.entries(starter.files))
    await atomicWrite(insideDir(dir, relativePath), content)
  return openDeck(dir, deckOptions)
}
