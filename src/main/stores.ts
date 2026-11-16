import type { RecentDeck, Settings } from '../shared/types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  }
  catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2))
}

export const AGENT_PRESETS: Record<'claude' | 'codex', string> = {
  claude: 'claude -p {prompt} --output-format stream-json --verbose --permission-mode acceptEdits',
  codex: 'codex exec --json {prompt}',
}

const DEFAULT_SETTINGS: Settings = {
  locale: 'system',
  agentPreset: 'claude',
  agentCommand: AGENT_PRESETS.claude,
  autoInstallTrusted: true,
}

export function createSettingsStore(userDataDir: string) {
  const file = join(userDataDir, 'settings.json')
  let settings: Settings = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(file, {}) }
  return {
    get: () => settings,
    set(patch: Partial<Settings>) {
      settings = { ...settings, ...patch }
      if (patch.agentPreset && patch.agentPreset !== 'custom' && patch.agentCommand === undefined)
        settings.agentCommand = AGENT_PRESETS[patch.agentPreset]
      writeJson(file, settings)
      return settings
    },
  }
}

type StoredRecent = Omit<RecentDeck, 'exists'>

export function createRecentStore(userDataDir: string) {
  const file = join(userDataDir, 'recent.json')
  let recents = readJson<StoredRecent[]>(file, [])
  const list = (): RecentDeck[] => recents.map(r => ({ ...r, exists: existsSync(r.path) }))
  return {
    list,
    touch(entry: Omit<StoredRecent, 'lastOpened'>) {
      const previous = recents.find(r => r.path === entry.path)
      recents = [
        { ...previous, ...entry, thumbnail: entry.thumbnail ?? previous?.thumbnail, lastOpened: Date.now() },
        ...recents.filter(r => r.path !== entry.path),
      ].slice(0, 30)
      writeJson(file, recents)
    },
    remove(path: string) {
      recents = recents.filter(r => r.path !== path)
      writeJson(file, recents)
      return list()
    },
  }
}
