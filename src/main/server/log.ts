/** Server output: a bounded line buffer, status line parsing and error extraction. */

export const STATUS_PREFIX = '@@podium '

export type LauncherEvent =
  | { event: 'ready', port: number, url: string, theme?: string, slides?: number, remote?: boolean }
  | { event: 'restarting', reason?: string }
  | { event: 'error', message: string }

export function parseStatusLine(line: string): LauncherEvent | undefined {
  if (!line.startsWith(STATUS_PREFIX))
    return undefined
  try {
    const data = JSON.parse(line.slice(STATUS_PREFIX.length))
    if (data && typeof data.event === 'string')
      return data as LauncherEvent
  }
  catch {}
  return undefined
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

export class LineLog {
  private lines: string[] = []
  private partial: Record<string, string> = {}

  constructor(private readonly max = 200) {}

  /** Feed a raw chunk from one stream; returns the complete lines it finished. */
  feed(stream: string, chunk: string): string[] {
    const parts = ((this.partial[stream] ?? '') + chunk).split(/\r?\n/)
    this.partial[stream] = parts.pop() ?? ''
    return parts
  }

  push(line: string): void {
    const clean = stripAnsi(line).trimEnd()
    if (!clean)
      return
    this.lines.push(clean)
    if (this.lines.length > this.max)
      this.lines.splice(0, this.lines.length - this.max)
  }

  /** Flush unterminated output, e.g. when the process exits. */
  flush(): string[] {
    const rest = Object.values(this.partial).filter(Boolean)
    this.partial = {}
    return rest
  }

  all(): string[] {
    return [...this.lines]
  }

  tail(n: number): string[] {
    return this.lines.slice(-n)
  }

  clear(): void {
    this.lines = []
    this.partial = {}
  }
}

/** Pick Slidev's own explanation out of the log, if there is one. */
export function extractSlidevError(lines: string[], launcherMessage?: string): string | undefined {
  const text = lines.join('\n')
  const notFound = /The (theme|addon) "([^"]+)" was not found[^\n]*/.exec(text)
  if (notFound)
    return notFound[0]
  const requires = /\[slidev\] (?:theme|addon) "[^"]+" requires Slidev version range[^\n]*/.exec(text)
  if (requires)
    return requires[0]
  const invalid = /Invalid (?:theme|addon) name "[^"]+"[^\n]*/.exec(text)
  if (invalid)
    return invalid[0]
  if (launcherMessage)
    return launcherMessage.split('\n')[0].trim()
  const errorLine = [...lines].reverse().find(line => /^\s*(?:\w*Error|\[slidev\]|error)\b[:\s]/i.test(line))
  return errorLine?.trim()
}
