import type { AgentEvent, DeckSnapshot, Settings } from '../../../src/shared/types'
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { splitCommand, buildArgv } from '../../../src/main/agent/argv'
import { parseClaudeLine, parseCodexLine } from '../../../src/main/agent/parse'
import { which } from '../../../src/main/agent/which'
import { createAgentService, FIRST_RUN_INTRO } from '../../../src/main/agent'

const FAKE = resolve(__dirname, '../../fixtures/agent/fake-cli.mjs')

function setup(mode: string, preset: Settings['agentPreset'] = 'claude', template?: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'podium-agent-')))
  const events: AgentEvent[] = []
  const settings = { agentPreset: preset, agentCommand: template ?? `node ${FAKE} ${mode} {prompt}` } as Settings
  const service = createAgentService({ settings: () => settings, onEvent: e => events.push(e) })
  const deck = { deckId: 'd1', dir } as DeckSnapshot
  return { dir, events, settings, service, deck }
}
const types = (e: AgentEvent[]) => e.map(x => x.type)
const argvOf = (events: AgentEvent[]): string[] => {
  const t = events.find(e => e.type === 'text' && e.text.startsWith('ARGV:')) as any
  return JSON.parse(t.text.slice(5))
}

describe('splitCommand', () => {
  it('handles quotes', () => {
    expect(splitCommand(`a "b c" 'd e' f"g h"i ""`)).toEqual(['a', 'b c', 'd e', 'fg hi', ''])
    expect(splitCommand(`x "a \\"q\\" b"`)).toEqual(['x', 'a "q" b'])
    expect(splitCommand('  C:\\bin\\x.exe  y ')).toEqual(['C:\\bin\\x.exe', 'y'])
  })
  it('keeps the prompt as one argument and appends when no placeholder', () => {
    expect(buildArgv('c -p {prompt} --v', 'a b "c"', ['--continue'])).toEqual(['c', '-p', '--continue', 'a b "c"', '--v'])
    expect(buildArgv('c --x', 'p')).toEqual(['c', '--x', 'p'])
  })
})

describe('which', () => {
  it('finds node, not nonsense, honours PATHEXT', () => {
    expect(which('node')).toBeTruthy()
    expect(which('definitely-not-a-binary-xyz')).toBeUndefined()
    expect(which('node', { PATH: '' })).toBeUndefined()
  })
})

describe('parsers', () => {
  it('claude tolerates junk', () => {
    expect(parseClaudeLine('{"type":"assistant","message":{"content":[{"type":"weird"}]}}')).toEqual([])
    expect(parseClaudeLine('{"type":"assistant"}')).toEqual([])
    expect(parseClaudeLine('hallo')).toEqual([{ type: 'text', text: 'hallo' }])
    expect(parseClaudeLine('{"type":"result","subtype":"success","is_error":false}')).toEqual([])
  })
  it('codex tolerates junk', () => {
    expect(parseCodexLine('{"type":"item.completed","item":null}')).toEqual([])
    expect(parseCodexLine('{"msg":{"type":"agent_message","message":"hi"}}')).toEqual([{ type: 'text', text: 'hi' }])
  })
})

describe('createAgentService', () => {
  it('happy path: started, text, done; prompt is one argument with intro on first run', async () => {
    const { service, deck, events } = setup('claude')
    await service.send(deck, 'Mach es "bunter"')
    await waitDone(events)
    expect(types(events)).toEqual(['started', 'text', 'done'])
    expect(events[0]).toMatchObject({ type: 'started', prompt: 'Mach es "bunter"' })
    expect(events.at(-1)).toMatchObject({ ok: true })
    const argv = argvOf(events)
    expect(argv).toHaveLength(1)
    expect(argv[0]).toBe(`${FIRST_RUN_INTRO}\n\nMach es "bunter"`)
  })

  it('adds --continue and no intro on the second run (claude)', async () => {
    const { service, deck, events } = setup('claude')
    await service.send(deck, 'eins'); await waitDone(events)
    events.length = 0
    await service.send(deck, 'zwei'); await waitDone(events)
    expect(argvOf(events)).toEqual(['--continue', 'zwei'])
  })

  it('does not add --continue for custom or after a failed first run', async () => {
    const c = setup('plain', 'custom')
    await c.service.send(c.deck, 'a'); await waitDone(c.events)
    c.events.length = 0
    await c.service.send(c.deck, 'b'); await waitDone(c.events)
    expect(argvOf(c.events)).toEqual(['b'])

    const f = setup('fail')
    await f.service.send(f.deck, 'a'); await waitDone(f.events)
    f.settings.agentCommand = `node ${FAKE} claude {prompt}`
    f.events.length = 0
    await f.service.send(f.deck, 'b'); await waitDone(f.events)
    expect(argvOf(f.events)[0]).toContain(FIRST_RUN_INTRO)
    expect(argvOf(f.events)).not.toContain('--continue')
  })

  it('passes shell metacharacters and newlines untouched, runs in deck dir without stdin', async () => {
    const { service, deck, events } = setup('plain', 'custom')
    const nasty = 'a; rm -rf / && $(echo hi) `x` | "q" \'s\'\nzweite Zeile *'
    await service.send(deck, nasty); await waitDone(events)
    expect(argvOf(events)[0]).toBe(`${FIRST_RUN_INTRO}\n\n${nasty}`.slice(0)) // custom also gets intro
  })

  it('cwd is deck dir and stdin is closed', async () => {
    const { service, deck, events, dir } = setup('cwd', 'custom')
    await service.send(deck, 'x'); await waitDone(events)
    expect(events.find(e => e.type === 'text')).toMatchObject({ text: `CWD:${dir} TTY:no` })
  })

  it('maps tool events and error result, no duplicate exit error', async () => {
    const { service, deck, events } = setup('claude-tools')
    await service.send(deck, 'x'); await waitDone(events)
    const tools = events.filter(e => e.type === 'tool') as any[]
    expect(tools.map(t => [t.name, t.detail])).toEqual([
      ['Read', '/d/slides.md'], ['Edit', '/d/a.md'], ['Bash', 'ls -la'], ['mcp__slidev__get_slide', 'mcp__slidev__get_slide'],
    ])
    expect(events.filter(e => e.type === 'text')).toEqual([{ deckId: 'd1', type: 'text', text: 'not json at all' }])
    expect(events.filter(e => e.type === 'error')).toEqual([{ deckId: 'd1', type: 'error', message: 'Kaputt' }])
    expect(events.at(-1)).toMatchObject({ type: 'done', ok: false })
  })

  it('codex events', async () => {
    const { service, deck, events } = setup('codex', 'codex')
    await service.send(deck, 'x'); await waitDone(events)
    expect(events.filter(e => e.type !== 'started')).toEqual([
      { deckId: 'd1', type: 'tool', name: 'Befehl', detail: 'ls' },
      { deckId: 'd1', type: 'tool', name: 'Datei', detail: 'slides.md' },
      { deckId: 'd1', type: 'text', text: 'Fertig' },
      { deckId: 'd1', type: 'done', ok: true },
    ])
  })

  it('non-zero exit includes stderr tail', async () => {
    const { service, deck, events } = setup('fail')
    await service.send(deck, 'x'); await waitDone(events)
    const err = events.find(e => e.type === 'error') as any
    expect(err.message).toContain('3')
    expect(err.message).toContain('boom: etwas ging schief')
    expect(events.at(-1)).toMatchObject({ type: 'done', ok: false })
  })

  it('missing executable gives German error', async () => {
    const { service, deck, events } = setup('', 'claude', 'no-such-agent-xyz -p {prompt}')
    await service.send(deck, 'x')
    expect(types(events)).toEqual(['started', 'error', 'done'])
    expect((events[1] as any).message).toContain('nicht gefunden')
    expect(events[2]).toMatchObject({ ok: false })
  })

  it('rejects a second send while running, stop ends the run with done ok:false', async () => {
    const { service, deck, events } = setup('sleep')
    await service.send(deck, 'x')
    await waitFor(() => events.some(e => e.type === 'text'))
    await expect(service.send(deck, 'y')).rejects.toThrow(/arbeitet noch/)
    await service.stop('d1')
    expect(events.filter(e => e.type === 'done')).toEqual([{ deckId: 'd1', type: 'done', ok: false }])
    await service.send(deck, 'z') // allowed again
    await service.stop('d1')
  })

  it('stop resolves when nothing runs, and kills a process that ignores SIGTERM', async () => {
    const { service, deck, events } = setup('stubborn')
    await service.stop('nothing')
    await service.send(deck, 'x')
    await waitFor(() => events.some(e => e.type === 'text'))
    await service.stop('d1')
    expect(events.at(-1)).toMatchObject({ type: 'done', ok: false })
  }, 10000)

  it('info', async () => {
    const { service, deck, dir } = setup('claude')
    let i = await service.info(deck, undefined)
    expect(i).toMatchObject({ available: true, hasAgentsFile: false, preset: 'claude' })
    expect(i.mcpUrl).toBeUndefined()
    writeFileSync(join(dir, 'AGENTS.md'), '#')
    i = await service.info(deck, { deckId: 'd1', state: 'ready', mcpUrl: 'http://localhost:1/__mcp' })
    expect(i).toMatchObject({ hasAgentsFile: true, mcpUrl: 'http://localhost:1/__mcp', mcpSetupCommand: 'claude mcp add --transport http podium-deck http://localhost:1/__mcp' })
    const s = setup('', 'codex', 'codex exec --json {prompt}')
    expect((await s.service.info(s.deck, { deckId: 'd1', state: 'ready', mcpUrl: 'http://x/__mcp' })).mcpSetupCommand).toBe('codex mcp add podium-deck --url http://x/__mcp')
    const n = setup('', 'claude', 'no-such-agent-xyz {prompt}')
    expect((await n.service.info(n.deck, undefined)).available).toBe(false)
    expect((await n.service.info(n.deck, { deckId: 'd1', state: 'starting', mcpUrl: 'http://x' })).mcpUrl).toBeUndefined()
  })
})

async function waitFor(cond: () => boolean, ms = 8000) {
  const t = Date.now()
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('timeout')
    await new Promise(r => setTimeout(r, 20))
  }
}
const waitDone = (events: AgentEvent[]) => waitFor(() => events.some(e => e.type === 'done'))
