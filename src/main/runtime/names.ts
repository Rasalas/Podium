/**
 * Package names: validation and the theme/addon name mapping Slidev applies
 * (see createResolver in @slidev/cli's resolver chunk).
 */

/**
 * npm package name, optionally scoped. Stricter than npm itself: the first character of
 * scope and name must be a letter or digit, so nothing can look like a CLI flag.
 */
const NAME = '(?:@[a-z0-9][a-z0-9._~-]*\\/)?[a-z0-9][a-z0-9._~-]*'
/** Version, range or dist-tag after "@": 1.2.3, ^0.25.0, ~1, >=2, latest, next, 1.x */
const VERSION = '(?:[\\^~]|[<>]=?|=)?[a-zA-Z0-9*][a-zA-Z0-9.+*-]*'

const RE_NAME = new RegExp(`^${NAME}$`)
const RE_SPEC = new RegExp(`^(${NAME})(?:@(${VERSION}))?$`)

/** Same as Slidev's RE_SAFE_PKG_NAME: what it accepts as a theme/addon name at all. */
const RE_SLIDEV_SAFE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

export function isValidPackageName(name: string): boolean {
  return name.length <= 214 && RE_NAME.test(name)
}

/** Parse "name" or "name@version". Returns undefined for anything else. */
export function parseSpec(spec: string): { name: string, version?: string } | undefined {
  if (typeof spec !== 'string' || spec.length > 260)
    return undefined
  const match = RE_SPEC.exec(spec)
  if (!match || match[1].length > 214)
    return undefined
  return { name: match[1], version: match[2] }
}

export type ResolvableKind = 'theme' | 'addon'

/** Official theme shortcuts Slidev knows; unknown bare names fall back to slidev-theme-x. */
const OFFICIAL_THEMES: Record<string, string> = {
  'default': '@slidev/theme-default',
  'seriph': '@slidev/theme-seriph',
  'apple-basic': '@slidev/theme-apple-basic',
  'shibainu': '@slidev/theme-shibainu',
  'bricks': '@slidev/theme-bricks',
}

/** Values that refer to local folders (or nothing) and need no package. */
export function needsNoPackage(raw: string): boolean {
  if (!raw || raw === 'none')
    return true
  if (raw[0] === '/' || raw[0] === '.' || raw.startsWith('@/'))
    return true
  // Windows absolute paths, e.g. C:\themes\x
  if (/^[a-z]:[\\/]/i.test(raw) || raw.includes('\\'))
    return true
  // A slash that is not the scope separator means a path.
  return raw[0] !== '@' && raw.includes('/')
}

/** Can Slidev resolve this name as a package at all? */
export function isResolvableName(raw: string): boolean {
  return RE_SLIDEV_SAFE.test(raw)
}

/** Package names Slidev tries, in order. */
export function candidateNames(raw: string, kind: ResolvableKind): string[] {
  if (raw.startsWith('@') || raw.includes('/'))
    return [raw]
  return [`@slidev/${kind}-${raw}`, `slidev-${kind}-${raw}`, raw]
}

/** The package to install when none of the candidates is present. */
export function installName(raw: string, kind: ResolvableKind): string {
  if (kind === 'theme' && OFFICIAL_THEMES[raw])
    return OFFICIAL_THEMES[raw]
  if (raw.startsWith('@'))
    return raw
  // Slidev would turn "slidev-theme-x" into "slidev-theme-slidev-theme-x"; people
  // writing the full package name mean that package.
  if (raw.startsWith(`slidev-${kind}-`))
    return raw
  return `slidev-${kind}-${raw}`
}
