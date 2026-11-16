/**
 * Podium launcher: starts a Slidev dev server for one deck from the shared runtime.
 *
 * It does what `slidev <entry>` does, plus two additions:
 *  - a markdown rule that tags editable blocks (see src/shared/bridge.ts, ATTR_BLOCK)
 *  - a Vite plugin that injects the bridge client into the page
 *
 * Runs with plain Node (Electron in node mode). No build step, no dependencies of its
 * own: everything is imported from the runtime's node_modules.
 *
 * Usage:
 *   node launcher.mjs --runtime <dir> --entry <slides.md> --port <n> [--bridge <bridge-client.js>]
 *     [--remote-password <pw> --remote-allow <tailscale|lan>]
 *
 * Status lines on stdout start with "@@podium " followed by JSON:
 *   {"event":"ready","port":3412,"url":"http://localhost:3412"}
 *   {"event":"restarting","reason":"theme"}
 *   {"event":"error","message":"..."}
 *
 * The end of stdin means shut down.
 *
 * Phone remote: with the --remote-* arguments this runs Slidev's own remote mode
 * (`slidev --remote <pw>`): the server listens on all interfaces and Slidev asks for the
 * password on its presenter pages. On top of that only loopback and the allowed private
 * ranges may open a connection at all.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ATTR_BLOCK = 'data-pd-block'
const ATTR_EDITABLE = 'data-pd-editable'
const BRIDGE_URL = '/@podium/bridge.js'

// Same lists as @slidev/cli's cli.ts.
const CONFIG_RESTART_FIELDS = ['monaco', 'routerMode', 'fonts', 'css', 'mdc', 'editor', 'theme', 'seoMeta']
const FILES_CHANGE_RESTART = [
  'setup/shiki.ts',
  'setup/katex.ts',
  'setup/preparser.ts',
  'setup/transformers.ts',
  'setup/unocss.ts',
  'setup/vite-plugins.ts',
  'uno.config.ts',
  'unocss.config.ts',
  'vite.config.{js,ts,mjs,mts}',
]

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--'))
      out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
  }
  return out
}

function report(event, data = {}) {
  process.stdout.write(`@@podium ${JSON.stringify({ event, ...data })}\n`)
}

/** True when this file is the script being run, false when a test imports it for its helpers. */
function isMainModule() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  }
  catch {
    return false
  }
}

const standalone = isMainModule()
const args = parseArgs(standalone ? process.argv.slice(2) : [])
const runtimeDir = resolve(args.runtime || dirname(fileURLToPath(import.meta.url)))
const entry = resolve(String(args.entry))
const port = Number(args.port) || 3030
const bridgePath = args.bridge ? resolve(String(args.bridge)) : undefined
const cliRoot = join(runtimeDir, 'node_modules', '@slidev', 'cli')

if (standalone && !existsSync(join(cliRoot, 'package.json'))) {
  report('error', { message: `Slidev is not installed in ${runtimeDir}` })
  process.exit(2)
}
if (standalone && !existsSync(entry)) {
  report('error', { message: `Entry file not found: ${entry}` })
  process.exit(2)
}

// Slidev decides between "local" and "global" installation from argv[1]. Pointing it at
// the CLI inside the runtime makes it resolve themes and addons from the runtime's
// node_modules, so decks need no node_modules of their own.
if (standalone)
  process.argv[1] = join(cliRoot, 'bin', 'slidev.mjs')

// Setup files of a deck or of a theme in the deck's folder (setup/shiki.ts and the like) import
// packages such as @slidev/types. Slidev loads them with Node's resolver, which only looks in
// node_modules above the file. NODE_PATH adds the runtime as the last place to look.
if (standalone) {
  process.env.NODE_PATH = [process.env.NODE_PATH, join(runtimeDir, 'node_modules')].filter(Boolean).join(delimiter)
  createRequire(import.meta.url)('node:module')._initPaths()
}

const importFromRuntime = specifier => import(pathToFileURL(join(runtimeDir, 'node_modules', specifier)).href)
const slidev = standalone ? await importFromRuntime('@slidev/cli/dist/index.mjs') : {}
const { createServer, resolveOptions, parser } = slidev

// ---------------------------------------------------------------------------
// Markdown rule: tag blocks the canvas may edit in place
// ---------------------------------------------------------------------------

const PLAIN_INLINE = new Set([
  'text',
  'softbreak',
  'hardbreak',
  'strong_open',
  'strong_close',
  'em_open',
  'em_close',
  's_open',
  's_close',
  'code_inline',
  'link_open',
  'link_close',
])

function isPlainInline(children) {
  // An empty block (a heading the user has not typed into yet) is editable.
  if (!children?.length)
    return true
  return children.every(child => PLAIN_INLINE.has(child.type) && !(child.type === 'text' && /\{\{|\}\}/.test(child.content)))
}

function parentOf(tokens, index) {
  const level = tokens[index].level
  for (let i = index - 1; i >= 0; i--) {
    if (tokens[i].level === level - 1 && tokens[i].nesting === 1)
      return tokens[i]
  }
}

export function podiumBlocks(md) {
  md.core.ruler.push('podium_blocks', (state) => {
    const tokens = state.tokens
    for (let i = 1; i < tokens.length; i++) {
      const inline = tokens[i]
      // "- " with no text has no paragraph token. Give it an empty editable span so a
      // freshly added list item can take the caret.
      if (inline.type === 'list_item_close' && tokens[i - 1].type === 'list_item_open') {
        const span = new state.Token('html_inline', '', 0)
        span.content = `<span ${ATTR_BLOCK}="listitem" ${ATTR_EDITABLE}="1"></span>`
        const holder = new state.Token('inline', '', 0)
        holder.content = ''
        holder.children = [span]
        holder.level = inline.level + 1
        tokens.splice(i, 0, holder)
        i++
        continue
      }
      if (inline.type !== 'inline')
        continue
      const open = tokens[i - 1]
      const editable = isPlainInline(inline.children)
      if (open.type === 'heading_open') {
        // Only ATX headings ("# Title") map back to one source line.
        if (open.markup.startsWith('#')) {
          open.attrSet(ATTR_BLOCK, 'heading')
          if (editable)
            open.attrSet(ATTR_EDITABLE, '1')
        }
      }
      else if (open.type === 'paragraph_open') {
        const parent = parentOf(tokens, i - 1)
        if (parent?.type === 'list_item_open') {
          // Tight lists render no <p>, so the item's own text gets a wrapper span.
          const start = new state.Token('html_inline', '', 0)
          start.content = `<span ${ATTR_BLOCK}="listitem"${editable ? ` ${ATTR_EDITABLE}="1"` : ''}>`
          const end = new state.Token('html_inline', '', 0)
          end.content = '</span>'
          inline.children = [start, ...(inline.children ?? []), end]
        }
        else if (!parent || parent.type === 'blockquote_open') {
          open.attrSet(ATTR_BLOCK, 'paragraph')
          if (editable)
            open.attrSet(ATTR_EDITABLE, '1')
        }
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Vite plugin: serve and inject the bridge client
// ---------------------------------------------------------------------------

function podiumBridgePlugin() {
  return {
    name: 'podium:bridge',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== BRIDGE_URL)
          return next()
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(bridgePath && existsSync(bridgePath) ? readFileSync(bridgePath) : '')
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Vite plugin: packages for files outside the runtime
// ---------------------------------------------------------------------------

const RE_BARE_IMPORT = /^(?:@[\w.~-]+\/)?[\w.~-]+(?:\/|$)/

/**
 * A theme in the deck's folder imports packages (`@slidev/theme-default/styles`, `@vueuse/core`)
 * that Vite looks for in node_modules above that file, where a Podium deck has none. This runs
 * after Vite's own resolver gave up and looks the package up from inside the runtime.
 */
function podiumRuntimeFallbackPlugin() {
  const anchor = join(runtimeDir, 'package.json')
  return {
    name: 'podium:runtime-fallback',
    async resolveId(source, importer, options) {
      if (!importer || !RE_BARE_IMPORT.test(source) || source.includes(':'))
        return null
      const importerFile = importer.split('?')[0].replaceAll('\\', '/')
      if (importerFile.startsWith(`${runtimeDir.replaceAll('\\', '/')}/`))
        return null
      return this.resolve(source, anchor, { ...options, skipSelf: true })
    },
  }
}

// ---------------------------------------------------------------------------
// Phone remote: which client addresses may connect
// ---------------------------------------------------------------------------

/** Parse dotted IPv4 into a 32-bit number, or undefined. */
export function parseIPv4(text) {
  const parts = String(text).split('.')
  if (parts.length !== 4)
    return undefined
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255)
      return undefined
    value = value * 256 + Number(part)
  }
  return value
}

/** Parse IPv6 (with "::" and an optional trailing dotted IPv4) into eight 16-bit groups, or undefined. */
export function parseIPv6(text) {
  let s = String(text).toLowerCase()
  if (!s.includes(':'))
    return undefined
  const tail = []
  const dotted = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (dotted) {
    const v4 = parseIPv4(dotted[1])
    if (v4 === undefined)
      return undefined
    tail.push(v4 >>> 16, v4 & 0xFFFF)
    s = s.slice(0, s.length - dotted[1].length)
    if (s.endsWith(':') && !s.endsWith('::'))
      s = s.slice(0, -1)
  }
  const halves = s.split('::')
  if (halves.length > 2)
    return undefined
  const groups = (part) => {
    if (part === '')
      return []
    const out = []
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g))
        return undefined
      out.push(Number.parseInt(g, 16))
    }
    return out
  }
  const head = groups(halves[0])
  const rest = halves.length === 2 ? groups(halves[1]) : []
  if (!head || !rest)
    return undefined
  const count = head.length + rest.length + tail.length
  if (halves.length === 1 ? count !== 8 : count > 7)
    return undefined
  return [...head, ...Array.from({ length: 8 - count }, () => 0), ...rest, ...tail]
}

/** Strip brackets and the zone id ("fe80::1%eth0"), unwrap IPv4-mapped IPv6 ("::ffff:1.2.3.4"). */
export function normalizeAddress(address) {
  let s = String(address ?? '').trim().toLowerCase()
  if (s.startsWith('[') && s.endsWith(']'))
    s = s.slice(1, -1)
  s = s.replace(/%.*$/, '')
  const words = parseIPv6(s)
  if (words && words.slice(0, 5).every(w => w === 0) && words[5] === 0xFFFF)
    return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`
  return s
}

function inV4(value, base, bits) {
  const size = 2 ** (32 - bits)
  return Math.floor(value / size) === Math.floor(parseIPv4(base) / size)
}

function inV6(words, prefix, bits) {
  const base = parseIPv6(prefix)
  for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
    const take = Math.min(16, bits)
    const mask = (0xFFFF << (16 - take)) & 0xFFFF
    if ((words[i] & mask) !== (base[i] & mask))
      return false
  }
  return true
}

/**
 * Sort a client address into the buckets the allow rules use:
 * 'loopback', 'tailscale' (100.64.0.0/10, fd7a:115c:a1e0::/48), 'private' (RFC 1918,
 * link-local and unique local IPv6), 'public', or 'invalid'.
 */
export function classifyAddress(address) {
  const s = normalizeAddress(address)
  const v4 = parseIPv4(s)
  if (v4 !== undefined) {
    if (inV4(v4, '127.0.0.0', 8))
      return 'loopback'
    if (inV4(v4, '100.64.0.0', 10))
      return 'tailscale'
    if (inV4(v4, '10.0.0.0', 8) || inV4(v4, '172.16.0.0', 12) || inV4(v4, '192.168.0.0', 16))
      return 'private'
    return 'public'
  }
  const v6 = parseIPv6(s)
  if (!v6)
    return 'invalid'
  if (v6.slice(0, 7).every(w => w === 0) && v6[7] === 1)
    return 'loopback'
  if (inV6(v6, 'fd7a:115c:a1e0::', 48))
    return 'tailscale'
  if (inV6(v6, 'fe80::', 10) || inV6(v6, 'fc00::', 7))
    return 'private'
  return 'public'
}

export function isLoopback(address) {
  return classifyAddress(address) === 'loopback'
}

/** May a client at `address` open a connection at all? `allow` is 'tailscale' or 'lan'. */
export function isAllowedClient(address, allow) {
  const kind = classifyAddress(address)
  if (kind === 'loopback')
    return true
  if (kind === 'tailscale')
    return allow === 'tailscale' || allow === 'lan'
  if (kind === 'private')
    return allow === 'lan'
  return false
}

const remote = args['remote-password']
  ? { password: String(args['remote-password']), allow: String(args['remote-allow'] || 'tailscale') }
  : undefined

if (standalone && remote && !['tailscale', 'lan'].includes(remote.allow)) {
  report('error', { message: `Unknown --remote-allow value: ${remote.allow}` })
  process.exit(2)
}

/** Where the live presentation is, from Slidev's shared `nav` state (page 0 = nobody reported yet). */
let liveNav = { page: 0, clicks: 0 }

/**
 * Slidev's `/presenter/` redirects to `/presenter/1`, and every page reports its own position
 * when it loads. A phone opening the remote link mid-talk would pull everyone back to slide 1.
 * Send it to the live slide instead, keeping the password.
 */
function podiumPresenterEntryPlugin() {
  return {
    name: 'podium:presenter-entry',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!remote || req.method !== 'GET' || !req.url || liveNav.page < 1)
          return next()
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname !== '/presenter' && url.pathname !== '/presenter/')
          return next()
        url.searchParams.set('clicks', String(liveNav.clicks || 0))
        res.statusCode = 302
        res.setHeader('Location', `/presenter/${liveNav.page}?${url.searchParams}`)
        res.setHeader('Cache-Control', 'no-store')
        res.end()
      })
    },
  }
}

/** Drop connections from addresses the remote mode does not allow, before any byte is read. */
function installConnectionFilter(httpServer) {
  if (!remote || !httpServer)
    return
  httpServer.prependListener('connection', (socket) => {
    if (!isAllowedClient(socket.remoteAddress, remote.allow))
      socket.destroy()
  })
}

// ---------------------------------------------------------------------------
// Server lifecycle, following @slidev/cli's dev command
// ---------------------------------------------------------------------------

function themeMeta(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).slidev ?? {}
  }
  catch {
    return {}
  }
}

function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** A deck, theme or addon may bring its own markdownSetup. Ours must run in addition, not instead. */
async function userMarkdownSetups(options) {
  const { loadConfigFromFile } = await importFromRuntime('vite/dist/node/index.js')
  const setups = []
  for (const root of options.roots) {
    for (const ext of ['mjs', 'js', 'mts', 'ts']) {
      const file = join(root, `vite.config.${ext}`)
      if (!existsSync(file))
        continue
      try {
        const loaded = await loadConfigFromFile({ mode: 'development', command: 'serve' }, file)
        const setup = loaded?.config?.slidev?.markdown?.markdownSetup
        if (typeof setup === 'function')
          setups.push(setup)
      }
      catch {}
      break
    }
  }
  return setups
}

let server
let watcher
let restartTimer
let stopping = false

// ---------------------------------------------------------------------------
// Themes a deck carries in its own folder
//
// A talk repository often keeps its theme as a workspace package (`packages/slidev-theme-x`)
// and names it like an npm package. With `npm install` done, Slidev finds it through the
// workspace link in node_modules. Podium decks have no node_modules, so the launcher looks
// the name up in the workspace itself and hands Slidev the folder as a path-style theme.
// src/main/runtime/local.ts is the TypeScript twin of `workspacePackages`. Keep them in step.

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  catch {
    return undefined
  }
}

function subfolders(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
      .map(entry => entry.name)
  }
  catch {
    return []
  }
}

function expandWorkspacePattern(root, pattern) {
  let dirs = [root]
  for (const segment of pattern.split('/').filter(part => part && part !== '.')) {
    if (segment === '..')
      return []
    if (!segment.includes('*')) {
      dirs = dirs.map(dir => join(dir, segment))
      continue
    }
    const matcher = new RegExp(`^${segment.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    dirs = dirs.flatMap(dir => subfolders(dir).filter(name => matcher.test(name)).map(name => join(dir, name)))
  }
  return dirs
}

/** Package name → folder for the workspace packages of the nearest package.json with `workspaces`. */
export function workspacePackages(deckDir) {
  const found = new Map()
  let dir = resolve(deckDir)
  while (true) {
    const raw = readJson(join(dir, 'package.json'))?.workspaces
    const patterns = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? raw.packages : undefined)
    if (Array.isArray(patterns)) {
      for (const pattern of patterns) {
        if (typeof pattern !== 'string' || pattern.startsWith('!'))
          continue
        for (const folder of expandWorkspacePattern(dir, pattern)) {
          const name = readJson(join(folder, 'package.json'))?.name
          if (typeof name === 'string' && name && !found.has(name))
            found.set(name, folder)
        }
      }
      return found
    }
    const parent = dirname(dir)
    if (parent === dir)
      return found
    dir = parent
  }
}

/** The theme as a path relative to the entry when the deck brings it along, else undefined. */
function localThemePath(themeRaw) {
  if (typeof themeRaw !== 'string' || !/^[a-z0-9-~][a-z0-9-._~]*$/.test(themeRaw))
    return undefined
  const local = workspacePackages(dirname(entry))
  for (const name of [`slidev-theme-${themeRaw}`, themeRaw]) {
    const folder = local.get(name)
    if (folder) {
      const path = relative(dirname(entry), folder).replaceAll('\\', '/')
      // Slidev reads a leading "." as "relative to the entry file".
      return path.startsWith('.') ? path : `./${path}`
    }
  }
  return undefined
}

/** `theme` from the first frontmatter block, as Slidev reads it. */
async function declaredTheme(loadedSource) {
  const userRoot = dirname(entry)
  const loaded = await parser.load({ userRoot, roots: [userRoot], allowedRoots: [userRoot] }, entry, loadedSource, 'dev')
  return loaded.headmatter.theme
}

async function restart(reason) {
  if (stopping)
    return
  report('restarting', { reason })
  const closing = server
  server = undefined
  // The new server starts with fresh shared state; the clients report their position again.
  liveNav = { page: 0, clicks: 0 }
  await closing?.close().catch(() => {})
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    start().catch(fail)
  }, 300)
}

function fail(error) {
  report('error', { message: error?.stack || String(error) })
  process.exit(1)
}

async function start() {
  // `remote` is what `slidev --remote <pw>` passes: Slidev then guards its presenter pages with the password.
  // The theme as the deck names it. Slidev's own `themeRaw` holds the folder instead when the deck brings the theme along.
  const startedTheme = (await declaredTheme()) || 'default'
  const themePath = localThemePath(startedTheme)
  const options = await resolveOptions({
    entry,
    ...(themePath ? { theme: themePath } : {}),
    ...(remote ? { remote: remote.password } : {}),
  }, 'dev')
  // Slidev serves its index.html from memory and skips Vite's HTML transforms, so the
  // bridge script goes straight into that string.
  if (bridgePath)
    options.utils.indexHtml = options.utils.indexHtml.replace('</body>', `<script type="module" src="${BRIDGE_URL}"></script>\n</body>`)
  const setups = await userMarkdownSetups(options)

  server = await createServer(options, {
    server: { port, strictPort: true, host: remote ? '0.0.0.0' : 'localhost' },
    logLevel: 'warn',
    clearScreen: false,
    plugins: [podiumBridgePlugin(), podiumPresenterEntryPlugin(), podiumRuntimeFallbackPlugin()],
    slidev: {
      serverRef: {
        onChanged(key, data) {
          if (key === 'nav' && data && Number(data.page) >= 1)
            liveNav = { page: Number(data.page), clicks: Number(data.clicks) || 0 }
        },
      },
      markdown: {
        async markdownSetup(md) {
          for (const setup of setups)
            await setup(md)
          md.use(podiumBlocks)
        },
      },
    },
  }, {
    async loadData(loadedSource) {
      const { data: oldData } = options
      const loaded = await parser.load(options, entry, loadedSource, 'dev')
      const themeRaw = loaded.headmatter.theme || 'default'
      if (startedTheme !== themeRaw) {
        restart('theme')
        return false
      }
      const meta = options.themeRoots[0] ? themeMeta(options.themeRoots[0]) : undefined
      const newData = { ...loaded, themeMeta: meta, config: parser.resolveConfig(loaded.headmatter, meta, entry) }
      // Slidev keeps the resolved theme here, which is the folder for a theme the deck brings along.
      newData.config.theme = oldData.config.theme
      if (CONFIG_RESTART_FIELDS.some(key => !equal(newData.config[key], oldData.config[key])) || !equal(newData.config.addons, oldData.config.addons)) {
        restart('config')
        return false
      }
      if ((newData.features.katex && !oldData.features.katex) || (newData.features.monaco && !oldData.features.monaco)) {
        restart('feature')
        return false
      }
      return newData
    },
  })

  installConnectionFilter(server.httpServer)
  await server.listen()

  await watcher?.close()
  const { watch } = await importFromRuntime('chokidar/index.js').catch(() => ({}))
  if (watch) {
    const files = options.roots
      .filter(root => !root.includes('node_modules'))
      .flatMap(root => FILES_CHANGE_RESTART.map(file => join(root, file)))
    watcher = watch(files, { ignoreInitial: true, ignorePermissionErrors: true })
    for (const event of ['add', 'change', 'unlink'])
      watcher.on(event, () => restart('files'))
  }

  report('ready', { port, url: `http://localhost:${port}`, theme: options.theme, slides: options.data.slides.length, remote: !!remote })
}

async function shutdown() {
  stopping = true
  clearTimeout(restartTimer)
  await watcher?.close().catch(() => {})
  await server?.close().catch(() => {})
  process.exit(0)
}

if (standalone) {
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  // The parent closes our stdin when it goes away; do not linger as an orphan.
  process.stdin.on('end', shutdown)
  process.stdin.resume()
}

if (standalone && !args['no-start'])
  start().catch(fail)
