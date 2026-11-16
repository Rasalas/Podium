/**
 * Metadata for the layouts that ship with Slidev (@slidev/client/layouts) and for the
 * layouts of the official default and seriph themes. Based on reading each .vue file:
 * slots are the `<slot>` elements, fields are the props or frontmatter keys the layout reads.
 */
import type { CatalogField, LayoutMeta } from './types'

const cls: CatalogField = {
  key: 'class',
  type: 'text',
  label: { de: 'Zusatzklasse', en: 'Extra class' },
  description: {
    de: 'Für Fortgeschrittene: eigene Stilklassen, durch Leerzeichen getrennt.',
    en: 'For advanced use: your own style classes, separated by spaces.',
  },
}

const image: CatalogField = {
  key: 'image',
  type: 'image',
  label: { de: 'Bild', en: 'Image' },
}

const imageFit: CatalogField = {
  key: 'backgroundSize',
  type: 'select',
  label: { de: 'Bildausschnitt', en: 'Image fit' },
  default: 'cover',
  options: [
    { value: 'cover', label: { de: 'Füllen', en: 'Fill' } },
    { value: 'contain', label: { de: 'Ganz zeigen', en: 'Show whole image' } },
  ],
}

const url: CatalogField = {
  key: 'url',
  type: 'url',
  label: { de: 'Webadresse', en: 'Web address' },
  description: { de: 'Die Seite, die gezeigt werden soll, zum Beispiel https://example.org', en: 'The page to show, for example https://example.org' },
}

const scale: CatalogField = {
  key: 'scale',
  type: 'number',
  label: { de: 'Größe der Seite', en: 'Page scale' },
  description: { de: '1 ist normal, 0.5 zeigt die Seite verkleinert.', en: '1 is normal, 0.5 shows the page smaller.' },
  default: 1,
}

const background: CatalogField = {
  key: 'background',
  type: 'image',
  label: { de: 'Hintergrundbild', en: 'Background image' },
  description: { de: 'Optional. Das Bild liegt hinter dem Text.', en: 'Optional. The image sits behind the text.' },
}

const oneSlot = (de: string, en: string) => [{ name: 'default', label: { de, en } }]

export const BASE_CATALOG: Record<string, LayoutMeta> = {
  'cover': {
    label: { de: 'Titelfolie', en: 'Title slide' },
    description: { de: 'Der Einstieg: Titel, Untertitel und Name.', en: 'The opening: title, subtitle and name.' },
    category: 'title',
    sketch: 'cover',
    slots: oneSlot('Titel und Untertitel', 'Title and subtitle'),
    fields: [background, cls],
    starter: { de: '# Titel des Vortrags\n\nUntertitel\n\nName · Datum', en: '# Title of the talk\n\nSubtitle\n\nName · Date' },
  },
  'intro': {
    label: { de: 'Vorstellung', en: 'Introduction' },
    description: { de: 'Titelfolie, die einen Vortrag oder eine Person vorstellt.', en: 'Title slide that introduces a talk or a person.' },
    category: 'title',
    sketch: 'cover',
    slots: oneSlot('Titel und Text', 'Title and text'),
    fields: [cls],
    starter: { de: '# Über mich\n\nKurze Vorstellung in einem Satz', en: '# About me\n\nShort introduction in one sentence' },
  },
  'default': {
    label: { de: 'Titel und Inhalt', en: 'Title and content' },
    description: { de: 'Überschrift mit Text oder Aufzählung.', en: 'Heading with text or a list.' },
    category: 'content',
    sketch: 'title-body',
    slots: oneSlot('Inhalt', 'Content'),
    fields: [cls],
    starter: { de: '# Überschrift\n\n- Erster Punkt\n- Zweiter Punkt\n- Dritter Punkt', en: '# Heading\n\n- First point\n- Second point\n- Third point' },
  },
  'center': {
    label: { de: 'Zentriert', en: 'Centered' },
    description: { de: 'Inhalt mitten auf der Folie.', en: 'Content in the middle of the slide.' },
    category: 'content',
    sketch: 'center',
    slots: oneSlot('Inhalt', 'Content'),
    fields: [cls],
    starter: { de: '# Text in der Mitte\n\nEin kurzer Satz dazu', en: '# Text in the middle\n\nOne short sentence about it' },
  },
  'section': {
    label: { de: 'Abschnitt', en: 'Section' },
    description: { de: 'Trennfolie zwischen zwei Teilen des Vortrags.', en: 'Divider between two parts of the talk.' },
    category: 'title',
    sketch: 'section',
    slots: oneSlot('Abschnittstitel', 'Section title'),
    fields: [cls],
    starter: { de: '# Neuer Abschnitt', en: '# New section' },
  },
  'two-cols': {
    label: { de: 'Zwei Spalten', en: 'Two columns' },
    description: { de: 'Zwei Inhalte nebeneinander, zum Beispiel zum Vergleichen.', en: 'Two contents side by side, for example to compare.' },
    category: 'content',
    sketch: 'two-cols',
    slots: [
      { name: 'default', label: { de: 'Links', en: 'Left' } },
      { name: 'right', label: { de: 'Rechts', en: 'Right' } },
    ],
    fields: [cls],
    starter: { de: '# Links\n\n- Punkt\n- Punkt\n\n::right::\n\n# Rechts\n\n- Punkt\n- Punkt', en: '# Left\n\n- Point\n- Point\n\n::right::\n\n# Right\n\n- Point\n- Point' },
  },
  'two-cols-header': {
    label: { de: 'Zwei Spalten mit Titel', en: 'Two columns with title' },
    description: { de: 'Eine Überschrift über zwei Spalten, optional mit Zeile unten.', en: 'One heading above two columns, optionally with a line at the bottom.' },
    category: 'content',
    sketch: 'two-cols-header',
    slots: [
      { name: 'default', label: { de: 'Titel', en: 'Title' } },
      { name: 'left', label: { de: 'Links', en: 'Left' } },
      { name: 'right', label: { de: 'Rechts', en: 'Right' } },
      { name: 'bottom', label: { de: 'Unten', en: 'Bottom' } },
    ],
    fields: [cls],
    starter: {
      de: '# Überschrift\n\n::left::\n\n### Links\n\nText oder Aufzählung\n\n::right::\n\n### Rechts\n\nText oder Aufzählung',
      en: '# Heading\n\n::left::\n\n### Left\n\nText or list\n\n::right::\n\n### Right\n\nText or list',
    },
  },
  'image-left': {
    label: { de: 'Bild links', en: 'Image left' },
    description: { de: 'Links ein Bild, rechts Text.', en: 'Image on the left, text on the right.' },
    category: 'media',
    sketch: 'image-left',
    slots: oneSlot('Text', 'Text'),
    fields: [image, imageFit, cls],
    starter: { de: '# Überschrift\n\nText zum Bild.', en: '# Heading\n\nText about the picture.' },
  },
  'image-right': {
    label: { de: 'Bild rechts', en: 'Image right' },
    description: { de: 'Links Text, rechts ein Bild.', en: 'Text on the left, image on the right.' },
    category: 'media',
    sketch: 'image-right',
    slots: oneSlot('Text', 'Text'),
    fields: [image, imageFit, cls],
    starter: { de: '# Überschrift\n\nText zum Bild.', en: '# Heading\n\nText about the picture.' },
  },
  'image': {
    label: { de: 'Bild als Folie', en: 'Full image' },
    description: { de: 'Ein Bild füllt die ganze Folie.', en: 'One image fills the whole slide.' },
    category: 'media',
    sketch: 'image-full',
    slots: oneSlot('Text über dem Bild', 'Text over the image'),
    fields: [image, imageFit],
    starter: { de: '', en: '' },
  },
  'iframe': {
    label: { de: 'Webseite', en: 'Web page' },
    description: { de: 'Eine Webseite füllt die ganze Folie.', en: 'A web page fills the whole slide.' },
    category: 'media',
    sketch: 'iframe',
    slots: [],
    fields: [url, scale],
    starter: { de: '', en: '' },
  },
  'iframe-left': {
    label: { de: 'Webseite links', en: 'Web page left' },
    description: { de: 'Links eine Webseite, rechts Text.', en: 'Web page on the left, text on the right.' },
    category: 'media',
    sketch: 'iframe',
    slots: oneSlot('Text', 'Text'),
    fields: [url, scale],
    starter: { de: '# Überschrift\n\nText zur Webseite.', en: '# Heading\n\nText about the web page.' },
  },
  'iframe-right': {
    label: { de: 'Webseite rechts', en: 'Web page right' },
    description: { de: 'Links Text, rechts eine Webseite.', en: 'Text on the left, web page on the right.' },
    category: 'media',
    sketch: 'iframe',
    slots: oneSlot('Text', 'Text'),
    fields: [url, scale],
    starter: { de: '# Überschrift\n\nText zur Webseite.', en: '# Heading\n\nText about the web page.' },
  },
  'quote': {
    label: { de: 'Zitat', en: 'Quote' },
    description: { de: 'Ein Zitat groß, mit Quelle darunter.', en: 'A large quote with its source below.' },
    category: 'emphasis',
    sketch: 'quote',
    slots: oneSlot('Zitat und Quelle', 'Quote and source'),
    fields: [cls],
    starter: { de: '# „Das Zitat steht hier.“\n\nName der Person', en: '# "The quote goes here."\n\nName of the person' },
  },
  'statement': {
    label: { de: 'Aussage', en: 'Statement' },
    description: { de: 'Ein einziger großer Satz.', en: 'One single large sentence.' },
    category: 'emphasis',
    sketch: 'statement',
    slots: oneSlot('Aussage', 'Statement'),
    fields: [cls],
    starter: { de: '# Eine klare Aussage', en: '# A clear statement' },
  },
  'fact': {
    label: { de: 'Kennzahl', en: 'Key figure' },
    description: { de: 'Eine große Zahl mit kurzer Erklärung.', en: 'A large number with a short explanation.' },
    category: 'emphasis',
    sketch: 'fact',
    slots: oneSlot('Zahl und Erklärung', 'Number and explanation'),
    fields: [cls],
    starter: { de: '# 100 %\n\nWas die Zahl bedeutet', en: '# 100 %\n\nWhat the number means' },
  },
  'end': {
    label: { de: 'Schlussfolie', en: 'Closing slide' },
    description: { de: 'Abschlussfolie, etwa mit Dank und Kontakt.', en: 'Closing slide, for example with thanks and contact.' },
    category: 'title',
    sketch: 'end',
    slots: oneSlot('Text', 'Text'),
    fields: [cls],
    starter: { de: '# Danke!\n\nKontakt oder Fragen', en: '# Thank you!\n\nContact or questions' },
  },
  'full': {
    label: { de: 'Vollbild', en: 'Full area' },
    description: { de: 'Der Inhalt nutzt die ganze Folie ohne Rand, zum Beispiel für ein Diagramm.', en: 'Content uses the whole slide without margin, for example for a chart.' },
    category: 'special',
    sketch: 'blank',
    slots: oneSlot('Inhalt', 'Content'),
    fields: [cls],
    starter: { de: '', en: '' },
  },
  '404': {
    label: { de: 'Fehlerseite', en: 'Not found page' },
    description: { de: 'Wird gezeigt, wenn eine Folie fehlt. Nicht zum Auswählen gedacht.', en: 'Shown when a slide is missing. Not meant to be picked.' },
    category: 'special',
    sketch: 'blank',
    slots: [],
    fields: [],
    starter: { de: '', en: '' },
    hidden: true,
  },
  'error': {
    label: { de: 'Fehleranzeige', en: 'Error page' },
    description: { de: 'Wird gezeigt, wenn eine Folie einen Fehler hat. Nicht zum Auswählen gedacht.', en: 'Shown when a slide has an error. Not meant to be picked.' },
    category: 'special',
    sketch: 'blank',
    slots: [],
    fields: [],
    starter: { de: '', en: '' },
    hidden: true,
  },
  'none': {
    label: { de: 'Ohne Gestaltung', en: 'Unstyled' },
    description: { de: 'Keine Vorgaben, der Inhalt steht roh auf der Folie.', en: 'No styling, the content sits raw on the slide.' },
    category: 'special',
    sketch: 'blank',
    slots: oneSlot('Inhalt', 'Content'),
    fields: [],
    starter: { de: '', en: '' },
    hidden: true,
  },
}

/**
 * Differences of the official themes. Layout names are the same as in the base catalog,
 * so only what the theme changes is listed. Keyed by npm package name.
 */
export const THEME_CATALOG: Record<string, Record<string, LayoutMeta>> = {
  '@slidev/theme-default': {
    cover: {
      fields: [{ ...background, description: { de: 'Optional. Das Bild wird abgedunkelt und liegt hinter dem Text.', en: 'Optional. The image is dimmed and sits behind the text.' } }, cls],
    },
  },
  '@slidev/theme-seriph': {
    cover: {
      fields: [{
        ...background,
        description: {
          de: 'Ohne eigenes Bild lädt diese Vorlage ein Zufallsfoto aus dem Internet. Für Vorträge ohne Netz hier ein Bild wählen.',
          en: 'Without your own image this template loads a random photo from the internet. Pick an image here for talks without network.',
        },
      }, cls],
    },
  },
}

/** Sort position inside a category: common layouts first. */
export const LAYOUT_PRIORITY = [
  'cover', 'default', 'title-only', 'section', 'two-cols', 'two-cols-header', 'image-right', 'image-left',
  'quote', 'statement', 'fact', 'end', 'center', 'intro', 'image', 'full', 'iframe', 'iframe-right', 'iframe-left',
]

export const CATEGORY_ORDER = ['title', 'content', 'media', 'emphasis', 'special'] as const
