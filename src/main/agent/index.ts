import type { AgentEvent, AgentInfo, DeckSnapshot, ServerStatus } from '../../shared/types'
import type { AgentService, AgentServiceOptions } from '../contracts'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildArgv, splitCommand } from './argv'
import { parserFor } from './parse'
import { which } from './which'

/** Added in front of the user's prompt on the first run of a deck only. */
export const FIRST_RUN_INTRO = 'Diese Präsentation ist in Podium geöffnet. Änderungen an den Markdown-Dateien erscheinen sofort live. Lies bitte zuerst die Datei AGENTS.md im Ordner.'

/** Flag that makes the claude CLI resume the last conversation in the working directory. */
export const CLAUDE_CONTINUE_FLAG = '--continue'

/** Conversation continuity: only the claude preset, only after an earlier successful run for this deck. */
export function continuationArgs(preset: string, hadSuccessfulRun: boolean): string[] {
  return preset === 'claude' && hadSuccessfulRun ? [CLAUDE_CONTINUE_FLAG] : []
}

const KILL_GRACE_MS = 2000
const STDERR_KEEP = 5

interface Run { child: ChildProcess, stopped: boolean, closed: Promise<void> }

export function createAgentService(options: AgentServiceOptions): AgentService {
  const runs = new Map<string, Run>()
  const succeeded = new Set<string>()
  const emit = (e: AgentEvent) => options.onEvent(e)

  function mcpSetup(preset: string, url: string | undefined): string | undefined {
    if (!url) return undefined
    if (preset === 'claude') return `claude mcp add --transport http podium-deck ${url}`
    if (preset === 'codex') return `codex mcp add podium-deck --url ${url}`
    return undefined
  }

  async function info(deck: DeckSnapshot, server: ServerStatus | undefined): Promise<AgentInfo> {
    const { agentPreset, agentCommand } = options.settings()
    const exe = splitCommand(agentCommand)[0]
    const mcpUrl = server?.state === 'ready' ? server.mcpUrl : undefined
    return {
      available: !!exe && !!which(exe),
      preset: agentPreset,
      command: agentCommand,
      mcpUrl,
      mcpSetupCommand: mcpSetup(agentPreset, mcpUrl),
      hasAgentsFile: existsSync(join(deck.dir, 'AGENTS.md')),
    }
  }

  async function send(deck: DeckSnapshot, prompt: string): Promise<void> {
    const id = deck.deckId
    if (runs.has(id)) throw new Error('Der Agent arbeitet noch an der letzten Anfrage. Bitte warte, bis er fertig ist, oder stoppe ihn.')
    const { agentPreset: preset, agentCommand } = options.settings()
    const first = !succeeded.has(id)
    const fullPrompt = first ? `${FIRST_RUN_INTRO}\n\n${prompt}` : prompt
    const argv = buildArgv(agentCommand, fullPrompt, continuationArgs(preset, !first))
    emit({ deckId: id, type: 'started', prompt })

    const exe = argv[0]
    const resolved = exe ? which(exe) : undefined
    if (!resolved) {
      emit({ deckId: id, type: 'error', message: `Der Agent „${exe ?? ''}“ wurde nicht gefunden. Bitte installiere ihn oder passe den Befehl in den Einstellungen an.` })
      emit({ deckId: id, type: 'done', ok: false })
      return
    }

    const parse = parserFor(preset)
    const stderrTail: string[] = []
    let errorSent = false
    const handleLine = (line: string) => {
      for (const ev of parse(line.replace(/\r$/, ''))) {
        if (ev.type === 'error') errorSent = true
        emit({ deckId: id, ...ev })
      }
    }
    const handleErrLine = (line: string) => {
      if (!line.trim()) return
      stderrTail.push(line)
      if (stderrTail.length > STDERR_KEEP) stderrTail.shift()
    }
    const lineSplitter = (cb: (l: string) => void) => {
      let buf = ''
      return {
        push(chunk: string) {
          buf += chunk
          const parts = buf.split('\n')
          buf = parts.pop() ?? ''
          parts.forEach(cb)
        },
        flush() { if (buf) cb(buf); buf = '' },
      }
    }
    const out = lineSplitter(handleLine)
    const err = lineSplitter(handleErrLine)

    let child: ChildProcess
    try {
      child = spawn(resolved, argv.slice(1), { cwd: deck.dir, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true })
    }
    catch (e) {
      emit({ deckId: id, type: 'error', message: `Der Agent konnte nicht gestartet werden: ${(e as Error).message}` })
      emit({ deckId: id, type: 'done', ok: false })
      return
    }
    child.stdout?.setEncoding('utf8').on('data', (d: string) => out.push(d))
    child.stderr?.setEncoding('utf8').on('data', (d: string) => err.push(d))

    const run: Run = { child, stopped: false, closed: undefined as unknown as Promise<void> }
    run.closed = new Promise<void>((resolve) => {
      let finished = false
      const finish = (code: number | null, spawnError?: Error) => {
        if (finished) return
        finished = true
        out.flush()
        err.flush()
        runs.delete(id)
        if (spawnError) {
          emit({ deckId: id, type: 'error', message: `Der Agent konnte nicht gestartet werden: ${spawnError.message}` })
          emit({ deckId: id, type: 'done', ok: false })
        }
        else if (run.stopped) {
          emit({ deckId: id, type: 'done', ok: false })
        }
        else {
          const ok = code === 0
          if (ok) succeeded.add(id)
          else if (!errorSent) {
            const tail = stderrTail.length ? `\n${stderrTail.join('\n')}` : ''
            emit({ deckId: id, type: 'error', message: `Der Agent wurde mit Fehlercode ${code ?? 'unbekannt'} beendet.${tail}` })
          }
          emit({ deckId: id, type: 'done', ok })
        }
        resolve()
      }
      child.on('error', e => finish(null, e))
      child.on('close', code => finish(code))
    })
    runs.set(id, run)
    void run.closed
  }

  async function stop(deckId: string): Promise<void> {
    const run = runs.get(deckId)
    if (!run) return
    run.stopped = true
    run.child.kill('SIGTERM')
    const timer = setTimeout(() => run.child.kill('SIGKILL'), KILL_GRACE_MS)
    await run.closed
    clearTimeout(timer)
  }

  return { info, send, stop }
}
