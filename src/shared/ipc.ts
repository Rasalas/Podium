/**
 * The API the renderer calls in the main process, and the events main pushes back.
 * Only the integrator edits this file.
 *
 * Renderer usage: `window.podium.<method>(...)` and `window.podium.on('deck:changed', cb)`.
 */
import type {
  AgentEvent,
  AddedTemplate,
  AgentInfo,
  AppInfo,
  DeckOp,
  DeckOpenResult,
  DeckSnapshot,
  DisplayInfo,
  ExportFormat,
  ExportResult,
  InstalledPackage,
  LayoutInfo,
  NewDeckOptions,
  OpResult,
  PackageRequest,
  PresentationState,
  PresentOptions,
  ProgressEvent,
  RecentDeck,
  RemoteInfo,
  RemoteMode,
  RuntimeStatus,
  ServerStatus,
  Settings,
  SlideCheck,
  TemplateInfo,
  ThumbnailEvent,
  UpdateState,
} from './types'

export interface PodiumApi {
  // --- app -----------------------------------------------------------------
  getAppInfo: () => Promise<AppInfo>
  getSettings: () => Promise<Settings>
  setSettings: (patch: Partial<Settings>) => Promise<Settings>
  getRecentDecks: () => Promise<RecentDeck[]>
  removeRecentDeck: (path: string) => Promise<RecentDeck[]>
  /** Native folder picker. Returns undefined when cancelled. */
  pickFolder: (title: string, defaultPath?: string) => Promise<string | undefined>
  openExternal: (url: string) => Promise<void>
  showInFolder: (path: string) => Promise<void>

  // --- app updates ---------------------------------------------------------
  getUpdateState: () => Promise<UpdateState>
  /** Look for a new version now and load it. Changes arrive as 'update:state' events. */
  checkForUpdates: () => Promise<UpdateState>
  /** Quit, install the loaded update and start again. Does nothing unless the state is 'ready'. */
  installUpdate: () => Promise<void>

  // --- runtime and packages ------------------------------------------------
  getRuntimeStatus: () => Promise<RuntimeStatus>
  /** Installs the shared Slidev runtime if needed. Progress arrives as 'progress' events, scope 'runtime'. */
  ensureRuntime: () => Promise<RuntimeStatus>
  listInstalledPackages: () => Promise<InstalledPackage[]>
  /** Resolve a theme/addon name typed by the user into a package request. */
  resolvePackage: (raw: string, kind: 'theme' | 'addon') => Promise<PackageRequest>
  /** Install npm packages into the shared runtime. Progress scope 'packages'. */
  installPackages: (names: string[]) => Promise<void>

  // --- templates -----------------------------------------------------------
  listTemplates: () => Promise<TemplateInfo[]>
  /**
   * Add a template from a git address, a link to a zip file or a folder. `subdir` names the
   * theme's folder inside the source when it is not the root. The template stays available
   * for every new presentation. A template is program code: ask the user before calling this.
   */
  addTemplate: (source: string, subdir?: string) => Promise<AddedTemplate>
  listAddedTemplates: () => Promise<AddedTemplate[]>
  /** Fetch a template the user added again from where it came from. */
  refreshTemplate: (name: string) => Promise<AddedTemplate>
  removeTemplate: (name: string) => Promise<void>
  /** Layouts available to this deck (Slidev base + theme + addons + deck-local). */
  getLayouts: (deckId: string) => Promise<LayoutInfo[]>

  // --- deck lifecycle ------------------------------------------------------
  newDeck: (options: NewDeckOptions) => Promise<DeckOpenResult>
  /** Native open dialog for a deck folder, a slides.md or a .podium file. */
  openDeckDialog: () => Promise<DeckOpenResult | undefined>
  openDeck: (path: string) => Promise<DeckOpenResult>
  closeDeck: (deckId: string) => Promise<void>
  getDeck: (deckId: string) => Promise<DeckSnapshot>

  // --- editing -------------------------------------------------------------
  applyOp: (deckId: string, op: DeckOp) => Promise<OpResult>
  undo: (deckId: string) => Promise<OpResult>
  redo: (deckId: string) => Promise<OpResult>
  /**
   * Copy an image into the deck's public/images folder and return its URL ("/images/x.png").
   * Opens a file picker when `sourcePath` is omitted. Undefined when cancelled.
   */
  importImage: (deckId: string, sourcePath?: string) => Promise<string | undefined>
  /** Same, for pasted or dropped image data. */
  importImageData: (deckId: string, fileName: string, data: Uint8Array) => Promise<string>

  // --- slidev server -------------------------------------------------------
  startServer: (deckId: string) => Promise<ServerStatus>
  restartServer: (deckId: string) => Promise<ServerStatus>
  getServerStatus: (deckId: string) => Promise<ServerStatus>

  // --- thumbnails and checks -----------------------------------------------
  /** Render thumbnails. Results arrive as 'thumbnail' events. Omit `nos` for all stale slides. */
  requestThumbnails: (deckId: string, nos?: number[]) => Promise<void>
  /** Render every slide and report content that sticks out. */
  checkDeck: (deckId: string) => Promise<SlideCheck[]>

  // --- presenting ----------------------------------------------------------
  getDisplays: () => Promise<DisplayInfo[]>
  startPresentation: (deckId: string, options: PresentOptions) => Promise<PresentationState>
  swapPresentationDisplays: () => Promise<PresentationState>
  stopPresentation: () => Promise<PresentationState>
  getPresentationState: () => Promise<PresentationState>

  // --- phone remote --------------------------------------------------------
  /** Addresses this computer can be reached at, and the link while the remote is on. */
  getRemoteInfo: (deckId: string) => Promise<RemoteInfo>
  /**
   * Switch the phone remote (Slidev's remote mode) for a deck. Restarts the deck's preview server
   * (a few seconds); a running presentation comes back on the slide it was on. A new password,
   * and so a new link, every time it is switched on.
   */
  setRemote: (deckId: string, mode: RemoteMode) => Promise<RemoteInfo>

  // --- export --------------------------------------------------------------
  exportDeck: (deckId: string, format: ExportFormat) => Promise<ExportResult>

  // --- agents --------------------------------------------------------------
  getAgentInfo: (deckId: string) => Promise<AgentInfo>
  /** (Re)write AGENTS.md for the deck from its template. */
  writeAgentsFile: (deckId: string) => Promise<void>
  /** Run the configured agent CLI in the deck folder. Output arrives as 'agent' events. */
  agentSend: (deckId: string, prompt: string) => Promise<void>
  agentStop: (deckId: string) => Promise<void>
}

export interface PodiumEvents {
  'progress': ProgressEvent
  'deck:changed': DeckSnapshot
  'server:status': ServerStatus
  'thumbnail': ThumbnailEvent
  'present:state': PresentationState
  'update:state': UpdateState
  'agent': AgentEvent
  /** Menu or OS asked to open a deck (file association, second instance, menu item). */
  'open-request': { path: string }
  /** Application menu commands forwarded to the renderer. */
  'menu': { command: MenuCommand }
}

export type MenuCommand =
  | 'new-deck' | 'open-deck' | 'close-deck'
  | 'undo' | 'redo'
  | 'new-slide' | 'duplicate-slide' | 'delete-slide'
  | 'present' | 'present-from-current' | 'stop-presentation' | 'swap-displays'
  | 'toggle-source' | 'toggle-notes' | 'toggle-agent'
  | 'export-pdf' | 'export-bundle' | 'check-deck' | 'settings'

export type PodiumApiMethod = keyof PodiumApi

/** What preload exposes as `window.podium`. */
export type PodiumBridge = PodiumApi & {
  on: <K extends keyof PodiumEvents>(event: K, listener: (payload: PodiumEvents[K]) => void) => () => void
  /** Absolute path for a File from drag and drop. */
  pathForFile: (file: File) => string
}

export const IPC_INVOKE_CHANNEL = 'podium:invoke'
export const IPC_EVENT_CHANNEL = 'podium:event'

/** Kept in one place so preload can build the bridge without importing main code. */
export const API_METHODS: PodiumApiMethod[] = [
  'getAppInfo', 'getSettings', 'setSettings', 'getRecentDecks', 'removeRecentDeck',
  'pickFolder', 'openExternal', 'showInFolder',
  'getUpdateState', 'checkForUpdates', 'installUpdate',
  'getRuntimeStatus', 'ensureRuntime', 'listInstalledPackages', 'resolvePackage', 'installPackages',
  'listTemplates', 'getLayouts', 'addTemplate', 'listAddedTemplates', 'refreshTemplate', 'removeTemplate',
  'newDeck', 'openDeckDialog', 'openDeck', 'closeDeck', 'getDeck',
  'applyOp', 'undo', 'redo', 'importImage', 'importImageData',
  'startServer', 'restartServer', 'getServerStatus',
  'requestThumbnails', 'checkDeck',
  'getDisplays', 'startPresentation', 'swapPresentationDisplays', 'stopPresentation', 'getPresentationState',
  'getRemoteInfo', 'setRemote',
  'exportDeck',
  'getAgentInfo', 'writeAgentsFile', 'agentSend', 'agentStop',
]
