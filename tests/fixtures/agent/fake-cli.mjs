// Fake agent CLI. Usage: node fake-cli.mjs <mode> [args...]. The remaining args are echoed back.
const [mode, ...args] = process.argv.slice(2)
const say = text => console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }))
const argvLine = `ARGV:${JSON.stringify(args)}`
const tool = (name, input) => console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } }))

switch (mode) {
  case 'claude':
    console.log(JSON.stringify({ type: 'system', subtype: 'init' }))
    say(argvLine)
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'x' }))
    break
  case 'claude-tools':
    tool('Read', { file_path: '/d/slides.md' })
    tool('Edit', { file_path: '/d/a.md' })
    tool('Bash', { command: 'ls -la' })
    tool('mcp__slidev__get_slide', { n: 1 })
    console.log('not json at all')
    console.log(JSON.stringify({ type: 'mystery' }))
    console.log(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Kaputt' }))
    process.exit(1)
    break
  case 'codex':
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 't' }))
    console.log(JSON.stringify({ type: 'item.started', item: { id: '1', type: 'command_execution', command: 'ls' } }))
    console.log(JSON.stringify({ type: 'item.completed', item: { id: '1', type: 'command_execution', command: 'ls', exit_code: 0 } }))
    console.log(JSON.stringify({ type: 'item.completed', item: { id: '2', type: 'file_change', changes: [{ path: 'slides.md', kind: 'update' }] } }))
    console.log(JSON.stringify({ type: 'item.completed', item: { id: '3', type: 'agent_message', text: 'Fertig' } }))
    console.log(JSON.stringify({ type: 'turn.completed' }))
    break
  case 'plain':
    console.log('eins')
    console.log(argvLine)
    break
  case 'fail':
    console.error('a'); console.error('boom: etwas ging schief')
    process.exit(3)
    break
  case 'sleep':
    say('started')
    setTimeout(() => {}, 60000)
    break
  case 'stubborn':
    process.on('SIGTERM', () => {})
    say('started')
    setInterval(() => {}, 1000)
    break
  case 'cwd':
    console.log(`CWD:${process.cwd()} TTY:${process.stdin.isTTY ? 'yes' : 'no'}`)
    break
}
