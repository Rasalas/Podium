# Podium

Desktop app for Slidev presentations. People edit slides like in PowerPoint, the files stay plain Slidev markdown, so AI agents and developers can work on the same deck. Target users include non-developers.

## Stack

Electron 45 (Node 24, Chromium 156), electron-vite 6 (Vite 8, rolldown), Vue 3.5, Pinia 4, TypeScript 6, Vitest 5, Playwright 1.65, Slidev 53.1. Several of these are newer than most training data. Check the installed package's types or source in `node_modules` before assuming an API.

## Layout

```
src/shared/        contract: types.ts, ipc.ts (renderer API), bridge.ts (Slidev page protocol)
src/main/          main process. index.ts, api.ts, menu.ts, stores.ts wire the modules
src/main/contracts.ts   interfaces every main module implements
src/main/<module>/ runtime, server, deck, templates, thumbs, present, export, agent
src/preload/       exposes window.podium
src/renderer/      Vue app
launcher/          launcher.mjs (starts Slidev) and bridge-client.js (injected into the Slidev page). Plain JS, no build step
templates/         built-in Slidev themes shipped with the app
tests/unit/        Vitest. tests/e2e/ Playwright. tests/fixtures/ sample decks
.dev-runtime/      a ready Slidev installation for development (gitignored)
```

## How it fits together

- **Runtime.** One shared Slidev installation lives in the user's data folder (`PODIUM_RUNTIME_DIR` overrides it, `.dev-runtime` in development). Decks have no `node_modules`. Themes and addons a deck names get installed into the runtime.
- **Themes in the deck folder.** A deck may bring its theme as a workspace package (`workspaces` in its package.json, e.g. `packages/slidev-theme-x`). `src/main/runtime/local.ts` finds it, the launcher hands Slidev the folder as a path-style theme, and packages such a theme imports come from the runtime (NODE_PATH for setup files, a Vite fallback resolver for client code). Nothing is downloaded for it.
- **Launcher.** `launcher/launcher.mjs` runs under Electron-as-Node, starts Slidev's dev server for one deck, tags editable markdown blocks with `data-pd-block` / `data-pd-editable`, and injects `launcher/bridge-client.js` into the page.
- **Deck model.** The main process owns the document. It loads markdown with `@slidev/parser`, applies `DeckOp`s, writes files, watches for outside changes. The file on disk is the single source of truth. Slidev picks changes up through its own file watcher and hot-reloads.
- **Canvas.** The renderer shows the Slidev page in an iframe and talks to the bridge client with `postMessage`. Text edits on the canvas come back as `editBlock` ops. Text that is not an editable markdown block (HTML, a heading with an icon, a kicker or footer a layout shows from frontmatter) is edited one text node at a time: the bridge sends `textCommit`, and `src/main/deck/text.ts` finds where that text comes from in the slide's content, its frontmatter or the headmatter. When the place is not certain it changes nothing and says so.
- **Presenting.** Slidev's own views are used as they are: the audience window shows `/<n>`, the presenter window `/presenter/<n>`. Podium only places them on the right displays. The editor window hides while a presentation runs and returns when it ends (Escape, closing a window, or the menu). The phone remote is Slidev's remote mode behind a connection filter (Tailscale or LAN) in the launcher.
- **Updates.** `src/main/update/`. Releases are built by `.github/workflows/release.yml` on a `v*` tag and carry electron-builder's feed files (`latest*.yml`). Windows and the AppImage update through electron-updater. macOS builds have no Apple Developer ID, which Electron's updater needs, so there the app loads the zip itself, checks it against the feed's checksum and the bundle's signature and version, and a small shell script swaps the bundle after the app has quit. A `.deb` only gets a note with a link. Checks are silent, never run during a presentation, and an update installs on quit.
- **Agents.** Slidev 53 serves an MCP endpoint at `<server>/__mcp`. Decks carry an `AGENTS.md`.

## Slidev 53 facts worth knowing

- `@slidev/cli` exports `resolveOptions`, `createServer(options, viteConfig, serverOptions)`, `parser`. Inline `viteConfig.slidev.markdown.markdownSetup` reaches markdown-it.
- Slidev treats itself as globally installed when `process.argv[1]` lies outside the deck folder. Then it resolves themes/addons from the node_modules next to the CLI. The launcher relies on this.
- With a missing theme and no TTY, Slidev prints an error and exits 1. Install packages before starting a server.
- Dev server routes: `/<n>` play, `/presenter/<n>`, `/overview`, `/print`, `/export`, `/notes`. `?embedded` hides chrome. `window.__slidev__` holds the client context (`nav` etc.) in dev.
- `GET/POST /__slidev/slides/<n>.json` reads/patches a slide. `/__mcp` is the MCP endpoint.
- index.html is served from memory, Vite HTML transforms do not run on it.
- Theme names: `default` → `@slidev/theme-default`, `x` → `@slidev/theme-x` or `slidev-theme-x`. Addons: `slidev-addon-x`.
- Base layouts ship in `@slidev/client/layouts/*.vue`. Themes add or override in `<theme>/layouts`.

## Running things

```
npx vitest run tests/unit/<folder>          unit tests
npx electron-vite build                      build everything into out/
xvfb-run -a -s "-screen 0 1600x1000x24" node_modules/electron/dist/electron --no-sandbox --disable-gpu .
sleep 600 | node launcher/launcher.mjs --runtime .dev-runtime --entry tests/fixtures/basic/slides.md --port 3500 --bridge launcher/bridge-client.js
```

The launcher exits when its stdin closes, so keep stdin open as shown. It prints `@@podium {"event":"ready",...}` when up. Stop a test server with `fuser -k <port>/tcp`. Do not use `pkill -f` with a pattern that also appears in your own command line, it kills your shell.

There is no display on the dev machine. Electron needs `xvfb-run` plus `--no-sandbox --disable-gpu`. Playwright's Chromium is installed.

Environment variables: `PODIUM_RUNTIME_DIR`, `PODIUM_USER_DATA` (throwaway profile for tests).

## Conventions

- UI text is German first, English second, in plain everyday words. No developer jargon in the UI: say "Vorlage", not "Theme"; "Folie", not "Slide".
- Code, comments and identifiers are English. Comments explain why, not what.
- No new dependencies without need. Everything in `package.json` is already installed.
- The contract files (`src/shared/*`, `src/main/contracts.ts`) change only on purpose, because every module depends on them.
