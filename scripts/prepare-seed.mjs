// Builds build/runtime-seed: a ready Slidev installation that gets shipped inside the
// installer, so the app works on first start without internet. Adds roughly 600 MB.
// Usage: node scripts/prepare-seed.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const seed = resolve(import.meta.dirname, '../build/runtime-seed')
const npmCli = join(dirname(createRequire(import.meta.url).resolve('npm/package.json')), 'bin/npm-cli.js')

rmSync(seed, { recursive: true, force: true })
mkdirSync(seed, { recursive: true })
writeFileSync(join(seed, 'package.json'), `${JSON.stringify({ name: 'podium-runtime', private: true, type: 'module' }, null, 2)}\n`)
execFileSync(process.execPath, [
  npmCli,
  'install',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '@slidev/cli@^53.1.0',
  '@slidev/theme-default',
  '@slidev/theme-seriph',
], { cwd: seed, stdio: 'inherit' })
console.log(`Seed ready in ${seed}`)
