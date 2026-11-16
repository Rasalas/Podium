/**
 * Templates people add themselves: a Slidev theme fetched from a git address, a zip link or a
 * folder, copied into the user's own template store (<userData>/templates) so it stays
 * available for every new presentation. The runtime installs it from there like a built-in
 * template.
 *
 * A template is program code (Vue components, setup files). Nothing here runs it; the app
 * asks the user before adding one.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { unzipSync } from 'fflate'

export interface TemplateSource {
  kind: 'git' | 'zip' | 'folder'
  /** Clone address, zip address or folder path. */
  url: string
  /** Branch or tag, for git. */
  ref?: string
  /** Folder of the theme inside the repository or archive. */
  subdir?: string
}

export interface UserTemplate {
  /** npm package name of the theme, e.g. "slidev-theme-gitnrw". */
  name: string
  version: string
  /** Folder inside the template store. */
  folder: string
  source: TemplateSource
  /** Epoch ms of the last fetch. */
  fetchedAt: number
}

export class TemplateImportError extends Error {}

const fail = (message: string): never => {
  throw new TemplateImportError(message)
}

const cleanSubdir = (path: string | undefined) => path?.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || undefined

/**
 * What the user typed or pasted: a folder path, a link to a zip file, a clone address, or the
 * address of a repository page in the browser, including a folder inside it
 * (https://github.com/name/repo/tree/main/packages/theme, GitLab's /-/tree/ likewise).
 */
export function parseTemplateSource(input: string, subdir?: string): TemplateSource {
  const text = input.trim()
  if (!text)
    fail('Bitte gib eine Adresse oder einen Ordner an.')
  const extra = cleanSubdir(subdir)
  if (text.startsWith('~') || isAbsolute(text) || /^[a-z]:[\\/]/i.test(text) || text.startsWith('.'))
    return { kind: 'folder', url: text, subdir: extra }
  // git@host:group/repo.git and ssh://
  if (/^(?:git@|ssh:\/\/)/.test(text))
    return { kind: 'git', url: text, subdir: extra }
  let url: URL
  try {
    url = new URL(text)
  }
  catch {
    return fail('Das ist weder eine Adresse noch ein Ordner. Beispiel: https://github.com/name/vorlage')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'file:')
    fail('Die Adresse muss mit https:// beginnen.')
  if (/\.zip$/i.test(url.pathname))
    return { kind: 'zip', url: url.href, subdir: extra }
  // A folder page of a repository: .../tree/<ref>/<path> (GitHub) or .../-/tree/<ref>/<path> (GitLab).
  const tree = /^(\/.+?)(?:\/-)?\/tree\/([^/]+)(?:\/(.+?))?\/?$/.exec(url.pathname)
  if (tree) {
    return {
      kind: 'git',
      url: `${url.origin}${tree[1].replace(/\.git$/, '')}.git`,
      ref: decodeURIComponent(tree[2]),
      subdir: extra ?? cleanSubdir(tree[3] && decodeURIComponent(tree[3])),
    }
  }
  const path = url.pathname.replace(/\/+$/, '')
  return { kind: 'git', url: `${url.origin}${path.replace(/\.git$/, '')}.git`, subdir: extra }
}

function run(file: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((done, reject) => {
    // Never wait for a password prompt: a repository that needs one fails with a clear message instead.
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GCM_INTERACTIVE: 'never' }
    execFile(file, args, { cwd, env, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error)
        reject(Object.assign(error, { stderr: String(stderr) }))
      else
        done(String(stdout))
    })
  })
}

async function cloneRepository(source: TemplateSource, target: string): Promise<void> {
  const args = ['clone', '--depth', '1', '--quiet', ...(source.ref ? ['--branch', source.ref] : []), '--', source.url, target]
  try {
    await run('git', args)
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const stderr = String((error as { stderr?: string }).stderr ?? '')
    if (code === 'ENOENT')
      fail('Für diese Adresse braucht Podium das Programm Git, das hier nicht installiert ist. Nimm stattdessen den Link auf eine Zip-Datei der Vorlage.')
    if (/authentication|could not read username|permission denied|access denied|terminal prompts disabled/i.test(stderr))
      fail('Auf dieses Repository hast du von diesem Rechner aus keinen Zugriff. Ist es privat, muss Git dort angemeldet sein.')
    if (/not found|does not exist|remote branch/i.test(stderr))
      fail('Unter dieser Adresse wurde kein Repository gefunden. Bitte prüfe die Adresse.')
    fail(`Die Vorlage konnte nicht geholt werden: ${stderr.trim().split('\n').pop() || String(error)}`)
  }
}

/** Largest archive Podium unpacks, so a wrong link cannot fill the disk. */
const MAX_ZIP_BYTES = 200 * 1024 * 1024

async function downloadZip(url: string, target: string): Promise<void> {
  let data: Uint8Array
  if (url.startsWith('file:')) {
    data = readFileSync(new URL(url))
  }
  else {
    const response = await fetch(url, { redirect: 'follow' }).catch(() => fail('Die Adresse ist nicht erreichbar. Besteht eine Internetverbindung?'))
    if (!response.ok)
      fail(`Unter dieser Adresse gibt es keine Datei (Antwort ${response.status}).`)
    data = new Uint8Array(await response.arrayBuffer())
  }
  if (data.length > MAX_ZIP_BYTES)
    fail('Die Datei ist zu groß für eine Vorlage.')
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  }
  catch {
    return fail('Die Datei ist kein Zip-Archiv.')
  }
  for (const [name, content] of Object.entries(files)) {
    const path = normalize(join(target, name))
    // Entries that would land outside the target folder are dropped.
    if (!path.startsWith(target + sep) || name.endsWith('/'))
      continue
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
}

interface ThemeFolder {
  dir: string
  name: string
  version: string
}

function themeAt(dir: string): ThemeFolder | undefined {
  let pkg: { name?: unknown, version?: unknown, keywords?: unknown }
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  }
  catch {
    return undefined
  }
  const name = typeof pkg.name === 'string' ? pkg.name : ''
  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : []
  const isTheme = /^(?:@[\w.-]+\/)?slidev-theme-[\w.-]+$/.test(name) || /^@slidev\/theme-[\w.-]+$/.test(name) || keywords.includes('slidev-theme')
  if (!isTheme || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name))
    return undefined
  return { dir, name, version: typeof pkg.version === 'string' ? pkg.version : '0.0.0' }
}

/** Slidev themes in a fetched tree: the root itself, or folders up to three levels down. */
export function findThemeFolders(root: string): ThemeFolder[] {
  const own = themeAt(root)
  if (own)
    return [own]
  const found: ThemeFolder[] = []
  const visit = (dir: string, depth: number) => {
    let names: string[]
    try {
      names = readdirSync(dir)
    }
    catch {
      return
    }
    for (const name of names) {
      if (name === 'node_modules' || name.startsWith('.'))
        continue
      const child = join(dir, name)
      if (!statSync(child, { throwIfNoEntry: false })?.isDirectory())
        continue
      const theme = themeAt(child)
      if (theme)
        found.push(theme)
      else if (depth < 3)
        visit(child, depth + 1)
    }
  }
  visit(root, 1)
  return found
}

export interface TemplateStore {
  list: () => UserTemplate[]
  /** Fetch the source and put the theme into the store. Replaces an entry of the same name. */
  add: (source: TemplateSource) => Promise<UserTemplate>
  /** Fetch an entry again from where it came from. */
  refresh: (name: string) => Promise<UserTemplate>
  remove: (name: string) => void
}

/** Names the store never takes: they belong to templates that ship with the app or with Slidev. */
export type ReservedName = (name: string) => boolean

export function createTemplateStore(storeDir: string, reserved: ReservedName = () => false): TemplateStore {
  const indexFile = join(storeDir, 'index.json')

  function list(): UserTemplate[] {
    try {
      const data = JSON.parse(readFileSync(indexFile, 'utf8'))
      return Array.isArray(data) ? data.filter(t => t && typeof t.name === 'string' && existsSync(join(storeDir, t.folder, 'package.json'))) : []
    }
    catch {
      return []
    }
  }

  function save(templates: UserTemplate[]): void {
    mkdirSync(storeDir, { recursive: true })
    writeFileSync(indexFile, `${JSON.stringify(templates, null, 2)}\n`)
  }

  async function fetchTree(source: TemplateSource, work: string): Promise<string> {
    const tree = join(work, 'tree')
    if (source.kind === 'folder') {
      const folder = resolve(source.url.replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~'))
      if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory())
        fail('Diesen Ordner gibt es nicht.')
      return folder
    }
    mkdirSync(tree, { recursive: true })
    if (source.kind === 'zip') {
      await downloadZip(source.url, tree)
      // Archives of a repository wrap everything in one top folder.
      const entries = readdirSync(tree)
      return entries.length === 1 && statSync(join(tree, entries[0])).isDirectory() ? join(tree, entries[0]) : tree
    }
    rmSync(tree, { recursive: true, force: true })
    await cloneRepository(source, tree)
    return tree
  }

  async function add(source: TemplateSource): Promise<UserTemplate> {
    const work = mkdtempSync(join(tmpdir(), 'podium-template-'))
    try {
      const tree = await fetchTree(source, work)
      let root = tree
      if (source.subdir) {
        root = resolve(tree, source.subdir)
        if (relative(tree, root).startsWith('..') || !statSync(root, { throwIfNoEntry: false })?.isDirectory())
          fail(`Den Unterordner "${source.subdir}" gibt es dort nicht.`)
      }
      const themes = findThemeFolders(root)
      if (!themes.length)
        fail('Dort liegt keine Slidev-Vorlage. Eine Vorlage ist ein Ordner mit einer package.json, deren Name mit "slidev-theme-" beginnt.')
      if (themes.length > 1) {
        const places = themes.map(t => relative(tree, t.dir).split(sep).join('/')).join(', ')
        fail(`Dort liegen mehrere Vorlagen: ${places}. Gib bitte den Unterordner der gewünschten an.`)
      }
      const theme = themes[0]
      if (reserved(theme.name))
        fail(`Eine Vorlage mit dem Namen "${theme.name}" ist in Podium schon enthalten.`)
      const folder = theme.name.replace(/[^a-z0-9._-]+/gi, '_')
      const target = join(storeDir, folder)
      rmSync(target, { recursive: true, force: true })
      mkdirSync(storeDir, { recursive: true })
      await cp(theme.dir, target, {
        recursive: true,
        filter: path => !/(?:^|[\\/])(?:node_modules|\.git)(?:$|[\\/])/.test(relative(theme.dir, path)),
      })
      // Remember where inside the source the theme was found, so refreshing needs no guessing.
      const subdir = cleanSubdir(relative(tree, theme.dir).split(sep).join('/'))
      const entry: UserTemplate = { name: theme.name, version: theme.version, folder, source: { ...source, subdir }, fetchedAt: Date.now() }
      save([...list().filter(t => t.name !== entry.name), entry].sort((a, b) => a.name.localeCompare(b.name)))
      return entry
    }
    finally {
      rmSync(work, { recursive: true, force: true })
    }
  }

  function refresh(name: string): Promise<UserTemplate> {
    const entry = list().find(t => t.name === name)
    return entry ? add(entry.source) : fail('Diese Vorlage ist nicht mehr vorhanden.')
  }

  function remove(name: string): void {
    const entries = list()
    const entry = entries.find(t => t.name === name)
    if (!entry)
      return
    rmSync(join(storeDir, entry.folder), { recursive: true, force: true })
    save(entries.filter(t => t.name !== name))
  }

  return { list, add, refresh, remove }
}
