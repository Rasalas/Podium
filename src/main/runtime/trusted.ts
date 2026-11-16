/**
 * Packages that may be installed without asking. Everything else needs the user's OK,
 * because an npm package is code that runs inside the preview.
 *
 * Community entries were checked to exist on the npm registry (2026-11).
 */

const TRUSTED_SCOPES = ['@slidev/', '@iconify-json/']

const TRUSTED_NAMES = new Set([
  // Built into Podium.
  'slidev-theme-klar',
  // Well-known community themes.
  'slidev-theme-academic',
  'slidev-theme-penguin',
  'slidev-theme-purplin',
  'slidev-theme-geist',
  'slidev-theme-eloc',
  'slidev-theme-unicorn',
  'slidev-theme-frankfurt',
  'slidev-theme-dracula',
  'slidev-theme-neversink',
  'slidev-theme-vuetiful',
  // Well-known community addons.
  'slidev-addon-qrcode',
  'slidev-addon-excalidraw',
  'slidev-addon-python-runner',
  'slidev-addon-fancy-arrow',
  'slidev-addon-asciinema',
])

/** `name` without version. */
export function isTrusted(name: string): boolean {
  return TRUSTED_NAMES.has(name) || TRUSTED_SCOPES.some(scope => name.startsWith(scope) && name.length > scope.length)
}
