import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc'
import type { Locale } from '../shared/types'
import { Menu } from 'electron'

const LABELS = {
  de: {
    'file': 'Datei',
    'new-deck': 'Neue Präsentation …',
    'open-deck': 'Öffnen …',
    'close-deck': 'Präsentation schließen',
    'export-pdf': 'Als PDF exportieren …',
    'export-bundle': 'Als einzelne Datei speichern …',
    'settings': 'Einstellungen …',
    'quit': 'Beenden',
    'edit': 'Bearbeiten',
    'undo': 'Rückgängig',
    'redo': 'Wiederholen',
    'cut': 'Ausschneiden',
    'copy': 'Kopieren',
    'paste': 'Einfügen',
    'select-all': 'Alles auswählen',
    'slide': 'Folie',
    'new-slide': 'Neue Folie',
    'duplicate-slide': 'Folie duplizieren',
    'delete-slide': 'Folie löschen',
    'check-deck': 'Folien prüfen',
    'view': 'Ansicht',
    'toggle-source': 'Quelltext',
    'toggle-notes': 'Notizen',
    'toggle-agent': 'KI-Assistent',
    'devtools': 'Entwicklerwerkzeuge',
    'present-menu': 'Präsentieren',
    'present': 'Von Anfang an',
    'present-from-current': 'Ab aktueller Folie',
    'stop-presentation': 'Präsentation beenden (Esc)',
    'swap-displays': 'Bildschirme tauschen',
  },
  en: {
    'file': 'File',
    'new-deck': 'New presentation …',
    'open-deck': 'Open …',
    'close-deck': 'Close presentation',
    'export-pdf': 'Export as PDF …',
    'export-bundle': 'Save as single file …',
    'settings': 'Settings …',
    'quit': 'Quit',
    'edit': 'Edit',
    'undo': 'Undo',
    'redo': 'Redo',
    'cut': 'Cut',
    'copy': 'Copy',
    'paste': 'Paste',
    'select-all': 'Select all',
    'slide': 'Slide',
    'new-slide': 'New slide',
    'duplicate-slide': 'Duplicate slide',
    'delete-slide': 'Delete slide',
    'check-deck': 'Check slides',
    'view': 'View',
    'toggle-source': 'Source',
    'toggle-notes': 'Notes',
    'toggle-agent': 'AI assistant',
    'devtools': 'Developer tools',
    'present-menu': 'Present',
    'present': 'From the beginning',
    'present-from-current': 'From current slide',
    'stop-presentation': 'End presentation (Esc)',
    'swap-displays': 'Swap displays',
  },
} as const

/** Also handled in the presentation windows, which have no menu on Windows and Linux. */
export const SWAP_DISPLAYS_ACCELERATOR = 'CmdOrCtrl+Shift+T'

export function buildMenu(locale: Locale, send: (command: MenuCommand) => void): Menu {
  const t = LABELS[locale]
  const item = (command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label: t[command as keyof typeof t] ?? command,
    accelerator,
    click: () => send(command),
  })
  // Undo/redo go to the renderer, which decides between text-field undo and deck undo.
  const template: MenuItemConstructorOptions[] = [
    {
      label: t.file,
      submenu: [
        item('new-deck', 'CmdOrCtrl+N'),
        item('open-deck', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('export-pdf', 'CmdOrCtrl+Shift+E'),
        item('export-bundle'),
        { type: 'separator' },
        item('settings', 'CmdOrCtrl+,'),
        item('close-deck', 'CmdOrCtrl+W'),
        { type: 'separator' },
        { label: t.quit, role: 'quit' },
      ],
    },
    {
      label: t.edit,
      submenu: [
        item('undo', 'CmdOrCtrl+Z'),
        item('redo', 'CmdOrCtrl+Shift+Z'),
        { type: 'separator' },
        { label: t.cut, role: 'cut' },
        { label: t.copy, role: 'copy' },
        { label: t.paste, role: 'paste' },
        { label: t['select-all'], role: 'selectAll' },
      ],
    },
    {
      label: t.slide,
      submenu: [
        item('new-slide', 'CmdOrCtrl+M'),
        item('duplicate-slide', 'CmdOrCtrl+D'),
        item('delete-slide'),
        { type: 'separator' },
        item('check-deck'),
      ],
    },
    {
      label: t.view,
      submenu: [
        item('toggle-source', 'CmdOrCtrl+E'),
        item('toggle-notes'),
        item('toggle-agent', 'CmdOrCtrl+J'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: t.devtools, role: 'toggleDevTools' },
      ],
    },
    {
      label: t['present-menu'],
      submenu: [
        item('present', 'F5'),
        item('present-from-current', 'Shift+F5'),
        { type: 'separator' },
        // While presenting the editor is hidden, so these have to be reachable from the menu.
        item('swap-displays', SWAP_DISPLAYS_ACCELERATOR),
        item('stop-presentation'),
      ],
    },
  ]
  // macOS puts the first menu under the app's name; without this, "Datei" would end up there.
  if (process.platform === 'darwin')
    template.unshift({ role: 'appMenu' })
  return Menu.buildFromTemplate(template)
}
