/**
 * The real launcher with and without the phone remote, reached over this machine's own
 * Tailscale and LAN addresses. A request to an own address arrives with that address as the
 * client address, so the connection filter is exercised for real.
 *
 * Needs .dev-runtime. Cases that need a Tailscale or LAN address skip without one.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { remoteAddresses } from '../../../src/main/remote'

const ROOT = resolve(import.meta.dirname, '../../..')
const RUNTIME = join(ROOT, '.dev-runtime')
const PASSWORD = 'test-password-0123456789'
const hasRuntime = existsSync(join(RUNTIME, 'node_modules', '@slidev', 'cli', 'package.json'))
const { tailscale, lan } = remoteAddresses()
const LAN = lan[0]

/** Status code of a GET, or the error code when the connection is refused or dropped. */
function get(host: string, port: number, path = '/1'): Promise<number | string> {
  return new Promise((resolvePromise) => {
    const req = request({ host, port, path, timeout: 5000 }, (res) => {
      res.resume()
      res.on('end', () => resolvePromise(res.statusCode ?? 0))
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })))
    req.on('error', (err: NodeJS.ErrnoException) => resolvePromise(err.code ?? err.message))
    req.end()
  })
}

function body(host: string, port: number, path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    request({ host, port, path, timeout: 5000 }, (res) => {
      let text = ''
      res.on('data', c => (text += c))
      res.on('end', () => resolvePromise(text))
    }).on('error', reject).end()
  })
}

interface Launcher { proc: ChildProcessWithoutNullStreams, dir: string, output: () => string }

async function startLauncher(port: number, extra: string[]): Promise<Launcher> {
  const dir = mkdtempSync(join(tmpdir(), 'podium-remote-'))
  cpSync(join(ROOT, 'tests/fixtures/windows/slides.md'), join(dir, 'slides.md'))
  const proc = spawn(process.execPath, [
    join(ROOT, 'launcher/launcher.mjs'),
    '--runtime',
    RUNTIME,
    '--entry',
    join(dir, 'slides.md'),
    '--port',
    String(port),
    ...extra,
  ], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  proc.stdout.on('data', c => (output += c))
  proc.stderr.on('data', c => (output += c))
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`launcher not ready:\n${output}`)), 90_000)
    proc.stdout.on('data', () => {
      if (output.includes('@@podium {"event":"ready"')) {
        clearTimeout(timer)
        resolveReady()
      }
    })
    proc.on('exit', code => reject(new Error(`launcher exited with ${code}:\n${output}`)))
  })
  return { proc, dir, output: () => output }
}

async function stopLauncher(l: Launcher | undefined) {
  if (!l)
    return
  if (l.proc.exitCode === null) {
    const exited = new Promise(r => l.proc.once('exit', r))
    l.proc.stdin.end()
    await Promise.race([exited, new Promise(r => setTimeout(r, 5000))])
    if (l.proc.exitCode === null)
      l.proc.kill('SIGKILL')
  }
  rmSync(l.dir, { recursive: true, force: true })
}

describe.skipIf(!hasRuntime)('launcher and the phone remote', () => {
  describe('with --remote-allow tailscale', () => {
    const PORT = 3463
    let l: Launcher
    beforeAll(async () => {
      l = await startLauncher(PORT, ['--remote-password', PASSWORD, '--remote-allow', 'tailscale'])
    }, 120_000)
    afterAll(() => stopLauncher(l))

    it('reports remote mode and hands Slidev the password', async () => {
      expect(l.output()).toMatch(/@@podium \{"event":"ready".*"remote":true/)
      // Slidev's client config, which its password guard reads.
      expect(await body('localhost', PORT, '/@slidev/configs')).toContain(PASSWORD)
    })

    it('serves localhost', async () => {
      expect(await get('localhost', PORT)).toBe(200)
      expect(await get('127.0.0.1', PORT, `/presenter/1?password=${PASSWORD}`)).toBe(200)
    })

    it.skipIf(!tailscale)('serves the Tailscale address', async () => {
      expect(await get(tailscale!, PORT)).toBe(200)
      expect(await get(tailscale!, PORT, `/presenter/?password=${PASSWORD}`)).toBe(200)
    })

    it.skipIf(!LAN)('refuses the LAN address at connection level', async () => {
      expect(await get(LAN!, PORT)).toMatch(/ECONNRESET|socket hang up/)
    })

    it('sends a phone opening /presenter/ to the live slide, not to slide 1', async () => {
      const location = (path: string) => new Promise<string | undefined>((resolvePromise, reject) => {
        request({ host: 'localhost', port: PORT, path }, (res) => {
          res.resume()
          resolvePromise(res.statusCode === 302 ? res.headers.location : undefined)
        }).on('error', reject).end()
      })
      // A client reports its position the way Slidev's pages do (vite-plugin-vue-server-ref).
      await new Promise<void>((resolvePromise, reject) => {
        const req = request({ host: 'localhost', port: PORT, path: '/@server-reactive/nav', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
          res.resume()
          res.on('end', () => resolvePromise())
        })
        req.on('error', reject)
        req.end(JSON.stringify({ data: { page: 3, clicks: 1 }, timestamp: Date.now() }))
      })
      expect(await location(`/presenter/?password=${PASSWORD}`)).toBe(`/presenter/3?password=${PASSWORD}&clicks=1`)
      expect(await location(`/presenter?password=${PASSWORD}`)).toBe(`/presenter/3?password=${PASSWORD}&clicks=1`)
      expect(await location(`/presenter/2?password=${PASSWORD}`)).toBeUndefined()
    })

    it.skipIf(!tailscale)('keeps the password and the filter across an internal restart', async () => {
      const entry = join(l.dir, 'slides.md')
      const readyCount = () => l.output().split('"event":"ready"').length
      const before = readyCount()
      writeFileSync(entry, readFileSync(entry, 'utf8').replace('theme: default', 'theme: seriph'))
      await expect.poll(l.output, { timeout: 60_000 }).toContain('"event":"restarting","reason":"theme"')
      await expect.poll(readyCount, { timeout: 60_000, interval: 200 }).toBeGreaterThan(before)
      expect(await get(tailscale!, PORT)).toBe(200)
      if (LAN)
        expect(await get(LAN, PORT)).toMatch(/ECONNRESET|socket hang up/)
      expect(await body('localhost', PORT, '/@slidev/configs')).toContain(PASSWORD)
    }, 90_000)
  })

  describe('with --remote-allow lan', () => {
    const PORT = 3464
    let l: Launcher
    beforeAll(async () => {
      l = await startLauncher(PORT, ['--remote-password', PASSWORD, '--remote-allow', 'lan'])
    }, 120_000)
    afterAll(() => stopLauncher(l))

    it.skipIf(!tailscale)('serves the Tailscale address', async () => {
      expect(await get(tailscale!, PORT)).toBe(200)
    })
    it.skipIf(!LAN)('serves the LAN address', async () => {
      expect(await get(LAN!, PORT)).toBe(200)
    })
    it('serves localhost', async () => {
      expect(await get('localhost', PORT)).toBe(200)
    })
  })

  describe('without remote arguments', () => {
    const PORT = 3465
    let l: Launcher
    beforeAll(async () => {
      l = await startLauncher(PORT, [])
    }, 120_000)
    afterAll(() => stopLauncher(l))

    it('serves localhost only and gives Slidev no password', async () => {
      expect(l.output()).toMatch(/"remote":false/)
      expect(await get('localhost', PORT)).toBe(200)
      if (tailscale)
        expect(await get(tailscale, PORT)).toBe('ECONNREFUSED')
      if (LAN)
        expect(await get(LAN, PORT)).toBe('ECONNREFUSED')
      expect(await body('localhost', PORT, '/@slidev/configs')).not.toContain(PASSWORD)
    })
  })
})
