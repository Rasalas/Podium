import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../../..')
export const DEV_RUNTIME = join(ROOT, '.dev-runtime')

/** Per-run scratch folder. PODIUM_TEST_SCRATCH points it somewhere specific. */
export function scratchDir(name: string): string {
  const base = process.env.PODIUM_TEST_SCRATCH || join(tmpdir(), 'podium-tests')
  const dir = join(base, `${name}-${process.pid}-${Date.now()}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * A private copy of .dev-runtime. A real copy rather than hardlinks: npm writes
 * package.json in place, which would change .dev-runtime through a hardlink.
 */
export function copyDevRuntime(target: string): string {
  execFileSync('cp', ['-a', DEV_RUNTIME, target])
  // Running the app against .dev-runtime (tests/e2e/app) installs the launcher there; the copy starts without it.
  rmSync(join(target, 'podium-launcher.mjs'), { force: true })
  return target
}

/** App resources with the real launcher and one small template. */
export function makeResources(dir: string, template = { name: 'slidev-theme-testklar', version: '1.0.0' }): string {
  mkdirSync(join(dir, 'launcher'), { recursive: true })
  cpSync(join(ROOT, 'launcher', 'launcher.mjs'), join(dir, 'launcher', 'launcher.mjs'))
  writeFileSync(join(dir, 'launcher', 'bridge-client.js'), '// stub bridge client for tests\nwindow.__podiumBridgeStub = true\n')
  const tpl = join(dir, 'templates', 'testklar')
  mkdirSync(join(tpl, 'layouts'), { recursive: true })
  writeFileSync(join(tpl, 'package.json'), JSON.stringify({ name: template.name, version: template.version, keywords: ['slidev-theme'], slidev: {} }, null, 2))
  writeFileSync(join(tpl, 'layouts', 'cover.vue'), '<template><div class="slidev-layout cover"><slot /></div></template>\n')
  // A folder without package.json must be ignored.
  mkdirSync(join(dir, 'templates', 'not-a-template'), { recursive: true })
  return dir
}
