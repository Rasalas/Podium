/**
 * Packages a deck carries in its own folder: the workspace packages of the nearest
 * package.json with `workspaces`, at or above the deck. A talk repository typically keeps
 * its theme there (`packages/slidev-theme-x`). With `npm install` done, Slidev finds such a
 * package through the workspace link in node_modules; Podium decks have no node_modules,
 * so the launcher hands Slidev the folder instead.
 *
 * launcher/launcher.mjs has a plain JS twin of this file (`workspacePackages`). Keep them in step.
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readJsonSync } from './fsutil'

interface WorkspaceJson {
  name?: unknown
  workspaces?: unknown
}

function patternsOf(pkg: WorkspaceJson | undefined): string[] | undefined {
  const raw = pkg?.workspaces
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? (raw as { packages?: unknown }).packages : undefined)
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : undefined
}

function subfolders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
      .map(entry => entry.name)
  }
  catch {
    return []
  }
}

/** Folders matching a workspace pattern such as "packages/*" or "theme". "*" stands for one folder level. */
function expand(root: string, pattern: string): string[] {
  let dirs = [root]
  for (const segment of pattern.split('/').filter(part => part && part !== '.')) {
    if (segment === '..')
      return []
    if (!segment.includes('*')) {
      dirs = dirs.map(dir => join(dir, segment))
      continue
    }
    const matcher = new RegExp(`^${segment.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    dirs = dirs.flatMap(dir => subfolders(dir).filter(name => matcher.test(name)).map(name => join(dir, name)))
  }
  return dirs
}

/** Package name → folder, for every workspace package the deck can see. Empty when there is none. */
export function workspacePackages(deckDir: string): Map<string, string> {
  const found = new Map<string, string>()
  let dir = resolve(deckDir)
  while (true) {
    const patterns = patternsOf(readJsonSync<WorkspaceJson>(join(dir, 'package.json')))
    if (patterns) {
      for (const pattern of patterns) {
        if (pattern.startsWith('!'))
          continue
        for (const folder of expand(dir, pattern)) {
          const name = readJsonSync<WorkspaceJson>(join(folder, 'package.json'))?.name
          if (typeof name === 'string' && name && !found.has(name) && existsSync(folder))
            found.set(name, folder)
        }
      }
      return found
    }
    const parent = dirname(dir)
    if (parent === dir)
      return found
    dir = parent
  }
}
