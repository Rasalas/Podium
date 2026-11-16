/**
 * Domain types shared by main, preload and renderer.
 * This file is the contract between the modules. Only the integrator edits it.
 */

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export type Locale = 'de' | 'en'

export interface AppInfo {
  version: string
  /** Node's process.platform: 'linux', 'darwin', 'win32' ... */
  platform: string
  locale: Locale
  userDataDir: string
  /** Folder where "new deck" proposes to save, e.g. ~/Documents/Podium */
  defaultDeckDir: string
}

export interface RecentDeck {
  /** Deck folder, or the .podium bundle file if opened from one. */
  path: string
  title: string
  theme: string
  lastOpened: number
  /** PNG data URL of slide 1, if we have one cached. */
  thumbnail?: string
  /** False when the path no longer exists. */
  exists: boolean
}

export interface Settings {
  locale: Locale | 'system'
  /** Command used for the built-in agent panel. `{prompt}` is replaced. */
  agentPreset: 'claude' | 'codex' | 'custom'
  agentCommand: string
  /** Display id to put the audience window on. undefined = pick automatically. */
  audienceDisplayId?: number
  /** Install packages from the trusted list without asking. */
  autoInstallTrusted: boolean
  /** Look for new versions of the app, load them in the background and install them when the app quits. */
  autoUpdate: boolean
}

/** Where the app stands with its own updates. */
export interface UpdateState {
  /**
   * off: this build does not update (development). idle: nothing to do. ready: loaded, installs when
   * the app quits. available: there is a new version, but this installation cannot replace itself
   * (a system package, an app run from the disk image); `downloadUrl` is the installer to fetch.
   */
  status: 'off' | 'idle' | 'checking' | 'downloading' | 'ready' | 'available' | 'error'
  currentVersion: string
  /** The newer version, once one was found. */
  version?: string
  /** 0 to 1 while downloading. */
  progress?: number
  downloadUrl?: string
  /** Release notes of `version`. */
  releaseUrl?: string
  error?: string
  /** Epoch ms of the last completed check. */
  lastChecked?: number
}

// ---------------------------------------------------------------------------
// Runtime (the shared Slidev installation) and packages
// ---------------------------------------------------------------------------

export interface RuntimeStatus {
  state: 'missing' | 'installing' | 'ready' | 'error'
  dir: string
  slidevVersion?: string
  error?: string
}

export interface ProgressEvent {
  /** What the progress belongs to, e.g. 'runtime', 'packages', 'export'. */
  scope: string
  message: string
  /** 0..1, undefined when indeterminate. */
  fraction?: number
  done?: boolean
  error?: string
}

export type PackageKind = 'theme' | 'addon' | 'icons' | 'other'

export interface PackageRequest {
  /** Name as written in the deck, e.g. "seriph". */
  raw: string
  /** Resolved npm package name, e.g. "@slidev/theme-seriph". */
  name: string
  kind: PackageKind
  /** On the built-in allowlist. Trusted packages may install without a prompt. */
  trusted: boolean
  installed: boolean
}

export interface InstalledPackage {
  name: string
  version: string
  kind: PackageKind
  builtin: boolean
  dir: string
}

// ---------------------------------------------------------------------------
// Templates and layouts
// ---------------------------------------------------------------------------

export interface TemplateInfo {
  /** Value for the `theme:` headmatter key, e.g. "klar" or "seriph". */
  id: string
  /** npm package name. */
  packageName: string
  label: string
  description: string
  builtin: boolean
  installed: boolean
  /** Accent colours for the picker tile, purely cosmetic. */
  colors?: { background: string, foreground: string, accent: string }
  /** PNG data URL or undefined. */
  preview?: string
  /** The user added this template themselves (from an address or a folder). */
  added?: boolean
}

/** A template the user added, with where it came from. */
export interface AddedTemplate {
  /** npm package name of the theme. */
  name: string
  label: string
  version: string
  /** Address or folder it was fetched from, for display. */
  source: string
  /** Epoch ms of the last fetch. */
  fetchedAt: number
}

export type FieldType = 'text' | 'longtext' | 'image' | 'color' | 'boolean' | 'select' | 'number' | 'url'

export interface LayoutField {
  /** Frontmatter key. */
  key: string
  type: FieldType
  label: string
  description?: string
  options?: { value: string, label: string }[]
  default?: unknown
}

export interface LayoutSlot {
  /** "default" or a named slot such as "right". */
  name: string
  label: string
}

export interface LayoutInfo {
  /** Value for the `layout:` frontmatter key. */
  name: string
  label: string
  description: string
  /** Where the layout comes from. */
  origin: 'slidev' | 'theme' | 'addon' | 'deck'
  slots: LayoutSlot[]
  fields: LayoutField[]
  /** Schematic shape used to draw the picker tile. */
  sketch: LayoutSketch
  /** Markdown put into a new slide with this layout. May contain `::slot::` markers. */
  starter: string
  /** Rough grouping for the picker. */
  category: 'title' | 'content' | 'media' | 'emphasis' | 'special'
  /** Hidden from the picker (404, error, none ...), still valid in files. */
  hidden?: boolean
}

export type LayoutSketch =
  | 'cover' | 'title-body' | 'center' | 'two-cols' | 'two-cols-header'
  | 'image-left' | 'image-right' | 'image-full' | 'section' | 'quote'
  | 'fact' | 'statement' | 'end' | 'iframe' | 'blank' | 'generic'

// ---------------------------------------------------------------------------
// Deck model
// ---------------------------------------------------------------------------

export interface SlotContent {
  name: string
  content: string
}

/**
 * How much of a slide the visual editor can handle.
 * - simple: only markdown blocks the canvas can edit in place
 * - mixed: some editable blocks plus HTML/Vue/code the canvas leaves alone
 * - code: nothing editable in place (pure HTML/Vue), edit via source or agent
 */
export type Editability = 'simple' | 'mixed' | 'code'

export interface SlideSnapshot {
  /** 1-based position in the rendered deck. */
  no: number
  /** Key for UI lists. Stable across edits and moves of the slide. */
  id: string
  title: string
  /** Effective layout name (Slidev defaults: slide 1 "cover", others "default"). */
  layout: string
  /** Slide-level frontmatter only. Deck-level keys live in DeckSnapshot.headmatter. */
  frontmatter: Record<string, unknown>
  /** Raw YAML of the slide-level frontmatter. */
  frontmatterRaw: string
  /** Markdown body without frontmatter and without the trailing note comment. */
  content: string
  note: string
  slots: SlotContent[]
  /** Absolute path of the markdown file this slide lives in. */
  filepath: string
  /** True when the slide comes from a `src:` import rather than the entry file. */
  imported: boolean
  /** Hash of everything that affects rendering. Thumbnail cache key. */
  revision: string
  editability: Editability
}

export interface DeckSnapshot {
  deckId: string
  /** Deck folder (for bundles: the unpacked working copy). */
  dir: string
  /** Absolute path of the entry markdown file. */
  entry: string
  /** Set when the deck was opened from a single-file .podium bundle. */
  bundlePath?: string
  title: string
  /** Deck-level configuration from the first frontmatter block. */
  headmatter: Record<string, unknown>
  theme: string
  addons: string[]
  /** Slide canvas size in px, derived from aspectRatio / canvasWidth. */
  canvas: { width: number, height: number }
  slides: SlideSnapshot[]
  canUndo: boolean
  canRedo: boolean
  /** Increments with every change. */
  revision: number
  /** What produced this snapshot. 'external' = file changed on disk (agent, editor, git). */
  cause: 'load' | 'app' | 'external' | 'undo' | 'redo'
}

/**
 * Identifies one markdown block on the canvas.
 * The canvas only knows the rendered DOM, so the match is by tag and text,
 * with counters to break ties.
 */
export interface BlockRef {
  /** Lower-case tag of the rendered block: h1..h6, p, li. */
  tag: string
  /** Rendered plain text before the edit, whitespace collapsed. */
  text: string
  /** Index among blocks of this slide with the same tag and text. */
  occurrence: number
  /** Index among blocks of this slide with the same tag. Fallback when text does not match. */
  tagIndex: number
}

/**
 * A change to text on the canvas that is not an editable markdown block: HTML in the slide, a
 * heading with an icon, text a layout shows from the slide's settings. The canvas knows one
 * rendered text node; the deck model finds where it comes from.
 */
export interface TextEdit {
  /** The text node as rendered before and after the edit. */
  before: string
  after: string
  /** The markdown block around the text, when there is one (a heading with an icon in it). */
  block?: BlockRef
  /** Index among text nodes with the same text: within `block`, or else outside all markdown blocks of the slide. */
  occurrence: number
  /** How many such text nodes there are. */
  total: number
}

export type BlockKind = 'heading' | 'text' | 'list' | 'numbered-list' | 'image' | 'code' | 'table' | 'quote'

export type DeckOp =
  | {
    type: 'updateSlide'
    no: number
    content?: string
    /** Patch for slide-level keys. `null` removes a key. */
    frontmatter?: Record<string, unknown>
    /** Replaces the whole slide-level frontmatter. Wins over `frontmatter`. */
    frontmatterRaw?: string
    note?: string
  }
  | { type: 'setSlot', no: number, slot: string, content: string }
  | { type: 'setLayout', no: number, layout: string }
  | {
    type: 'insertSlide'
    /** Insert after this slide number. 0 inserts at the start. */
    after: number
    layout?: string
    content?: string
    frontmatter?: Record<string, unknown>
    note?: string
  }
  | { type: 'duplicateSlide', no: number }
  | { type: 'removeSlides', nos: number[] }
  /** Move slide `from` so that it ends up at position `to` (both 1-based). */
  | { type: 'moveSlide', from: number, to: number }
  /** In-place text edit from the canvas. `markdown` is inline markdown. */
  | { type: 'editBlock', no: number, block: BlockRef, markdown: string }
  /** Commit a list item and add a new empty item after it. */
  | { type: 'splitListItem', no: number, block: BlockRef, markdown: string, newItem: string }
  | { type: 'removeBlock', no: number, block: BlockRef }
  | {
    type: 'insertBlock'
    no: number
    kind: BlockKind
    /** Slot to append to, default slot when omitted. */
    slot?: string
    /** Insert after this block instead of appending. */
    after?: BlockRef
    /** For kind 'image': deck-relative URL such as "/images/foto.png". */
    src?: string
    /** Initial text. */
    text?: string
  }
  /** In-place edit of text that is not an editable markdown block. Fails without changing anything when the place in the file is unclear. */
  | { type: 'editText', no: number, edit: TextEdit }
  /** Patch deck-level keys (theme, title, aspectRatio ...). `null` removes a key. */
  | { type: 'setHeadmatter', patch: Record<string, unknown> }

export interface OpResult {
  snapshot: DeckSnapshot
  /** Slide to select after the operation, if it changed. */
  select?: number
  /** Block to put the cursor into after the canvas re-rendered. */
  focusBlock?: BlockRef
}

export interface DeckOpenResult {
  snapshot: DeckSnapshot
  /** Packages the deck needs that are not installed yet. Empty = ready to start. */
  missingPackages: PackageRequest[]
}

export interface NewDeckOptions {
  title: string
  /** Template id, see TemplateInfo.id. */
  template: string
  /** Parent folder. The deck folder is created inside it. */
  parentDir: string
  /** Folder name, derived from the title when omitted. */
  folderName?: string
}

// ---------------------------------------------------------------------------
// Slidev dev server
// ---------------------------------------------------------------------------

export interface ServerStatus {
  deckId: string
  state: 'stopped' | 'starting' | 'ready' | 'restarting' | 'error'
  /** e.g. http://localhost:3412 (no trailing slash). Set when ready. */
  url?: string
  port?: number
  /** URL of Slidev's MCP endpoint for agents. */
  mcpUrl?: string
  error?: string
  /** Last lines of server output, for the error view. */
  log?: string[]
}

// ---------------------------------------------------------------------------
// Thumbnails and checks
// ---------------------------------------------------------------------------

export interface ThumbnailEvent {
  deckId: string
  no: number
  /** SlideSnapshot.revision the image belongs to. */
  revision: string
  dataUrl: string
}

export interface SlideCheck {
  no: number
  /** Content sticks out of the slide. */
  overflow: boolean
  /** How far, in slide px. */
  overflowX: number
  overflowY: number
  /** Human readable findings, already localised. */
  messages: string[]
}

// ---------------------------------------------------------------------------
// Presenting
// ---------------------------------------------------------------------------

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
  internal: boolean
  bounds: { x: number, y: number, width: number, height: number }
}

export interface PresentOptions {
  /** Slide to start on. */
  from: number
  /** Display for the audience window. Omit to pick the first external display. */
  audienceDisplayId?: number
  /** Open Slidev's presenter page (notes, next slide, timer). Default: true when two displays exist. */
  presenterView?: boolean
  /**
   * Audience slides in a normal window instead of fullscreen, for sharing in video calls
   * (Zoom, Teams ...). The presenter view always opens beside it.
   */
  windowed?: boolean
}

export interface PresentationState {
  active: boolean
  deckId?: string
  audienceDisplayId?: number
  presenterDisplayId?: number
  displays: DisplayInfo[]
  /** Where the audience window is right now. Set while active. */
  position?: PresentPosition
  /** Epoch ms when the presentation started. */
  startedAt?: number
  /** Started with `windowed`: the audience slides are in a normal window. */
  windowed?: boolean
}

export interface PresentPosition {
  /** Current slide, 1-based. */
  no: number
  /** Click step within the slide (v-click), 0-based. */
  clicks: number
  /** Number of click steps the slide has. */
  clicksTotal: number
  /** Number of slides. */
  total: number
}

// ---------------------------------------------------------------------------
// Phone remote
// ---------------------------------------------------------------------------

/** Who may reach the phone remote: nobody, devices in the own tailnet, or the local network too. */
export type RemoteMode = 'off' | 'tailscale' | 'lan'

export interface RemoteInfo {
  mode: RemoteMode
  /** This computer's Tailscale IPv4 address, when Tailscale is running. */
  tailscaleAddress?: string
  /** Private IPv4 addresses in the local network, best guess first. */
  lanAddresses: string[]
  /** Slidev's presenter page for the phone, with the password. Set while the remote is on. */
  url?: string
  /** `url` as a QR code, an SVG document string. */
  qrSvg?: string
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = 'pdf' | 'png' | 'pptx' | 'web' | 'bundle'

export interface ExportResult {
  /** File or folder written. Undefined when the user cancelled. */
  path?: string
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface AgentInfo {
  /** Is the configured agent CLI on PATH. */
  available: boolean
  preset: Settings['agentPreset']
  command: string
  /** MCP endpoint of the running deck server. */
  mcpUrl?: string
  /** Ready-to-paste command that registers the MCP endpoint with the agent. */
  mcpSetupCommand?: string
  /** The deck contains an AGENTS.md. */
  hasAgentsFile: boolean
}

export type AgentEvent =
  | { deckId: string, type: 'started', prompt: string }
  | { deckId: string, type: 'text', text: string }
  | { deckId: string, type: 'tool', name: string, detail: string }
  | { deckId: string, type: 'error', message: string }
  | { deckId: string, type: 'done', ok: boolean }
