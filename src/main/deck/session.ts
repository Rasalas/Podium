/**
 * One open deck: owns the markdown files, applies DeckOps, keeps the undo history and
 * watches the files for changes made by someone else (agent, editor, git).
 *
 * The files on disk are the single source of truth. Every op edits the line model in
 * source.ts, writes the changed files and reloads everything through `@slidev/parser`'s
 * `load()`, so slide numbering, `src:` imports and hidden slides behave like in Slidev.
 */
import type { SlideInfo } from '@slidev/types'
import type { BlockRef, DeckOp, DeckSnapshot, OpResult, SlideSnapshot } from '../../shared/types'
import type { DeckOptions, DeckSession } from '../contracts'
import type { SourceFile, Unit } from './source'
import { readFile } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { load, type LoadedSlidevData, parseAspectRatio } from '@slidev/parser/fs'
import { type FSWatcher, watch } from 'chokidar'
import YAML from 'yaml'
import {
  editabilityOf,
  editBlockContent,
  insertBlockContent,
  refForLine,
  removeBlockContent,
  setSlotContent,
  slotsOf,
  splitListItemContent,
} from './blocks'
import { atomicWrite, insideDir, packDir, sanitizeFileName, shortHash, uniqueName } from './files'
import { isDeckKey } from './keys'
import { editTextInUnit } from './text'
import {
  docToRaw,
  frontmatterOf,
  hasDeckKeys,
  mergeHeadmatter,
  moveHeadmatter,
  newUnitId,
  parseSourceFile,
  parseYamlMap,
  patchUnitFrontmatter,
  serializeSourceFile,
  setUnitContent,
  setUnitDoc,
  setUnitNote,
  slideDoc,
  unitContent,
} from './source'

const HISTORY_LIMIT = 200
const WATCH_DEBOUNCE_MS = 120
const REPACK_DELAY_MS = 1000
const WATCH_IGNORED = new Set(['node_modules', '.git', '.slidev', 'dist', 'public'])

type Texts = Map<string, string>
type Cause = DeckSnapshot['cause']

interface OpOutcome {
  /** Unit whose rendered slide should be selected afterwards. */
  selectUnit?: Unit
  select?: number
  focus?: BlockRef
}

export interface SessionInit {
  deckId: string
  dir: string
  entry: string
  bundlePath?: string
  options: DeckOptions
}

function cloneTexts(texts: Texts): Texts {
  return new Map(texts)
}

function isBroken(data: LoadedSlidevData): boolean {
  return Object.values(data.markdownFiles).some(md => md.slides.some(s => (s.frontmatterDoc?.errors.length ?? 0) > 0))
}

/** Keep unit ids across re-parses: by position when the count matches, else by identical text. */
function carryIds(fresh: SourceFile, old: SourceFile | undefined): void {
  if (!old)
    return
  if (fresh.units.length === old.units.length) {
    fresh.units.forEach((u, i) => (u.id = old.units[i].id))
    return
  }
  const byText = new Map<string, string[]>()
  for (const u of old.units) {
    const key = (u.orig ?? []).join('\n')
    byText.set(key, [...(byText.get(key) ?? []), u.id])
  }
  for (const u of fresh.units) {
    const ids = byText.get((u.orig ?? []).join('\n'))
    if (ids?.length)
      u.id = ids.shift()!
  }
}

function newUnit(frontmatter: Record<string, unknown>, content: string, note: string | undefined): Unit {
  const unit: Unit = { id: newUnitId(), sep: [], body: [''], origPos: -1, wasLast: false, dirty: true }
  const clean = Object.fromEntries(Object.entries(frontmatter).filter(([, v]) => v !== null && v !== undefined))
  if (Object.keys(clean).length)
    unit.fm = { style: 'frontmatter', lines: [], doc: new YAML.Document(clean), dirty: true }
  setUnitContent(unit, content)
  if (note)
    setUnitNote(unit, note)
  return unit
}

function cloneUnit(unit: Unit): Unit {
  return {
    id: newUnitId(),
    sep: [...unit.sep],
    fm: unit.fm ? { ...unit.fm, lines: [...unit.fm.lines], doc: unit.fm.doc.clone() } : undefined,
    body: [...unit.body],
    origPos: -1,
    wasLast: false,
    dirty: true,
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter(v => typeof v === 'string')
  if (typeof value === 'string' && value.trim())
    return value.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

export class Session {
  readonly deckId: string
  readonly dir: string
  readonly entry: string
  readonly bundlePath?: string
  private readonly options: DeckOptions
  private files = new Map<string, SourceFile>()
  private texts: Texts = new Map()
  private data!: LoadedSlidevData
  private current!: DeckSnapshot
  private revision = 0
  private undoStack: Texts[] = []
  private redoStack: Texts[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private watcher?: FSWatcher
  private watchTimer?: NodeJS.Timeout
  private repackTimer?: NodeJS.Timeout
  private bundleDirty = false
  private closed = false

  constructor(init: SessionInit) {
    this.deckId = init.deckId
    this.dir = init.dir
    this.entry = init.entry
    this.bundlePath = init.bundlePath
    this.options = init.options
  }

  async init(): Promise<void> {
    const { data, texts } = await this.loadFrom(new Map())
    this.install(data, texts, 'load')
    await this.startWatching()
  }

  api(): DeckSession {
    return {
      deckId: this.deckId,
      snapshot: () => this.current,
      apply: op => this.run(() => this.apply(op)),
      undo: () => this.run(() => this.step('undo')),
      redo: () => this.run(() => this.step('redo')),
      importAsset: sourcePath => this.run(async () => this.storeAsset(basename(sourcePath), new Uint8Array(await readFile(sourcePath)))),
      importAssetData: (fileName, data) => this.run(() => this.storeAsset(fileName, data)),
      writeFile: (relativePath, content) => this.run(() => this.writeDeckFile(relativePath, content)),
      exportBundle: targetPath => this.run(() => packDir(this.dir, targetPath)),
      close: () => this.close(),
    }
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  /** Everything that reads or writes deck files runs one at a time. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => {})
    return next
  }

  private async loadFrom(texts: Texts): Promise<{ data: LoadedSlidevData, texts: Texts }> {
    const used = cloneTexts(texts)
    const data = await load({ roots: [this.dir], userRoot: this.dir, allowedRoots: [this.dir] }, this.entry, async (path: string) => {
      const known = used.get(path)
      if (known !== undefined)
        return known
      const text = await readFile(path, 'utf8')
      used.set(path, text)
      return text
    })
    const kept: Texts = new Map()
    for (const path of Object.keys(data.markdownFiles)) {
      if (used.has(path))
        kept.set(path, used.get(path)!)
    }
    return { data, texts: kept }
  }

  private install(data: LoadedSlidevData, texts: Texts, cause: Cause): void {
    this.data = data
    this.texts = texts
    this.resetFiles()
    this.revision++
    this.current = this.buildSnapshot(cause)
  }

  /** Re-parse the line model from the known texts, keeping unit ids. */
  private resetFiles(): void {
    const files = new Map<string, SourceFile>()
    for (const [path, text] of this.texts) {
      const fresh = parseSourceFile(path, text)
      carryIds(fresh, this.files.get(path))
      files.set(path, fresh)
    }
    this.files = files
  }

  private pushUndo(before: Texts): void {
    this.undoStack.push(before)
    if (this.undoStack.length > HISTORY_LIMIT)
      this.undoStack.shift()
    this.redoStack = []
  }

  private emit(): void {
    this.scheduleRepack()
    try {
      this.options.onChange(this.current)
    }
    catch (error) {
      console.error('[deck] onChange failed', error)
    }
  }

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  private buildSnapshot(cause: Cause): DeckSnapshot {
    const entryFile = this.files.get(this.data.entry.filepath)
    const firstUnit = entryFile?.units[0]
    const firstFm = firstUnit ? frontmatterOf(firstUnit) : {}
    const headmatter = Object.fromEntries(Object.entries(firstFm).filter(([key]) => isDeckKey(key)))
    const defaults = (headmatter.defaults && typeof headmatter.defaults === 'object' ? headmatter.defaults : {}) as Record<string, unknown>
    const seen = new Map<string, number>()

    const slides: SlideSnapshot[] = this.data.slides.map((info, i) => {
      const source = info.source
      const unit = this.files.get(source.filepath)?.units[source.index]
      const isHead = source.filepath === this.data.entry.filepath && source.index === 0
      let frontmatter: Record<string, unknown> = { ...source.frontmatter }
      let frontmatterRaw = (source.frontmatterRaw ?? '').replace(/\s+$/, '')
      if (isHead) {
        frontmatter = Object.fromEntries(Object.entries(frontmatter).filter(([key]) => !isDeckKey(key)))
        if (unit?.fm && hasDeckKeys(unit.fm.doc))
          frontmatterRaw = docToRaw(slideDoc(unit.fm.doc))
      }
      const rendered = info.frontmatter as Record<string, unknown>
      const explicit = typeof rendered.layout === 'string' ? rendered.layout : undefined
      const layout = explicit ?? (typeof defaults.layout === 'string' ? defaults.layout : undefined) ?? (i === 0 ? 'cover' : 'default')
      const content = info.content ?? ''
      let id = unit?.id ?? `${source.filepath}#${source.index}`
      const count = seen.get(id) ?? 0
      seen.set(id, count + 1)
      if (count)
        id = `${id}-${count + 1}`
      return {
        no: i + 1,
        id,
        title: info.title ?? '',
        layout,
        frontmatter,
        frontmatterRaw,
        content,
        note: info.note ?? '',
        slots: slotsOf(content),
        filepath: source.filepath,
        imported: !!info.importChain?.length,
        revision: shortHash(JSON.stringify([rendered, content, layout, headmatter])),
        editability: editabilityOf(content),
      }
    })

    let ratio = 16 / 9
    try {
      const parsed = parseAspectRatio((headmatter.aspectRatio as string | number | undefined) ?? 16 / 9)
      if (Number.isFinite(parsed) && parsed > 0)
        ratio = parsed
    }
    catch {}
    const width = Number(headmatter.canvasWidth) > 0 ? Number(headmatter.canvasWidth) : 980
    const title = typeof headmatter.title === 'string' && headmatter.title
      ? headmatter.title
      : this.data.slides[0]?.title || basename(this.bundlePath ?? this.dir).replace(/\.podium$/, '')

    return {
      deckId: this.deckId,
      dir: this.dir,
      entry: this.entry,
      ...(this.bundlePath ? { bundlePath: this.bundlePath } : {}),
      title,
      headmatter,
      theme: typeof headmatter.theme === 'string' && headmatter.theme ? headmatter.theme : 'default',
      addons: toStringArray(headmatter.addons),
      canvas: { width, height: Math.round(width / ratio) },
      slides,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      revision: this.revision,
      cause,
    }
  }

  // -------------------------------------------------------------------------
  // Ops
  // -------------------------------------------------------------------------

  private locate(no: number): { info: SlideInfo, file: SourceFile, unit: Unit, index: number, isHead: boolean } {
    const info = this.data.slides[no - 1]
    if (!Number.isInteger(no) || !info)
      throw new Error(`Folie ${no} gibt es nicht. Die Präsentation hat ${this.data.slides.length} Folien.`)
    const file = this.files.get(info.source.filepath)
    const unit = file?.units[info.source.index]
    if (!file || !unit)
      throw new Error(`Folie ${no} passt nicht mehr zur Datei. Bitte noch einmal versuchen.`)
    return { info, file, unit, index: info.source.index, isHead: info.source.filepath === this.data.entry.filepath && info.source.index === 0 }
  }

  private entryFile(): SourceFile {
    return this.files.get(this.data.entry.filepath)!
  }

  private editContent(no: number, edit: (content: string) => string): void {
    const { unit } = this.locate(no)
    setUnitContent(unit, edit(unitContent(unit)))
  }

  private mutate(op: DeckOp): OpOutcome {
    switch (op.type) {
      case 'updateSlide': {
        const { unit, isHead } = this.locate(op.no)
        if (op.frontmatterRaw !== undefined) {
          const doc = parseYamlMap(op.frontmatterRaw)
          const current = unit.fm ? (isHead ? docToRaw(slideDoc(unit.fm.doc)) : docToRaw(unit.fm.doc)) : ''
          if (op.frontmatterRaw.trim() !== current.trim()) {
            if (isHead && unit.fm && hasDeckKeys(unit.fm.doc))
              setUnitDoc(unit, mergeHeadmatter(unit.fm.doc, doc))
            else
              setUnitDoc(unit, doc)
          }
        }
        else if (op.frontmatter) {
          patchUnitFrontmatter(unit, op.frontmatter)
        }
        if (op.content !== undefined)
          setUnitContent(unit, op.content)
        if (op.note !== undefined)
          setUnitNote(unit, op.note)
        return {}
      }
      case 'setLayout': {
        const { unit } = this.locate(op.no)
        patchUnitFrontmatter(unit, { layout: op.layout })
        return {}
      }
      case 'setSlot':
        this.editContent(op.no, content => setSlotContent(content, op.slot, op.content))
        return {}
      case 'insertSlide': {
        const unit = newUnit({ ...(op.layout ? { layout: op.layout } : {}), ...op.frontmatter }, op.content ?? '', op.note)
        let file: SourceFile
        let index: number
        if (op.after === 0) {
          file = this.entryFile()
          index = 0
        }
        else {
          const loc = this.locate(op.after)
          file = loc.file
          index = loc.index + 1
        }
        const oldFirst = file.units[0]
        file.units.splice(index, 0, unit)
        if (file === this.entryFile())
          moveHeadmatter(file, oldFirst)
        return { selectUnit: unit }
      }
      case 'duplicateSlide': {
        const { file, unit, index, isHead } = this.locate(op.no)
        const copy = cloneUnit(unit)
        if (isHead && unit.fm && hasDeckKeys(unit.fm.doc))
          setUnitDoc(copy, slideDoc(unit.fm.doc))
        file.units.splice(index + 1, 0, copy)
        return { selectUnit: copy }
      }
      case 'removeSlides': {
        const nos = [...new Set(op.nos)].sort((a, b) => a - b)
        if (!nos.length)
          return {}
        const doomed = new Set(nos.map(no => this.locate(no).unit))
        const remaining = this.data.slides.filter(s => !doomed.has(this.files.get(s.source.filepath)!.units[s.source.index]))
        if (remaining.length === 0)
          throw new Error('Die letzte Folie kann nicht gelöscht werden.')
        for (const file of this.files.values()) {
          if (!file.units.some(u => doomed.has(u)))
            continue
          const oldFirst = file.units[0]
          file.units = file.units.filter(u => !doomed.has(u))
          if (file === this.entryFile()) {
            if (!file.units.length && oldFirst.fm && hasDeckKeys(oldFirst.fm.doc))
              throw new Error('Die erste Folie der Hauptdatei kann nicht gelöscht werden, solange keine andere Folie in dieser Datei steht.')
            moveHeadmatter(file, oldFirst)
          }
        }
        return { select: Math.min(nos[0], remaining.length) }
      }
      case 'moveSlide': {
        const total = this.data.slides.length
        if (op.to < 1 || op.to > total)
          throw new Error(`Folie kann nicht an Position ${op.to} verschoben werden.`)
        const moving = this.locate(op.from)
        if (op.from === op.to)
          return {}
        // Place it after the slide that will precede it, or before the one that will follow,
        // whichever lives in the same file.
        const others = this.data.slides.filter((_, i) => i !== op.from - 1)
        const candidates = [
          { info: op.to >= 2 ? others[op.to - 2] : undefined, after: true },
          { info: others[op.to - 1], after: false },
        ].filter(c => c.info).map(c => ({ ...this.locate(c.info!.index + 1), after: c.after }))
        const anchor = candidates.find(c => c.file === moving.file && c.unit !== moving.unit)
        if (!anchor)
          throw new Error('Diese Folie stammt aus einer anderen Datei (eingebunden mit "src:") und kann nur innerhalb dieser Datei verschoben werden.')
        const file = moving.file
        const oldFirst = file.units[0]
        file.units.splice(file.units.indexOf(moving.unit), 1)
        const at = file.units.indexOf(anchor.unit)
        file.units.splice(anchor.after ? at + 1 : at, 0, moving.unit)
        if (file === this.entryFile())
          moveHeadmatter(file, oldFirst)
        return { selectUnit: moving.unit }
      }
      case 'editBlock':
        this.editContent(op.no, content => editBlockContent(content, op.block, op.markdown))
        return {}
      case 'splitListItem': {
        let focus: BlockRef | undefined
        this.editContent(op.no, (content) => {
          const result = splitListItemContent(content, op.block, op.markdown, op.newItem)
          focus = result.focusLine === undefined ? undefined : refForLine(result.content, result.focusLine)
          return result.content
        })
        return { focus }
      }
      case 'removeBlock':
        this.editContent(op.no, content => removeBlockContent(content, op.block))
        return {}
      case 'insertBlock': {
        let focus: BlockRef | undefined
        this.editContent(op.no, (content) => {
          const result = insertBlockContent(content, op)
          focus = result.focusLine === undefined ? undefined : refForLine(result.content, result.focusLine)
          return result.content
        })
        return { focus }
      }
      case 'editText': {
        const { unit } = this.locate(op.no)
        const head = this.entryFile().units[0]
        editTextInUnit(unit, head === unit ? undefined : head, op.edit)
        return {}
      }
      case 'setHeadmatter': {
        const file = this.entryFile()
        if (!file.units.length)
          file.units.push(newUnit({}, '', undefined))
        patchUnitFrontmatter(file.units[0], op.patch)
        return {}
      }
      default:
        throw new Error(`Unbekannte Änderung: ${(op as { type: string }).type}`)
    }
  }

  private async apply(op: DeckOp): Promise<OpResult> {
    if (this.closed)
      throw new Error('Die Präsentation ist bereits geschlossen.')
    const before = cloneTexts(this.texts)
    let outcome: OpOutcome
    try {
      outcome = this.mutate(op)
      const changed = await this.commit(before)
      if (!changed)
        return { snapshot: { ...this.current, cause: 'app' } }
    }
    catch (error) {
      // Drop half-applied edits of the line model.
      this.resetFiles()
      throw error
    }
    let select = outcome.select
    if (outcome.selectUnit) {
      const index = this.current.slides.findIndex(s => s.id === outcome.selectUnit!.id)
      if (index >= 0)
        select = index + 1
    }
    this.emit()
    return { snapshot: this.current, ...(select ? { select } : {}), ...(outcome.focus ? { focusBlock: outcome.focus } : {}) }
  }

  /** Serialise the line model, write what changed and reload. Returns false when nothing changed. */
  private async commit(before: Texts): Promise<boolean> {
    const next = cloneTexts(this.texts)
    for (const [path, file] of this.files)
      next.set(path, serializeSourceFile(file))
    const changed = [...next].filter(([path, text]) => text !== this.texts.get(path))
    if (!changed.length) {
      this.resetFiles()
      return false
    }
    // Carry the ids of the edited model into the re-parse.
    const edited = this.files
    const { data, texts } = await this.loadFrom(next)
    for (const [path, text] of changed)
      await atomicWrite(path, text)
    this.pushUndo(before)
    this.data = data
    this.texts = texts
    const files = new Map<string, SourceFile>()
    for (const [path, text] of texts) {
      const fresh = parseSourceFile(path, text)
      carryIds(fresh, edited.get(path))
      files.set(path, fresh)
    }
    this.files = files
    this.revision++
    this.current = this.buildSnapshot('app')
    return true
  }

  private async writeTexts(target: Texts): Promise<Texts> {
    const next = cloneTexts(this.texts)
    for (const [path, text] of target) {
      if (next.get(path) !== text) {
        await atomicWrite(path, text)
        next.set(path, text)
      }
    }
    return next
  }

  private async step(kind: 'undo' | 'redo'): Promise<OpResult> {
    const from = kind === 'undo' ? this.undoStack : this.redoStack
    const to = kind === 'undo' ? this.redoStack : this.undoStack
    const target = from.pop()
    if (!target)
      return { snapshot: this.current }
    to.push(cloneTexts(this.texts))
    const next = await this.writeTexts(target)
    const { data, texts } = await this.loadFrom(next)
    this.install(data, texts, kind)
    this.emit()
    return { snapshot: this.current }
  }

  // -------------------------------------------------------------------------
  // Outside changes
  // -------------------------------------------------------------------------

  private async startWatching(): Promise<void> {
    const watcher = watch(this.dir, {
      ignoreInitial: true,
      ignored: (path: string) => {
        const rel = relative(this.dir, path)
        if (!rel || rel.startsWith('..'))
          return false
        return rel.split(sep).some(part => WATCH_IGNORED.has(part)) || path.endsWith('.podium-tmp')
      },
    })
    this.watcher = watcher
    const onEvent = (path: string) => {
      if (path.endsWith('.md') || this.texts.has(path))
        this.scheduleCheck()
    }
    watcher.on('add', onEvent)
    watcher.on('change', onEvent)
    watcher.on('unlink', onEvent)
    watcher.on('error', error => console.error('[deck] watcher', error))
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000)
      watcher.once('ready', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private scheduleCheck(): void {
    if (this.closed)
      return
    clearTimeout(this.watchTimer)
    this.watchTimer = setTimeout(() => {
      void this.run(() => this.checkExternal()).catch(error => console.error('[deck] reload failed', error))
    }, WATCH_DEBOUNCE_MS)
  }

  /** Reload when a deck file on disk differs from what this session last wrote or read. */
  private async checkExternal(): Promise<void> {
    if (this.closed)
      return
    const next = cloneTexts(this.texts)
    let changed = false
    for (const path of [this.entry, ...this.texts.keys()]) {
      try {
        const text = await readFile(path, 'utf8')
        if (text !== next.get(path)) {
          next.set(path, text)
          changed = true
        }
      }
      catch {
        // Missing for a moment (another tool replacing it): the next event retries.
        return
      }
    }
    if (!changed)
      return
    let loaded: { data: LoadedSlidevData, texts: Texts }
    try {
      loaded = await this.loadFrom(next)
    }
    catch {
      return
    }
    if (isBroken(loaded.data))
      return
    this.pushUndo(cloneTexts(this.texts))
    this.install(loaded.data, loaded.texts, 'external')
    this.emit()
  }

  // -------------------------------------------------------------------------
  // Files, assets, bundles
  // -------------------------------------------------------------------------

  private async storeAsset(fileName: string, data: Uint8Array): Promise<string> {
    const dir = join(this.dir, 'public', 'images')
    const name = uniqueName(dir, sanitizeFileName(fileName))
    await atomicWrite(join(dir, name), data)
    this.scheduleRepack()
    return `/images/${name}`
  }

  private async writeDeckFile(relativePath: string, content: string): Promise<void> {
    const target = insideDir(this.dir, relativePath)
    await atomicWrite(target, content)
    this.scheduleRepack()
    if (this.texts.has(target))
      await this.checkExternal()
  }

  private scheduleRepack(): void {
    if (!this.bundlePath || this.closed)
      return
    this.bundleDirty = true
    clearTimeout(this.repackTimer)
    this.repackTimer = setTimeout(() => {
      void this.run(() => this.repack()).catch(error => console.error('[deck] repack failed', error))
    }, REPACK_DELAY_MS)
  }

  private async repack(): Promise<void> {
    if (!this.bundlePath || !this.bundleDirty)
      return
    this.bundleDirty = false
    await packDir(this.dir, this.bundlePath)
  }

  private async close(): Promise<void> {
    if (this.closed)
      return
    this.closed = true
    clearTimeout(this.watchTimer)
    clearTimeout(this.repackTimer)
    await this.watcher?.close().catch(() => {})
    await this.run(() => this.repack())
  }
}
