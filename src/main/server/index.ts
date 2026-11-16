import type { ChildProcess } from 'node:child_process'
import type { RemoteConfig, SlidevServer, SlidevServerOptions } from '../contracts'
import type { ServerStatus } from '../../shared/types'
import { dirname } from 'node:path'
import { extractSlidevError, LineLog, parseStatusLine } from './log'
import { DEFAULT_PORT_RANGE, releasePort, reservePort } from './ports'

export { extractSlidevError, parseStatusLine } from './log'

const START_TIMEOUT_MS = 120_000
const KILL_AFTER_MS = 3_000
const ERROR_TAIL_LINES = 20

// ---------------------------------------------------------------------------
// Never outlive the app: kill every launcher still running when this process exits.
// ---------------------------------------------------------------------------

const live = new Set<ChildProcess>()
let exitHookInstalled = false

function track(child: ChildProcess): void {
  live.add(child)
  child.once('exit', () => live.delete(child))
  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.on('exit', () => {
      for (const proc of live) {
        try {
          proc.kill('SIGKILL')
        }
        catch {}
      }
    })
  }
}

export interface SlidevServerTestOptions {
  /** Port range to pick from. Default 3400–3999. */
  portRange?: [number, number]
  /** Start timeout in ms. Default 120 s. */
  startTimeoutMs?: number
}

export function createSlidevServer(options: SlidevServerOptions & SlidevServerTestOptions): SlidevServer {
  const { deckId, entry, runtime, bridgeClientPath, onStatus } = options
  const log = new LineLog(200)

  let state: ServerStatus = { deckId, state: 'stopped' }
  let child: ChildProcess | undefined
  let starting: Promise<ServerStatus> | undefined
  let stopping: Promise<void> | undefined
  let lastPort: number | undefined
  let remote: RemoteConfig | undefined

  function snapshot(): ServerStatus {
    return { ...state, log: log.all() }
  }

  function setState(next: Omit<ServerStatus, 'deckId'>): void {
    state = { deckId, ...next }
    try {
      onStatus(snapshot())
    }
    catch {}
  }

  function failMessage(headline: string): string {
    const tail = log.tail(ERROR_TAIL_LINES)
    return tail.length ? `${headline}\n\n${tail.join('\n')}` : headline
  }

  function start(): Promise<ServerStatus> {
    if (starting)
      return starting
    if ((state.state === 'ready' || state.state === 'restarting') && child && !stopping)
      return Promise.resolve(snapshot())
    starting = (stopping ?? Promise.resolve()).then(launch).finally(() => {
      starting = undefined
    })
    return starting
  }

  async function launch(): Promise<ServerStatus> {
    log.clear()
    setState({ state: 'starting' })
    let port: number
    try {
      port = await reservePort(options.portRange ?? DEFAULT_PORT_RANGE, lastPort)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setState({ state: 'error', error: message })
      throw new Error(message)
    }
    lastPort = port

    return new Promise<ServerStatus>((resolvePromise, reject) => {
      let settled = false
      let launcherMessage: string | undefined
      let timedOut = false
      const settle = (error?: Error) => {
        if (settled)
          return
        settled = true
        clearTimeout(timer)
        if (error)
          reject(error)
        else
          resolvePromise(snapshot())
      }

      let proc: ChildProcess
      try {
        proc = runtime.spawnNode([
          runtime.launcherPath,
          '--runtime',
          runtime.runtimeDir,
          '--entry',
          entry,
          '--port',
          String(port),
          '--bridge',
          bridgeClientPath,
          ...remoteArgs(),
        ], { cwd: dirname(entry), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      }
      catch (error) {
        releasePort(port)
        const message = `Die Vorschau konnte nicht starten: ${error instanceof Error ? error.message : String(error)}`
        setState({ state: 'error', error: message })
        settle(new Error(message))
        return
      }
      child = proc
      track(proc)
      // Writing to or ending a pipe of a dead process must not crash the app.
      proc.stdin?.on('error', () => {})

      const timer = setTimeout(() => {
        if (settled)
          return
        timedOut = true
        const message = failMessage('Die Vorschau hat nicht rechtzeitig geantwortet (nach 120 Sekunden).')
        setState({ state: 'error', port, error: message })
        settle(new Error(message))
        void terminate(proc)
      }, options.startTimeoutMs ?? START_TIMEOUT_MS)

      const onLine = (line: string) => {
        const event = parseStatusLine(line)
        if (!event) {
          log.push(line)
          return
        }
        if (proc !== child)
          return
        if (event.event === 'ready') {
          const url = event.url || `http://localhost:${port}`
          setState({ state: 'ready', url, port, mcpUrl: `${url}/__mcp` })
          settle()
        }
        else if (event.event === 'restarting') {
          setState({ state: 'restarting', url: state.url, port, mcpUrl: state.mcpUrl })
        }
        else if (event.event === 'error') {
          launcherMessage = event.message
          log.push(`[podium] ${event.message.split('\n')[0]}`)
        }
      }
      proc.stdout?.on('data', (chunk: Buffer) => log.feed('out', chunk.toString()).forEach(onLine))
      proc.stderr?.on('data', (chunk: Buffer) => log.feed('err', chunk.toString()).forEach(line => log.push(line)))

      proc.once('error', (error) => {
        if (proc !== child)
          return
        const message = failMessage(`Die Vorschau konnte nicht starten: ${error.message}`)
        setState({ state: 'error', error: message })
        settle(new Error(message))
      })

      proc.once('exit', (code, signal) => {
        log.flush().forEach(onLine)
        releasePort(port)
        if (proc !== child)
          return
        child = undefined
        if (timedOut)
          return
        if (stopping) {
          settle(new Error('Die Vorschau wurde beendet, bevor sie bereit war.'))
          return
        }
        const reason = extractSlidevError(log.all(), launcherMessage)
          ?? `Die Vorschau wurde unerwartet beendet (${signal ?? `Code ${code}`}).`
        const message = failMessage(reason)
        setState({ state: 'error', port, error: message })
        settle(new Error(message))
      })
    })
  }

  function terminate(proc: ChildProcess): Promise<void> {
    return new Promise((resolvePromise) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolvePromise()
        return
      }
      const killTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        }
        catch {}
      }, KILL_AFTER_MS)
      proc.once('exit', () => {
        clearTimeout(killTimer)
        resolvePromise()
      })
      // The launcher shuts down cleanly when stdin closes; SIGTERM covers a stuck event loop.
      try {
        proc.stdin?.end()
      }
      catch {}
      try {
        proc.kill('SIGTERM')
      }
      catch {}
    })
  }

  function stop(): Promise<void> {
    if (stopping)
      return stopping
    const proc = child
    if (!proc) {
      if (state.state !== 'stopped')
        setState({ state: 'stopped' })
      return Promise.resolve()
    }
    stopping = terminate(proc).then(() => {
      if (child === proc)
        child = undefined
      setState({ state: 'stopped' })
    }).finally(() => {
      stopping = undefined
    })
    return stopping
  }

  async function restart(): Promise<ServerStatus> {
    if (starting)
      await starting.catch(() => {})
    await stop()
    return start()
  }

  function remoteArgs(): string[] {
    return remote ? ['--remote-password', remote.password, '--remote-allow', remote.allow] : []
  }

  async function setRemote(config: RemoteConfig | undefined): Promise<ServerStatus> {
    remote = config ? { ...config } : undefined
    const running = !!child || !!starting
    if (!running)
      return snapshot()
    return restart()
  }

  return {
    status: snapshot,
    start,
    restart,
    stop,
    setRemote,
    remote: () => (remote ? { ...remote } : undefined),
  }
}
