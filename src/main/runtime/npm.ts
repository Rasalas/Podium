/**
 * Running the npm that ships with the app (dependency "npm") under the app's own Node.
 */
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { unzipSync } from 'fflate'

type SpawnNode = (args: string[], options?: SpawnOptions) => ChildProcess

/** Inside an asar archive, executable files must come from the unpacked twin folder. */
function unpacked(path: string): string {
  return path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}

let cached: string | undefined

/** Absolute path of npm's bin/npm-cli.js. */
export function npmCliPath(extractBase?: string): string {
  if (cached)
    return cached
  const override = process.env.PODIUM_NPM_CLI
  if (override && existsSync(override))
    return (cached = override)
  // The packaged app ships npm as resources/npm.zip, because the installer build drops
  // nested node_modules folders and npm needs its bundled dependencies. It gets unpacked
  // once into the runtime folder.
  const resources = (process as { resourcesPath?: string }).resourcesPath
  const archive = resources ? join(resources, 'npm.zip') : undefined
  if (archive && existsSync(archive)) {
    const target = join(extractBase ?? tmpdir(), '.npm-cli')
    const cli = join(target, 'bin', 'npm-cli.js')
    const stamp = join(target, '.stamp')
    const want = String(statSync(archive).size)
    if (!existsSync(cli) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== want) {
      rmSync(target, { recursive: true, force: true })
      for (const [name, data] of Object.entries(unzipSync(readFileSync(archive)))) {
        if (name.endsWith('/'))
          continue
        const file = join(target, name)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, data)
      }
      writeFileSync(stamp, want)
    }
    return (cached = cli)
  }
  const bases = [import.meta.url, join(process.cwd(), 'package.json')]
  for (const base of bases) {
    try {
      const pkg = createRequire(base).resolve('npm/package.json')
      for (const candidate of [unpacked(pkg), pkg]) {
        const cli = join(dirname(candidate), 'bin', 'npm-cli.js')
        if (existsSync(cli))
          return (cached = cli)
      }
    }
    catch {}
  }
  throw new Error('npm wurde in der App nicht gefunden. Bitte Podium neu installieren. (npm not found)')
}

/** Inherited npm_* variables (e.g. when the app runs from an npm script) would redirect npm. */
const STRIP_ENV = /^npm_(?:lifecycle_|package_|command$|execpath$|node_execpath$|config_(?:prefix|global|location|local_prefix|save|workspaces?|include_workspace_root|dry_run|ignore_scripts|user_agent)$)/i

export function npmEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIP_ENV.test(key))
      env[key] = value
  }
  env.npm_config_update_notifier = 'false'
  env.npm_config_fund = 'false'
  env.npm_config_audit = 'false'
  env.npm_config_progress = 'false'
  env.npm_config_color = 'false'
  return env
}

export class NpmError extends Error {
  constructor(message: string, readonly output: string, readonly code: number | null) {
    super(message)
    this.name = 'NpmError'
  }
}

/** Run `npm <args>` in `cwd`. Resolves with the combined output, rejects with an NpmError. */
export function runNpm(spawnNode: SpawnNode, cwd: string, args: string[], onLine?: (line: string) => void): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let child: ChildProcess
    try {
      child = spawnNode([npmCliPath(cwd), ...args], { cwd, env: npmEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    }
    catch (error) {
      reject(error)
      return
    }
    let output = ''
    let partial = ''
    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      if (output.length > 200_000)
        output = output.slice(-100_000)
      if (onLine) {
        const lines = (partial + text).split(/\r?\n/)
        partial = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim())
            onLine(line)
        }
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', error => reject(new NpmError(`npm konnte nicht gestartet werden: ${error.message}`, output, null)))
    child.on('close', (code) => {
      if (code === 0)
        resolvePromise(output)
      else
        reject(new NpmError(describeNpmError(output, code), output, code))
    })
  })
}

/** Turn npm's output into one readable German sentence. */
export function describeNpmError(output: string, code: number | null): string {
  if (/\bE404\b|404 Not Found/.test(output)) {
    const missing = /'([^']+)' is not in this registry/.exec(output)?.[1]
      ?? /404 Not Found - GET \S+\/((?:@[^/\s]+(?:\/|%2[fF]))?[^/\s]+)\s/.exec(output)?.[1]?.replace(/%2[fF]/, '/')
    const name = missing?.replace(/@\*$/, '')
    return name
      ? `Das Paket „${name}“ wurde nicht gefunden. Bitte den Namen prüfen. (Package not found)`
      : 'Ein Paket wurde nicht gefunden. Bitte den Namen prüfen. (Package not found)'
  }
  if (/\bETARGET\b/.test(output)) {
    const what = /No matching version found for (\S+)/.exec(output)?.[1]
    return `Keine passende Version gefunden${what ? ` für ${what}` : ''}. (No matching version)`
  }
  if (/\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ERR_SOCKET_TIMEOUT)\b|network request|request to \S+ failed/i.test(output))
    return 'Keine Verbindung zum Paket-Verzeichnis. Bitte die Internetverbindung prüfen und es noch einmal versuchen. (Offline or registry unreachable)'
  if (/\bENOSPC\b/.test(output))
    return 'Auf dem Datenträger ist nicht genug Platz frei. (Disk full)'
  if (/\b(?:EACCES|EPERM)\b/.test(output))
    return 'Podium darf im Programmordner nicht schreiben. (Permission denied)'
  const lines = output.split(/\r?\n/).filter(line => /^npm (?:error|ERR!)/.test(line) && !/A complete log of this run|^npm error\s*$/.test(line))
  const detail = lines.slice(0, 3).map(line => line.replace(/^npm (?:error|ERR!)\s*/, '')).join(' ').trim()
  return `Die Installation ist fehlgeschlagen${detail ? `: ${detail}` : ` (Code ${code})`}.`
}
