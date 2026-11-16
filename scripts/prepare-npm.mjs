// Packs node_modules/npm into build/npm.zip for the installer. electron-builder drops
// nested node_modules folders when copying resources, and npm needs its bundled ones.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { zipSync } from 'fflate'

const root = resolve(import.meta.dirname, '../node_modules/npm')
const skip = new Set(['docs', 'man'])
const files = {}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (dir === root && skip.has(name))
      continue
    if (statSync(path).isDirectory())
      walk(path)
    else
      files[relative(root, path).split('\\').join('/')] = readFileSync(path)
  }
}

walk(root)
mkdirSync(resolve(import.meta.dirname, '../build'), { recursive: true })
const target = resolve(import.meta.dirname, '../build/npm.zip')
writeFileSync(target, zipSync(files, { level: 6 }))
console.log(`${Object.keys(files).length} files -> ${target}`)
