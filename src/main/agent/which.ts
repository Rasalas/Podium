import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    if (process.platform !== 'win32') accessSync(file, constants.X_OK)
    return true
  }
  catch { return false }
}

/** Small cross-platform `which`. Returns the full path or undefined. */
export function which(command: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  if (!command) return undefined
  const win = platform === 'win32'
  const exts = win ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  const hasExt = win && exts.some(e => command.toLowerCase().endsWith(e.toLowerCase()))
  const candidates = (base: string) => (hasExt || !win ? [base] : [base, ...exts.map(e => base + e)])
  const dirs = command.includes('/') || (win && command.includes('\\')) || isAbsolute(command)
    ? ['']
    : (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  for (const dir of dirs)
    for (const c of candidates(dir ? join(dir, command) : command))
      if (isExecutable(c)) return c
  return undefined
}
