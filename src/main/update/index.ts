/**
 * App updates. The aim is that nobody has to think about them: the app looks for a new version
 * now and then, loads it in the background and installs it when the app quits anyway. Nothing
 * pops up; the window only shows a small note once an update is ready.
 *
 * Three ways to get there, depending on how the app was installed:
 *  - Windows (NSIS) and Linux AppImage: electron-updater.
 *  - macOS: an own, small updater. Electron's needs an Apple Developer ID signature, which the
 *    builds do not have. This one loads the zip from the release, checks it against the feed's
 *    checksum and swaps the app bundle after the app has quit.
 *  - Anything that cannot replace itself (a .deb, an app run from its disk image): tell the
 *    user there is a new version and where to get it.
 */
import type { UpdateState } from '../../shared/types'
import type { Feed, FeedFile } from './feed'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { app, net } from 'electron'
import { assetUrl, DEFAULT_FEED, feedFileName, isNewer, macArchive, macInstallScript, manualDownload, parseFeed, releasePage } from './feed'

export interface UpdaterOptions {
  userDataDir: string
  onState: (state: UpdateState) => void
  /** The setting: look for updates without being asked. */
  automatic: () => boolean
  /** A presentation is running: no downloads next to a talk or a video call. */
  busy: () => boolean
}

export interface Updater {
  state: () => UpdateState
  /** Look for a new version and load it. `manual` reports problems such as being offline. */
  check: (manual?: boolean) => Promise<UpdateState>
  /** Quit, install and start again. */
  installNow: () => void
  /** Call when the app is about to exit, after everything is saved and closed. */
  installOnQuit: () => void
  /** Begin the quiet background checks. */
  start: () => void
}

type Strategy = 'off' | 'electron' | 'mac' | 'notify'

const FIRST_CHECK_MS = 20_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const RETRY_WHEN_BUSY_MS = 10 * 60 * 1000

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 120_000 }, (error, stdout) => error ? reject(error) : resolve(String(stdout).trim()))
  })
}

/** The Apple team that signed a bundle, or undefined for an ad-hoc signature. codesign reports on stderr. */
function teamOf(bundle: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], { timeout: 60_000 }, (_error, _stdout, stderr) => {
      const team = /^TeamIdentifier=(.+)$/m.exec(String(stderr))?.[1]?.trim()
      resolve(team && team !== 'not set' ? team : undefined)
    })
  })
}

/** The .app this process runs from, when it sits somewhere it can be replaced. */
function replaceableMacBundle(): string | undefined {
  const bundle = dirname(dirname(dirname(app.getPath('exe'))))
  // Gatekeeper runs a freshly downloaded app from a random read-only copy; a disk image is read-only too.
  if (!bundle.endsWith('.app') || bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/'))
    return undefined
  try {
    accessSync(dirname(bundle), constants.W_OK)
    accessSync(bundle, constants.W_OK)
    return bundle
  }
  catch {
    return undefined
  }
}

function pickStrategy(): Strategy {
  if (process.env.PODIUM_NO_UPDATE || (!app.isPackaged && !process.env.PODIUM_UPDATE_FEED))
    return 'off'
  if (process.platform === 'win32' || (process.platform === 'linux' && process.env.APPIMAGE))
    return 'electron'
  if (process.platform === 'darwin')
    return replaceableMacBundle() ? 'mac' : 'notify'
  return 'notify'
}

export function createUpdater(options: UpdaterOptions): Updater {
  const strategy = pickStrategy()
  const feedBase = (process.env.PODIUM_UPDATE_FEED || DEFAULT_FEED).replace(/\/$/, '')
  const updatesDir = join(options.userDataDir, 'updates')
  let current: UpdateState = { status: strategy === 'off' ? 'off' : 'idle', currentVersion: app.getVersion() }
  let checking: Promise<UpdateState> | undefined
  /** macOS: the verified new bundle waiting to be moved into place. */
  let staged: string | undefined
  let relaunch = false
  let electronUpdater: typeof import('electron-updater').autoUpdater | undefined

  function set(patch: Partial<UpdateState>): UpdateState {
    current = { ...current, ...patch }
    options.onState(current)
    return current
  }

  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0]

  /** Quiet checks leave no trace of a failure: being offline is not news. */
  function failed(error: unknown, manual: boolean): UpdateState {
    const keep = current.status === 'ready' || current.status === 'available'
    return set({
      status: keep ? current.status : (manual ? 'error' : 'idle'),
      error: manual ? describe(error) : undefined,
      progress: undefined,
    })
  }

  async function fetchFeed(): Promise<Feed> {
    const response = await net.fetch(`${feedBase}/${feedFileName(process.platform)}`, { cache: 'no-store' })
    // No release published yet reads as "nothing newer".
    if (response.status === 404)
      return { version: app.getVersion(), files: [] }
    if (!response.ok)
      throw new Error(`Update-Server antwortet mit ${response.status}`)
    const feed = parseFeed(await response.text())
    if (!feed)
      throw new Error('Die Update-Information ist nicht lesbar.')
    return feed
  }

  const urlOf = (version: string, file: FeedFile) => process.env.PODIUM_UPDATE_FEED ? `${feedBase}/${file.url}` : assetUrl(version, file.url)

  // --- macOS -----------------------------------------------------------------

  const stagedDir = (version: string) => join(updatesDir, `staged-${version}`)

  async function bundleInfo(bundle: string, key: string): Promise<string> {
    return run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(bundle, 'Contents', 'Info.plist')])
  }

  /** A bundle is only installed when it is intact, is this app, and is the version the feed promised. */
  async function verifiedBundle(dir: string, version: string): Promise<string | undefined> {
    const bundle = join(dir, `${app.getName()}.app`)
    if (!existsSync(bundle))
      return undefined
    try {
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
      const own = replaceableMacBundle()
      const ownId = own ? await bundleInfo(own, 'CFBundleIdentifier') : undefined
      if (!ownId || await bundleInfo(bundle, 'CFBundleIdentifier') !== ownId)
        return undefined
      // An app signed with a Developer ID only accepts an update from the same team. An ad-hoc
      // signed app has no team to compare with; there the feed's checksum is the only check.
      const ownTeam = own ? await teamOf(own) : undefined
      if (ownTeam && await teamOf(bundle) !== ownTeam)
        return undefined
      return await bundleInfo(bundle, 'CFBundleShortVersionString') === version ? bundle : undefined
    }
    catch {
      return undefined
    }
  }

  async function download(url: string, file: FeedFile, target: string): Promise<void> {
    const response = await net.fetch(url, { cache: 'no-store' })
    if (!response.ok || !response.body)
      throw new Error(`Download fehlgeschlagen (${response.status})`)
    const total = Number(response.headers.get('content-length')) || file.size || 0
    const hash = createHash('sha512')
    const out = createWriteStream(target)
    let loaded = 0
    let shown = 0
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk)
        loaded += chunk.length
        if (!out.write(chunk))
          await new Promise(resolve => out.once('drain', resolve))
        if (total && loaded / total - shown >= 0.02) {
          shown = loaded / total
          set({ progress: Math.min(1, shown) })
        }
      }
    }
    finally {
      await new Promise(resolve => out.end(resolve))
    }
    if (hash.digest('base64') !== file.sha512)
      throw new Error('Die geladene Datei ist beschädigt (Prüfsumme stimmt nicht).')
  }

  async function loadForMac(feed: Feed): Promise<UpdateState> {
    const archive = macArchive(feed, process.arch)
    if (!archive)
      throw new Error(`Für diesen Mac (${process.arch}) gibt es in Version ${feed.version} keine Datei.`)
    const dir = stagedDir(feed.version)
    let bundle = await verifiedBundle(dir, feed.version)
    if (!bundle) {
      rmSync(updatesDir, { recursive: true, force: true })
      mkdirSync(updatesDir, { recursive: true })
      const zip = join(updatesDir, archive.url)
      set({ status: 'downloading', version: feed.version, progress: 0, releaseUrl: releasePage(feed.version), error: undefined })
      await download(urlOf(feed.version, archive), archive, zip)
      await run('/usr/bin/ditto', ['-x', '-k', zip, dir])
      rmSync(zip, { force: true })
      bundle = await verifiedBundle(dir, feed.version)
      if (!bundle) {
        rmSync(dir, { recursive: true, force: true })
        throw new Error('Das geladene Update hat die Prüfung nicht bestanden.')
      }
    }
    staged = bundle
    return set({ status: 'ready', version: feed.version, progress: undefined, releaseUrl: releasePage(feed.version), error: undefined, lastChecked: Date.now() })
  }

  /** Leftovers of earlier updates: a bundle already installed, or one for a version that is no longer newer. */
  function tidy(): void {
    let names: string[] = []
    try {
      names = readdirSync(updatesDir)
    }
    catch {
      return
    }
    for (const name of names) {
      const version = /^staged-(.+)$/.exec(name)?.[1]
      if (!version || !isNewer(version, app.getVersion()))
        rmSync(join(updatesDir, name), { recursive: true, force: true })
    }
  }

  // --- electron-updater (Windows, AppImage) ----------------------------------

  async function electron() {
    if (electronUpdater)
      return electronUpdater
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null
    if (process.env.PODIUM_UPDATE_FEED)
      autoUpdater.setFeedURL({ provider: 'generic', url: feedBase })
    autoUpdater.on('update-available', info => set({ status: 'downloading', version: info.version, progress: 0, releaseUrl: releasePage(info.version), error: undefined }))
    autoUpdater.on('download-progress', progress => set({ progress: Math.min(1, progress.percent / 100) }))
    autoUpdater.on('update-downloaded', info => set({ status: 'ready', version: info.version, progress: undefined, releaseUrl: releasePage(info.version), lastChecked: Date.now() }))
    electronUpdater = autoUpdater
    return autoUpdater
  }

  // --- common ----------------------------------------------------------------

  async function runCheck(manual: boolean): Promise<UpdateState> {
    if (strategy === 'off' || current.status === 'ready' || current.status === 'downloading')
      return current
    const before = current.status
    set({ status: 'checking', error: undefined })
    try {
      if (strategy === 'electron') {
        const updater = await electron()
        const result = await updater.checkForUpdates()
        // With a newer version the events take over from here; the download runs on.
        if (result && isNewer(result.updateInfo.version, app.getVersion())) {
          if (current.status === 'checking')
            set({ status: 'downloading', version: result.updateInfo.version, progress: 0, releaseUrl: releasePage(result.updateInfo.version) })
          return current
        }
        return set({ status: 'idle', lastChecked: Date.now() })
      }
      const feed = await fetchFeed()
      if (!isNewer(feed.version, app.getVersion()))
        return set({ status: 'idle', version: undefined, lastChecked: Date.now() })
      if (strategy === 'mac')
        return await loadForMac(feed)
      const file = manualDownload(feed, process.platform, process.arch)
      return set({
        status: 'available',
        version: feed.version,
        downloadUrl: file ? urlOf(feed.version, file) : releasePage(feed.version),
        releaseUrl: releasePage(feed.version),
        lastChecked: Date.now(),
      })
    }
    catch (error) {
      // `set` changed the status since the narrowing above.
      const now = current.status as UpdateState['status']
      if (now === 'checking' || now === 'downloading')
        current = { ...current, status: before === 'available' ? 'available' : 'idle' }
      return failed(error, manual)
    }
  }

  function check(manual = false): Promise<UpdateState> {
    checking ??= runCheck(manual).finally(() => { checking = undefined })
    return checking
  }

  function installOnQuit(): void {
    if (strategy !== 'mac' || current.status !== 'ready' || !staged || !existsSync(staged))
      return
    const target = replaceableMacBundle()
    if (!target)
      return
    try {
      const script = join(updatesDir, 'install.sh')
      writeFileSync(script, macInstallScript(), { mode: 0o700 })
      spawn('/bin/sh', [script, String(process.pid), target, staged, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref()
    }
    catch {
      // The update stays staged and is offered again next time.
    }
  }

  function installNow(): void {
    if (current.status !== 'ready')
      return
    if (strategy === 'electron' && electronUpdater) {
      electronUpdater.quitAndInstall(true, true)
      return
    }
    relaunch = true
    app.quit()
  }

  function start(): void {
    if (strategy === 'off')
      return
    if (strategy === 'mac')
      tidy()
    const tick = () => {
      if (!options.automatic())
        return
      if (options.busy()) {
        setTimeout(tick, RETRY_WHEN_BUSY_MS).unref()
        return
      }
      void check()
    }
    setTimeout(tick, FIRST_CHECK_MS).unref()
    setInterval(tick, CHECK_EVERY_MS).unref()
  }

  return { state: () => current, check, installNow, installOnQuit, start }
}
