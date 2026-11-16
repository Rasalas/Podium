/**
 * Built-in templates (resources/templates/<folder>) are copied into the runtime's
 * node_modules so Slidev finds them like any installed theme.
 *
 * npm prunes folders in node_modules that package.json does not mention, so every
 * template is also listed as a `file:builtin/<name>` dependency, with a stable copy in
 * <runtimeDir>/builtin and `install-links=true` in the runtime's .npmrc (npm then keeps a
 * real folder rather than a symlink). Without this, the next `npm install` of an addon
 * would delete the templates.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { hashDir, readJsonSync, replaceDir, writeFileAtomic } from './fsutil'

export interface BuiltinTemplate {
  name: string
  version: string
  /** Source folder in the app resources. */
  source: string
}

/**
 * Templates that ship with the app, plus those in `userDir` (templates the user added, see
 * src/main/templates/import.ts). A shipped template wins over an added one of the same name.
 */
export async function findTemplates(resourcesDir: string, userDir?: string): Promise<BuiltinTemplate[]> {
  const found: BuiltinTemplate[] = []
  for (const root of [join(resourcesDir, 'templates'), userDir]) {
    if (!root)
      continue
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    }
    catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue
      const source = join(root, entry.name)
      const pkg = readJsonSync<{ name?: string, version?: string }>(join(source, 'package.json'))
      if (pkg?.name && !found.some(t => t.name === pkg.name))
        found.push({ name: pkg.name, version: pkg.version ?? '0.0.0', source })
    }
  }
  return found
}

export function builtinDir(runtimeDir: string, name: string): string {
  return join(runtimeDir, 'builtin', ...name.split('/'))
}

/** Copy templates that are missing or differ. Returns the names that were (re)copied. */
export async function syncTemplates(resourcesDir: string, runtimeDir: string, userDir?: string): Promise<string[]> {
  const templates = await findTemplates(resourcesDir, userDir)
  const changed: string[] = []
  for (const template of templates) {
    const installed = join(runtimeDir, 'node_modules', ...template.name.split('/'))
    const stable = builtinDir(runtimeDir, template.name)
    const sourceHash = await hashDir(template.source)
    const installedVersion = readJsonSync<{ version?: string }>(join(installed, 'package.json'))?.version
    if (installedVersion !== template.version || await hashDir(installed) !== sourceHash) {
      await replaceDir(template.source, installed)
      changed.push(template.name)
    }
    if (await hashDir(stable) !== sourceHash)
      await replaceDir(template.source, stable)
  }
  await registerTemplates(runtimeDir, templates.map(t => t.name))
  return changed
}

async function registerTemplates(runtimeDir: string, names: string[]): Promise<void> {
  if (!names.length)
    return
  const pkgPath = join(runtimeDir, 'package.json')
  const pkg = readJsonSync<{ dependencies?: Record<string, string> }>(pkgPath) ?? {}
  const deps = { ...pkg.dependencies }
  let dirty = false
  for (const name of names) {
    const spec = `file:builtin/${name}`
    if (deps[name] !== spec) {
      deps[name] = spec
      dirty = true
    }
  }
  if (dirty)
    await writeFileAtomic(pkgPath, `${JSON.stringify({ ...pkg, dependencies: sortKeys(deps) }, null, 2)}\n`)

  const npmrcPath = join(runtimeDir, '.npmrc')
  const npmrc = existsSync(npmrcPath) ? await readFile(npmrcPath, 'utf8') : ''
  if (!/^\s*install-links\s*=\s*true\s*$/m.test(npmrc))
    await writeFileAtomic(npmrcPath, `${npmrc.replace(/^\s*install-links\s*=.*$/m, '').trimEnd()}\ninstall-links=true\n`.trimStart())
}

/** Take a template out of the runtime again: its copies and its entry in package.json. */
export async function unregisterTemplate(runtimeDir: string, name: string): Promise<void> {
  const pkgPath = join(runtimeDir, 'package.json')
  const pkg = readJsonSync<{ dependencies?: Record<string, string> }>(pkgPath) ?? {}
  if (pkg.dependencies?.[name] === `file:builtin/${name}`) {
    const { [name]: _removed, ...rest } = pkg.dependencies
    await writeFileAtomic(pkgPath, `${JSON.stringify({ ...pkg, dependencies: rest }, null, 2)}\n`)
  }
  await rm(builtinDir(runtimeDir, name), { recursive: true, force: true })
  await rm(join(runtimeDir, 'node_modules', ...name.split('/')), { recursive: true, force: true })
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}
