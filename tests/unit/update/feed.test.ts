import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assetUrl, feedFileName, isNewer, macArchive, macInstallScript, manualDownload, parseFeed } from '../../../src/main/update/feed'

const MAC_FEED = `version: 0.3.0
files:
  - url: Podium-0.3.0-arm64.zip
    sha512: aGVsbG8=
    size: 123
  - url: Podium-0.3.0-x64.zip
    sha512: d29ybGQ=
    size: 124
  - url: Podium-0.3.0-arm64.dmg
    sha512: YQ==
    size: 125
  - url: Podium-0.3.0-x64.dmg
    sha512: Yg==
    size: 126
path: Podium-0.3.0-arm64.zip
sha512: aGVsbG8=
releaseDate: '2026-11-16T12:00:00.000Z'
`

describe('update feed', () => {
  it('names the feed file per platform', () => {
    expect([feedFileName('darwin'), feedFileName('win32'), feedFileName('linux')]).toEqual(['latest-mac.yml', 'latest.yml', 'latest-linux.yml'])
  })

  it('reads what electron-builder writes', () => {
    const feed = parseFeed(MAC_FEED)!
    expect(feed.version).toBe('0.3.0')
    expect(macArchive(feed, 'arm64')).toEqual({ url: 'Podium-0.3.0-arm64.zip', sha512: 'aGVsbG8=', size: 123 })
    expect(macArchive(feed, 'x64')?.url).toBe('Podium-0.3.0-x64.zip')
    expect(macArchive(feed, 'ia32')).toBeUndefined()
    expect(manualDownload(feed, 'darwin', 'arm64')?.url).toBe('Podium-0.3.0-arm64.dmg')
  })

  it('offers the right installer on Linux and Windows', () => {
    const linux = parseFeed('version: 0.3.0\nfiles:\n  - url: Podium-0.3.0.AppImage\n    sha512: YQ==\n  - url: podium_0.3.0_amd64.deb\n    sha512: Yg==\n')!
    expect(manualDownload(linux, 'linux', 'x64')?.url).toBe('podium_0.3.0_amd64.deb')
    const windows = parseFeed('version: 0.3.0\nfiles:\n  - url: Podium-Setup-0.3.0.exe\n    sha512: YQ==\n')!
    expect(manualDownload(windows, 'win32', 'x64')?.url).toBe('Podium-Setup-0.3.0.exe')
    expect(assetUrl('0.3.0', 'Podium-Setup-0.3.0.exe')).toBe('https://github.com/Rasalas/Podium/releases/download/v0.3.0/Podium-Setup-0.3.0.exe')
  })

  it('rejects anything that is not a feed and file names that point elsewhere', () => {
    expect(parseFeed('<html>Not Found</html>')).toBeUndefined()
    expect(parseFeed('version: latest\nfiles: []')).toBeUndefined()
    expect(parseFeed('version: 1.0.0')).toBeUndefined()
    expect(parseFeed('')).toBeUndefined()
    const feed = parseFeed('version: 1.0.0\nfiles:\n  - url: ../../evil-arm64.zip\n    sha512: YQ==\n  - url: https://example.com/x-arm64.zip\n    sha512: YQ==\n  - url: ok-arm64.zip\n    sha512: YQ==\n  - url: nosum-arm64.zip\n')!
    expect(feed.files.map(f => f.url)).toEqual(['ok-arm64.zip'])
  })

  it('compares versions', () => {
    expect(isNewer('0.2.1', '0.2.0')).toBe(true)
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('v0.2.1', '0.2.0')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.9', '0.2.0')).toBe(false)
    // A finished version comes after its own pre-release, never the other way round.
    expect(isNewer('1.0.0', '1.0.0-beta.2')).toBe(true)
    expect(isNewer('1.0.0-beta.2', '1.0.0')).toBe(false)
    expect(isNewer('nonsense', '0.2.0')).toBe(false)
    expect(isNewer('0.3.0', 'nonsense')).toBe(false)
  })
})

// The swap itself is plain shell and moves folders, so it runs anywhere with /bin/sh.
describe.skipIf(process.platform === 'win32')('macOS install script', () => {
  const root = mkdtempSync(join(tmpdir(), 'podium-update-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const script = join(root, 'install.sh')
  writeFileSync(script, macInstallScript(), { mode: 0o700 })

  function bundle(dir: string, version: string): string {
    mkdirSync(join(dir, 'Contents'), { recursive: true })
    writeFileSync(join(dir, 'Contents', 'version'), version)
    return dir
  }
  const versionOf = (dir: string) => readFileSync(join(dir, 'Contents', 'version'), 'utf8')
  // A pid that is not running: the script must not wait.
  const DEAD_PID = '999999'

  it('puts the new bundle in place and leaves nothing behind', () => {
    const target = bundle(join(root, 'a', 'Podium.app'), 'old')
    const staged = bundle(join(root, 'a', 'staged', 'Podium.app'), 'new')
    execFileSync('/bin/sh', [script, DEAD_PID, target, staged, '0'])
    expect(versionOf(target)).toBe('new')
    expect(existsSync(staged)).toBe(false)
    expect(existsSync(`${target}.previous`)).toBe(false)
  })

  it('keeps the old app when there is nothing to install', () => {
    const target = bundle(join(root, 'b', 'Podium.app'), 'old')
    expect(() => execFileSync('/bin/sh', [script, DEAD_PID, target, join(root, 'b', 'missing.app'), '0'])).toThrow()
    expect(versionOf(target)).toBe('old')
  })

  it('removes a backup left by an interrupted earlier run', () => {
    const target = bundle(join(root, 'c', 'Podium.app'), 'old')
    bundle(`${target}.previous`, 'older')
    const staged = bundle(join(root, 'c', 'staged', 'Podium.app'), 'new')
    execFileSync('/bin/sh', [script, DEAD_PID, target, staged, '0'])
    expect(versionOf(target)).toBe('new')
    expect(existsSync(`${target}.previous`)).toBe(false)
  })
})
