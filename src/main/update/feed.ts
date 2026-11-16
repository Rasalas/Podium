/**
 * The update feed: the `latest*.yml` files electron-builder attaches to every GitHub release.
 * Pure helpers, no Electron.
 */
import YAML from 'yaml'

export const REPO_URL = 'https://github.com/Rasalas/Podium'
/** GitHub redirects this to the assets of the newest published release. */
export const DEFAULT_FEED = `${REPO_URL}/releases/latest/download`

export interface FeedFile {
  url: string
  sha512: string
  size?: number
}

export interface Feed {
  version: string
  files: FeedFile[]
}

export function feedFileName(platform: string): string {
  return platform === 'darwin' ? 'latest-mac.yml' : platform === 'win32' ? 'latest.yml' : 'latest-linux.yml'
}

/** Undefined when the text is not a feed: an error page, a half-written file. */
export function parseFeed(text: string): Feed | undefined {
  let data: unknown
  try {
    data = YAML.parse(text)
  }
  catch {
    return undefined
  }
  if (!data || typeof data !== 'object')
    return undefined
  const { version, files } = data as { version?: unknown, files?: unknown }
  if (typeof version !== 'string' || !parseVersion(version) || !Array.isArray(files))
    return undefined
  const list = files.filter((f): f is FeedFile => !!f && typeof f.url === 'string' && typeof f.sha512 === 'string' && isPlainFileName(f.url))
  return { version, files: list }
}

/** Asset names only: nothing in the feed may point somewhere else. */
function isPlainFileName(name: string): boolean {
  return /^[\w.+-]+$/.test(name) && !name.startsWith('.')
}

function parseVersion(version: string): { numbers: number[], pre: boolean } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-[\w.]+)?(?:\+[\w.]+)?$/.exec(version.trim())
  return match ? { numbers: [Number(match[1]), Number(match[2]), Number(match[3])], pre: !!match[4] } : undefined
}

/** Is `candidate` a later version than `current`? Unreadable versions never are. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b)
    return false
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i])
      return a.numbers[i] > b.numbers[i]
  }
  // 1.0.0 comes after 1.0.0-beta.
  return b.pre && !a.pre
}

/** The archive this Mac can install itself from: the zip for its processor. */
export function macArchive(feed: Feed, arch: string): FeedFile | undefined {
  return feed.files.find(f => f.url.endsWith(`-${arch}.zip`))
}

/** What a person downloads by hand on this platform. */
export function manualDownload(feed: Feed, platform: string, arch: string): FeedFile | undefined {
  if (platform === 'darwin')
    return feed.files.find(f => f.url.endsWith(`-${arch}.dmg`))
  if (platform === 'linux')
    return feed.files.find(f => f.url.endsWith('.deb')) ?? feed.files.find(f => f.url.endsWith('.AppImage'))
  return feed.files.find(f => f.url.endsWith('.exe'))
}

export function releasePage(version: string): string {
  return `${REPO_URL}/releases/tag/v${version}`
}

export function assetUrl(version: string, file: string): string {
  return `${REPO_URL}/releases/download/v${version}/${file}`
}

/**
 * Shell script that swaps the app bundle once the app has quit. It runs detached, so it must
 * leave a working app behind whatever happens: the old bundle is only removed after the new one
 * is in place, and comes back if the move fails.
 */
export function macInstallScript(): string {
  return `#!/bin/sh
# Podium update: usage install.sh <pid> <target.app> <staged.app> <relaunch 0|1>
PID="$1"; TARGET="$2"; STAGED="$3"; RELAUNCH="$4"
BACKUP="$TARGET.previous"
i=0
while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 150 ]; do sleep 0.2; i=$((i + 1)); done
[ -d "$STAGED" ] || exit 1
rm -rf "$BACKUP"
if mv "$TARGET" "$BACKUP"; then
  if mv "$STAGED" "$TARGET" || /usr/bin/ditto "$STAGED" "$TARGET"; then
    rm -rf "$BACKUP" "$STAGED"
  else
    rm -rf "$TARGET"
    mv "$BACKUP" "$TARGET"
  fi
fi
[ "$RELAUNCH" = "1" ] && /usr/bin/open "$TARGET"
exit 0
`
}
