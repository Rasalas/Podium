/**
 * Interfaces of the main-process modules. Each module lives in its own folder and
 * exports the factory named here from its index.ts. `src/main/index.ts` wires them.
 *
 * Only the integrator edits this file. Modules may import types from here and
 * from src/shared, and must not import each other's internals.
 */
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type {
  AgentEvent,
  AgentInfo,
  DeckOp,
  DeckSnapshot,
  DisplayInfo,
  ExportFormat,
  ExportResult,
  InstalledPackage,
  LayoutInfo,
  Locale,
  NewDeckOptions,
  OpResult,
  PackageRequest,
  PresentationState,
  PresentOptions,
  PresentPosition,
  ProgressEvent,
  RuntimeStatus,
  ServerStatus,
  Settings,
  SlideCheck,
  TemplateInfo,
  ThumbnailEvent,
} from '../shared/types'

export type ProgressSink = (event: ProgressEvent) => void

// ---------------------------------------------------------------------------
// runtime/  — the shared Slidev installation and its packages
// export function createRuntimeManager(options: RuntimeOptions): RuntimeManager
// ---------------------------------------------------------------------------

export interface RuntimeOptions {
  /** Where the runtime lives, e.g. <userData>/runtime. Overridable with PODIUM_RUNTIME_DIR. */
  runtimeDir: string
  /** App resources: contains launcher/ and templates/ (repo root in dev, process.resourcesPath when packaged). */
  resourcesDir: string
  /** Optional pre-installed runtime shipped with the app (resources/runtime-seed), copied instead of downloading. */
  seedDir?: string
  /** Templates the user added (<userData>/templates). They are installed into the runtime like the shipped ones. */
  userTemplatesDir?: string
  onProgress: ProgressSink
}

export interface RuntimeManager {
  readonly runtimeDir: string
  /** Absolute path of the launcher script inside the runtime dir (copied there by ensure()). */
  readonly launcherPath: string
  status: () => Promise<RuntimeStatus>
  /** Install or repair the base runtime: Slidev CLI, built-in themes, launcher. Idempotent. */
  ensure: () => Promise<RuntimeStatus>
  /** Map a theme/addon name as written in a deck to an npm package and say whether it is installed and trusted. */
  resolve: (raw: string, kind: 'theme' | 'addon', deckDir?: string) => Promise<PackageRequest>
  /** Everything a deck needs. Path-style themes ("./theme") are skipped. */
  requirementsFor: (deck: { dir: string, theme: string, addons: string[] }) => Promise<PackageRequest[]>
  /** npm install into the runtime, scripts disabled. Rejects with a readable message on failure. */
  install: (names: string[]) => Promise<void>
  listInstalled: () => Promise<InstalledPackage[]>
  /** Bring the templates from the user's store into the runtime and install what they depend on. */
  syncUserTemplates: () => Promise<void>
  /** Take a template the user added out of the runtime again. */
  removeTemplate: (name: string) => Promise<void>
  /** Root folder of a package: in the deck's own workspace when `deckDir` is given, else installed in the runtime. */
  packageDir: (name: string, deckDir?: string) => string | undefined
  /** Run a script with the app's bundled Node (Electron in node mode). */
  spawnNode: (args: string[], options?: SpawnOptions) => ChildProcess
}

// ---------------------------------------------------------------------------
// server/  — one Slidev dev server per open deck
// export function createSlidevServer(options: SlidevServerOptions): SlidevServer
// ---------------------------------------------------------------------------

export interface SlidevServerOptions {
  deckId: string
  /** Absolute path of the entry markdown file. */
  entry: string
  runtime: RuntimeManager
  /** Absolute path of launcher/bridge-client.js. */
  bridgeClientPath: string
  onStatus: (status: ServerStatus) => void
  /** Port range to pick from, default 3400–3999. */
  portRange?: [number, number]
  startTimeoutMs?: number
}

/** Phone remote settings for the launcher: Slidev's remote mode plus a network filter. */
export interface RemoteConfig {
  /** Slidev asks for it (`?password=`) on its presenter, overview and export pages. */
  password: string
  /** 'tailscale': loopback and Tailscale addresses may connect. 'lan': private networks too. */
  allow: 'tailscale' | 'lan'
}

export interface SlidevServer {
  status: () => ServerStatus
  /** Resolves when the server answers HTTP, rejects with the log tail when it dies first. */
  start: () => Promise<ServerStatus>
  restart: () => Promise<ServerStatus>
  stop: () => Promise<void>
  /**
   * Switch the phone remote on (config) or off (undefined). Restarts a running server on the
   * same port if it is free; a stopped server only remembers it for its next start.
   */
  setRemote: (config: RemoteConfig | undefined) => Promise<ServerStatus>
  remote: () => RemoteConfig | undefined
}

// ---------------------------------------------------------------------------
// deck/  — the document model: load, edit, save, watch, undo
// export async function openDeck(path: string, options: DeckOptions): Promise<DeckSession>
// export async function createDeck(options: NewDeckOptions, starter: DeckStarter, deckOptions: DeckOptions): Promise<DeckSession>
// ---------------------------------------------------------------------------

export interface DeckOptions {
  /** Folder for working copies of .podium bundles, e.g. <userData>/bundles. */
  workDir: string
  /** Called after every change, including changes made on disk by someone else. */
  onChange: (snapshot: DeckSnapshot) => void
}

/** Files a new deck starts with, produced by the template registry. */
export interface DeckStarter {
  /** Content of slides.md. */
  slides: string
  /** Extra files, deck-relative path → content (AGENTS.md, .gitignore ...). */
  files: Record<string, string>
}

export interface DeckSession {
  readonly deckId: string
  snapshot: () => DeckSnapshot
  apply: (op: DeckOp) => Promise<OpResult>
  undo: () => Promise<OpResult>
  redo: () => Promise<OpResult>
  /** Copy a file into public/images and return its URL, e.g. "/images/foto.png". */
  importAsset: (sourcePath: string) => Promise<string>
  importAssetData: (fileName: string, data: Uint8Array) => Promise<string>
  /** Write a deck-relative text file (used for AGENTS.md). */
  writeFile: (relativePath: string, content: string) => Promise<void>
  /** Pack the deck folder into a single .podium file. */
  exportBundle: (targetPath: string) => Promise<void>
  /** Flush pending writes, repack the bundle if opened from one, stop watching. */
  close: () => Promise<void>
}

// ---------------------------------------------------------------------------
// templates/  — templates (themes) and their layouts
// export function createTemplateRegistry(options: TemplateRegistryOptions): TemplateRegistry
// ---------------------------------------------------------------------------

export interface TemplateRegistryOptions {
  runtime: RuntimeManager
  resourcesDir: string
  locale: () => Locale
}

export interface TemplateRegistry {
  list: () => Promise<TemplateInfo[]>
  /** Layouts for a deck: Slidev base layouts, then theme, addons and deck-local layouts overriding by name. */
  layoutsFor: (deck: { dir: string, theme: string, addons: string[] }) => Promise<LayoutInfo[]>
  /** Starter content for a new deck with this template. */
  starter: (options: NewDeckOptions) => Promise<DeckStarter>
  /** AGENTS.md text for a deck: structure, rules, the layouts it can use. */
  agentsFile: (deck: { dir: string, theme: string, addons: string[], title: string }) => Promise<string>
}

// ---------------------------------------------------------------------------
// thumbs/  — slide thumbnails and overflow checks via a hidden window
// export function createThumbnailer(options: ThumbnailerOptions): Thumbnailer
// ---------------------------------------------------------------------------

export interface ThumbnailerOptions {
  onThumbnail: (event: ThumbnailEvent) => void
}

export interface Thumbnailer {
  /**
   * Render the given slides (default: all whose revision changed since the last render).
   * Calls for the same deck are coalesced. Newer requests supersede queued ones.
   */
  request: (deck: DeckSnapshot, serverUrl: string, nos?: number[]) => Promise<void>
  /** Render every slide and measure overflow. */
  check: (deck: DeckSnapshot, serverUrl: string, locale: Locale) => Promise<SlideCheck[]>
  /** Cached thumbnail of slide 1 for the recent list. */
  cover: (deckId: string) => string | undefined
  /** Drop the hidden window and cache of a deck. */
  release: (deckId: string) => void
}

// ---------------------------------------------------------------------------
// present/  — audience and presenter windows on the right displays
// export function createPresentationController(options: PresentationOptions): PresentationController
// ---------------------------------------------------------------------------

export interface PresentationOptions {
  onState: (state: PresentationState) => void
  locale: () => Locale
  /** Title and slide size of an open deck, for sizing and naming the windowed audience window. */
  deckInfo?: (deckId: string) => { title: string, canvas: { width: number, height: number } } | undefined
}

/**
 * The audience window shows Slidev's play page, the presenter window Slidev's own presenter
 * page. Slidev keeps both in sync over its server. `password` is the remote-mode password
 * when the phone remote is on: Slidev then asks for it on the presenter page.
 */
export interface PresentationController {
  displays: () => DisplayInfo[]
  state: () => PresentationState
  start: (deckId: string, serverUrl: string, options: PresentOptions, password?: string) => Promise<PresentationState>
  swapDisplays: () => Promise<PresentationState>
  /**
   * The deck's server restarted (possibly on a new address or password): load both windows
   * again at `at`, the position from before the restart (default: the last one seen). While the
   * server restarts the pages reload on their own and may report passing positions.
   */
  reload: (serverUrl: string, password?: string, at?: PresentPosition) => Promise<PresentationState>
  stop: () => Promise<PresentationState>
}

// ---------------------------------------------------------------------------
// export/  — PDF, PNG, PPTX, static web build
// export function createExporter(options: ExporterOptions): Exporter
// ---------------------------------------------------------------------------

export interface ExporterOptions {
  runtime: RuntimeManager
  onProgress: ProgressSink
}

export interface Exporter {
  /**
   * `targetPath` comes from a save dialog the caller already showed. `password`: the remote-mode
   * password while the phone remote is on, Slidev asks for it on its export page.
   */
  run: (deck: DeckSnapshot, serverUrl: string, format: Exclude<ExportFormat, 'bundle'>, targetPath: string, password?: string) => Promise<ExportResult>
}

// ---------------------------------------------------------------------------
// agent/  — run an agent CLI in the deck folder, describe the MCP endpoint
// export function createAgentService(options: AgentServiceOptions): AgentService
// ---------------------------------------------------------------------------

export interface AgentServiceOptions {
  settings: () => Settings
  onEvent: (event: AgentEvent) => void
}

export interface AgentService {
  info: (deck: DeckSnapshot, server: ServerStatus | undefined) => Promise<AgentInfo>
  send: (deck: DeckSnapshot, prompt: string) => Promise<void>
  stop: (deckId: string) => Promise<void>
}
