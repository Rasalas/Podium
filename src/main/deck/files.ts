/** File system helpers of the deck module: atomic writes, names, bundles. */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { unzipSync, zipSync } from 'fflate'

export function shortHash(text: string, length = 12): string {
  return createHash('sha1').update(text).digest('hex').slice(0, length)
}

let tmpCounter = 0

/** Write via a temp file in the same folder and rename, so readers never see half a file. */
export async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${Date.now().toString(36)}-${process.pid}-${++tmpCounter}.podium-tmp`)
  try {
    await writeFile(tmp, data)
    await rename(tmp, path)
  }
  catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

const TRANSLIT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', ẞ: 'SS' }

export function transliterate(text: string): string {
  return text
    .replace(/[äöüÄÖÜßẞ]/g, c => TRANSLIT[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
}

/** "Foto vom Grill (1).JPG" → "foto-vom-grill-1.jpg" */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const ext = extname(base)
  const stem = base.slice(0, base.length - ext.length)
  const clean = (s: string) => transliterate(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const cleanExt = clean(ext.slice(1))
  return `${clean(stem) || 'datei'}${cleanExt ? `.${cleanExt}` : ''}`
}

/** "foto.png", then "foto-2.png", "foto-3.png" ... */
export function uniqueName(dir: string, name: string): string {
  if (!existsSync(join(dir, name)))
    return name
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!existsSync(join(dir, candidate)))
      return candidate
  }
}

/** Readable folder name for a new deck: "Präsentation über Öl" → "praesentation-ueber-oel" */
export function folderNameFor(title: string): string {
  const name = transliterate(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
  return name || 'praesentation'
}

/** Resolve a deck-relative path; refuse anything that leaves the deck folder. */
export function insideDir(dir: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath))
    throw new Error(`Ungültiger Dateipfad: ${relativePath}`)
  const target = resolve(dir, relativePath)
  const rel = relative(dir, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error(`Der Pfad liegt außerhalb des Präsentationsordners: ${relativePath}`)
  return target
}

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', '.slidev'])

export function isExcludedFromBundle(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/)
  if (parts.some(p => EXCLUDED_DIRS.has(p)))
    return true
  const name = parts.at(-1)!
  return name.endsWith('.podium') || name.endsWith('.podium-tmp')
}

async function collect(dir: string, base: string, out: Record<string, Uint8Array>): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = relative(base, full).split(sep).join('/')
    if (isExcludedFromBundle(rel))
      continue
    if (entry.isDirectory())
      await collect(full, base, out)
    else if (entry.isFile())
      out[rel] = new Uint8Array(await readFile(full))
  }
}

export async function packDir(dir: string, target: string): Promise<void> {
  const files: Record<string, Uint8Array> = {}
  await collect(dir, dir, files)
  const zipped = zipSync(files, { level: 6 })
  await atomicWrite(target, zipped)
}

/**
 * Unpack a bundle into `dir` (emptied first). Returns the folder that holds the deck:
 * `dir` itself, or the single top-level folder if the zip was made from a parent folder.
 */
export async function unpackTo(bundle: string, dir: string): Promise<string> {
  const entries = unzipSync(new Uint8Array(await readFile(bundle)))
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/'))
      continue
    const target = insideDir(dir, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }
  if (existsSync(join(dir, 'slides.md')))
    return dir
  const top = (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory())
  if (top.length === 1 && existsSync(join(dir, top[0].name, 'slides.md')))
    return join(dir, top[0].name)
  return dir
}
