import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

export function readJsonSync<T = any>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  }
  catch {
    return undefined
  }
}

/** Write via a temp file and rename, so a hardlinked or open target is never modified in place. */
export async function writeFileAtomic(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, path)
}

const IGNORED = new Set(['node_modules', '.git', '.DS_Store', 'Thumbs.db'])

async function listFiles(root: string, dir = root, out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  }
  catch {
    return out
  }
  for (const entry of entries) {
    if (IGNORED.has(entry.name))
      continue
    const full = join(dir, entry.name)
    if (entry.isDirectory())
      await listFiles(root, full, out)
    else if (entry.isFile())
      out.push(relative(root, full).split('\\').join('/'))
  }
  return out
}

/** Hash of all file paths and contents below `root`, ignoring node_modules and VCS folders. */
export async function hashDir(root: string): Promise<string | undefined> {
  if (!existsSync(root))
    return undefined
  const hash = createHash('sha256')
  const files = (await listFiles(root)).sort()
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(await readFile(join(root, file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Replace `target` with a copy of `source`. The copy is built next to the target and
 * swapped in, so a reader never sees a half-written folder.
 */
export async function replaceDir(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const stamp = `${process.pid}-${Date.now()}`
  const staging = `${target}.podium-new-${stamp}`
  const old = `${target}.podium-old-${stamp}`
  await cp(source, staging, {
    recursive: true,
    filter: src => !IGNORED.has(src.split(/[\\/]/).pop() ?? ''),
  })
  if (existsSync(target))
    await rename(target, old)
  await rename(staging, target)
  await rm(old, { recursive: true, force: true })
}
