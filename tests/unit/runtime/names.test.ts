import { describe, expect, it } from 'vitest'
import { candidateNames, installName, isValidPackageName, needsNoPackage, parseSpec } from '../../../src/main/runtime/names'
import { describeNpmError, npmCliPath } from '../../../src/main/runtime/npm'
import { isTrusted } from '../../../src/main/runtime/trusted'

describe('package name validation', () => {
  it.each([
    'slidev-theme-seriph',
    '@slidev/theme-default',
    '@iconify-json/carbon',
    'slidev-addon-qrcode',
    'a',
    'lodash.merge',
    'x_y~z',
  ])('accepts %s', (name) => {
    expect(isValidPackageName(name)).toBe(true)
    expect(parseSpec(name)).toEqual({ name, version: undefined })
  })

  it.each([
    ['@slidev/theme-apple-basic@^0.25.1', '@slidev/theme-apple-basic', '^0.25.1'],
    ['slidev-theme-x@1.2.3', 'slidev-theme-x', '1.2.3'],
    ['slidev-theme-x@latest', 'slidev-theme-x', 'latest'],
    ['slidev-theme-x@~1', 'slidev-theme-x', '~1'],
    ['slidev-theme-x@>=2.0.0', 'slidev-theme-x', '>=2.0.0'],
    ['slidev-theme-x@1.0.0-beta.1', 'slidev-theme-x', '1.0.0-beta.1'],
  ])('parses %s', (spec, name, version) => {
    expect(parseSpec(spec)).toEqual({ name, version })
  })

  it.each([
    '',
    '--global',
    '-g',
    '.hidden',
    '_private',
    'Upper',
    'has space',
    'a/b',
    '@scope',
    '@scope/',
    '@/x',
    '../evil',
    'git+https://github.com/x/y',
    'https://evil.example/x.tgz',
    'file:../x',
    'x@',
    'x@1 || 2',
    'x@$(rm -rf /)',
    'x;rm -rf /',
    '@-scope/x',
    'x'.repeat(215),
  ])('rejects %j', (name) => {
    expect(parseSpec(name)).toBeUndefined()
  })
})

describe('theme and addon names', () => {
  it('knows which values need no package', () => {
    for (const raw of ['none', '', './theme', '../shared/theme', '/abs/theme', '@/theme', 'themes/mine', 'C:\\themes\\x'])
      expect(needsNoPackage(raw), raw).toBe(true)
    for (const raw of ['default', 'seriph', '@org/theme-x', 'slidev-theme-x'])
      expect(needsNoPackage(raw), raw).toBe(false)
  })

  it('tries the same candidates as Slidev', () => {
    expect(candidateNames('seriph', 'theme')).toEqual(['@slidev/theme-seriph', 'slidev-theme-seriph', 'seriph'])
    expect(candidateNames('qrcode', 'addon')).toEqual(['@slidev/addon-qrcode', 'slidev-addon-qrcode', 'qrcode'])
    expect(candidateNames('@org/my-theme', 'theme')).toEqual(['@org/my-theme'])
  })

  it('picks the package to install', () => {
    expect(installName('default', 'theme')).toBe('@slidev/theme-default')
    expect(installName('seriph', 'theme')).toBe('@slidev/theme-seriph')
    expect(installName('apple-basic', 'theme')).toBe('@slidev/theme-apple-basic')
    expect(installName('penguin', 'theme')).toBe('slidev-theme-penguin')
    expect(installName('slidev-theme-penguin', 'theme')).toBe('slidev-theme-penguin')
    expect(installName('@org/x', 'theme')).toBe('@org/x')
    expect(installName('qrcode', 'addon')).toBe('slidev-addon-qrcode')
    // Addons have no official shortcuts.
    expect(installName('default', 'addon')).toBe('slidev-addon-default')
  })
})

describe('trust list', () => {
  it('trusts official scopes and listed names only', () => {
    expect(isTrusted('@slidev/theme-apple-basic')).toBe(true)
    expect(isTrusted('@iconify-json/mdi')).toBe(true)
    expect(isTrusted('slidev-theme-klar')).toBe(true)
    expect(isTrusted('slidev-addon-qrcode')).toBe(true)
    expect(isTrusted('@slidev/')).toBe(false)
    expect(isTrusted('@slidevx/theme')).toBe(false)
    expect(isTrusted('slidev-theme-unknown-xyz')).toBe(false)
  })
})

describe('npm', () => {
  it('finds the bundled npm', () => {
    expect(npmCliPath()).toMatch(/node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/)
  })

  it('explains failures in plain words', () => {
    expect(describeNpmError(`npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/slidev-theme-nope - Not found
npm error 404
npm error 404  'slidev-theme-nope@*' is not in this registry.`, 1)).toContain('„slidev-theme-nope“ wurde nicht gefunden')
    expect(describeNpmError(`npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@org%2fnope - Not found`, 1)).toContain('„@org/nope“')
    expect(describeNpmError('npm error code ECONNREFUSED\nnpm error syscall connect', 1)).toContain('Internetverbindung')
    expect(describeNpmError('npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/x failed', 1)).toContain('Internetverbindung')
    expect(describeNpmError('npm error code ETARGET\nnpm error notarget No matching version found for x@9.9.9.', 1)).toContain('x@9.9.9')
    expect(describeNpmError('npm error something odd happened', 1)).toContain('something odd happened')
  })
})
