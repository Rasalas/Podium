/** Output parsers. Each turns one stdout line into zero or more events. Unknown shapes are skipped. */
export type ParsedEvent =
  | { type: 'text', text: string }
  | { type: 'tool', name: string, detail: string }
  | { type: 'error', message: string }

export type LineParser = (line: string) => ParsedEvent[]

type Json = Record<string, any>

function tryJson(line: string): Json | undefined {
  const t = line.trim()
  if (!t.startsWith('{')) return undefined
  try {
    const v = JSON.parse(t)
    return v && typeof v === 'object' ? v : undefined
  }
  catch { return undefined }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function toolDetail(name: string, input: Json | undefined): string {
  if (name.startsWith('mcp__')) return name
  const i = input ?? {}
  switch (name) {
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
      return str(i.file_path) || str(i.notebook_path)
    case 'Bash': return str(i.command)
    case 'Glob': case 'Grep': return str(i.pattern)
    case 'WebFetch': return str(i.url)
    case 'WebSearch': return str(i.query)
    default: return name
  }
}

export const parseClaudeLine: LineParser = (line) => {
  if (!line.trim()) return []
  const msg = tryJson(line)
  if (!msg) return [{ type: 'text', text: line }]
  const out: ParsedEvent[] = []
  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    for (const item of msg.message.content) {
      if (item?.type === 'text' && str(item.text).trim()) out.push({ type: 'text', text: item.text })
      else if (item?.type === 'tool_use' && str(item.name)) out.push({ type: 'tool', name: item.name, detail: toolDetail(item.name, item.input) })
    }
  }
  else if (msg.type === 'result') {
    const failed = msg.is_error === true || (str(msg.subtype).startsWith('error'))
    if (failed) out.push({ type: 'error', message: str(msg.result) || str(msg.error) || 'Der Agent meldet einen Fehler.' })
  }
  return out
}

export const parseCodexLine: LineParser = (line) => {
  if (!line.trim()) return []
  const raw = tryJson(line)
  if (!raw) return [{ type: 'text', text: line }]
  // Newer builds wrap events as { id, msg: { type, ... } }
  const ev: Json = raw.msg && typeof raw.msg === 'object' ? raw.msg : raw
  const type = str(ev.type)
  const item: Json | undefined = ev.item && typeof ev.item === 'object' ? ev.item : undefined
  if (type === 'item.completed' || type === 'item.started') {
    if (!item) return []
    const kind = str(item.type)
    if (kind === 'agent_message' && type === 'item.completed' && str(item.text).trim()) return [{ type: 'text', text: item.text }]
    if (kind === 'command_execution' && type === 'item.started') return [{ type: 'tool', name: 'Befehl', detail: str(item.command) }]
    if (kind === 'file_change' && type === 'item.completed') {
      const paths = Array.isArray(item.changes) ? item.changes.map((c: Json) => str(c?.path)).filter(Boolean) : []
      return [{ type: 'tool', name: 'Datei', detail: paths.join(', ') }]
    }
    if (kind === 'mcp_tool_call' && type === 'item.started') return [{ type: 'tool', name: [str(item.server), str(item.tool)].filter(Boolean).join('.') || 'MCP', detail: str(item.tool) }]
    return []
  }
  if (type === 'agent_message' && str(ev.message).trim()) return [{ type: 'text', text: ev.message }]
  if (type === 'exec_command_begin') return [{ type: 'tool', name: 'Befehl', detail: Array.isArray(ev.command) ? ev.command.join(' ') : str(ev.command) }]
  if (type === 'patch_apply_begin' && ev.changes && typeof ev.changes === 'object') return [{ type: 'tool', name: 'Datei', detail: Object.keys(ev.changes).join(', ') }]
  if (type === 'turn.failed') return [{ type: 'error', message: str(ev.error?.message) || 'Der Agent meldet einen Fehler.' }]
  if (type === 'error' && str(ev.message)) return [{ type: 'error', message: ev.message }]
  return []
}

export const parsePlainLine: LineParser = line => (line.trim() ? [{ type: 'text', text: line }] : [])

export function parserFor(preset: 'claude' | 'codex' | 'custom'): LineParser {
  return preset === 'claude' ? parseClaudeLine : preset === 'codex' ? parseCodexLine : parsePlainLine
}
