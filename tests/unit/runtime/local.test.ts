import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { workspacePackages } from '../../../src/main/runtime/local'
// @ts-expect-error plain JS without types
import { workspacePackages as launcherWorkspacePackages } from '../../../launcher/launcher.mjs'

const root = mkdtempSync(join(tmpdir(), 'podium-local-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function pkg(dir: string, json: unknown): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(json))
  return dir
}

describe('packages a deck carries in its own folder', () => {
  const deck = pkg(join(root, 'talk'), { workspaces: ['packages/*', 'extra/addon', '!packages/ignored', '../outside'] })
  const theme = pkg(join(deck, 'packages', 'slidev-theme-haus'), { name: 'slidev-theme-haus' })
  const scoped = pkg(join(deck, 'packages', 'icons'), { name: '@haus/icons' })
  const addon = pkg(join(deck, 'extra', 'addon'), { name: 'slidev-addon-haus' })
  pkg(join(deck, 'packages', 'node_modules', 'trap'), { name: 'trap' })
  pkg(join(deck, 'packages', 'nameless'), { version: '1.0.0' })
  pkg(join(root, 'outside'), { name: 'outside' })
  mkdirSync(join(deck, 'packages', 'no-package-json'), { recursive: true })

  it('finds the workspace packages by name', () => {
    expect(Object.fromEntries(workspacePackages(deck))).toEqual({
      'slidev-theme-haus': theme,
      '@haus/icons': scoped,
      'slidev-addon-haus': addon,
    })
  })

  it('looks at the nearest package.json with workspaces above the deck', () => {
    const nested = join(deck, 'talks', '2026')
    pkg(nested, { name: 'a-talk' })
    expect(workspacePackages(nested).get('slidev-theme-haus')).toBe(theme)
  })

  it('accepts the object form and finds nothing without workspaces', () => {
    const yarn = pkg(join(root, 'yarn'), { workspaces: { packages: ['theme'] } })
    const yarnTheme = pkg(join(yarn, 'theme'), { name: 'slidev-theme-yarn' })
    expect(Object.fromEntries(workspacePackages(yarn))).toEqual({ 'slidev-theme-yarn': yarnTheme })
    expect(workspacePackages(pkg(join(root, 'plain'), { name: 'plain' })).size).toBe(0)
    expect(workspacePackages(join(root, 'does-not-exist')).size).toBe(0)
  })

  it('agrees with the launcher\'s copy', () => {
    expect(Object.fromEntries(launcherWorkspacePackages(deck))).toEqual(Object.fromEntries(workspacePackages(deck)))
  })
})
