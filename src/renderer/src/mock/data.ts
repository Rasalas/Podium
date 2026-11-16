import type { LayoutField, LayoutInfo } from '@shared/types'
import { starterFor } from './deck'

interface SampleSlide { frontmatter: Record<string, unknown>, content: string, note: string }

export function sampleDeck(path: string): { headmatter: Record<string, unknown>, slides: SampleSlide[] } {
  if (path.includes('Geburtstag')) {
    return {
      headmatter: { theme: 'seriph', title: 'Omas 80. Geburtstag', addons: ['fotoalbum'] },
      slides: [
        { frontmatter: {}, content: '# Omas 80. Geburtstag\n\nEin Fest für Erika', note: '' },
        { frontmatter: {}, content: '# Die Jahre\n\n- 1946 geboren in Bielefeld\n- 1968 Hochzeit\n- 1972 das erste Haus', note: '' },
      ],
    }
  }
  const name = path.split('/').filter(Boolean).at(-1) ?? 'Präsentation'
  const title = name.includes('Jahresrückblick') ? 'Jahresrückblick Wanderverein' : name.replace(/\.(podium|md)$/, '')
  return {
    headmatter: { theme: path.includes('Gartenplanung') ? 'default' : 'klar', title },
    slides: [
      { frontmatter: {}, content: `# ${title}\n\nMitgliederversammlung, 14. März`, note: 'Alle begrüßen, kurz den Ablauf erklären.' },
      { frontmatter: {}, content: '# Unsere Touren\n\n- 12 Tageswanderungen\n- 2 Wochenendfahrten in den Harz\n- **348 km** zu Fuß', note: 'Fotos von der Harzfahrt zeigen.' },
      { frontmatter: { layout: 'two-cols' }, content: '# Neue Mitglieder\n\n- Familie Becker\n- Herr Yilmaz\n\n::right::\n\n# Abschiede\n\nWir danken Frau Lorenz für 30 Jahre Kassenführung.', note: '' },
      { frontmatter: { layout: 'image-right', image: '/images/harz.jpg' }, content: '# Der Harz im Oktober\n\nUnsere schönste Tour des Jahres, mit Übernachtung in Schierke.', note: '' },
      { frontmatter: {}, content: '# Kassenbericht\n\n| Posten | Betrag |\n| --- | --- |\n| Beiträge | 4.820 € |\n| Fahrten | -3.150 € |\n| Rücklage | 1.670 € |', note: 'Frau Lorenz bitten, die Zahlen kurz zu erläutern.' },
      { frontmatter: {}, content: '# Termine 2027\n\n- 9. Januar: Neujahrswanderung\n- 6. Februar: Grünkohlessen\n- 13. März: Frühlingstour Teutoburger Wald\n- 17. April: Osterwanderung\n- 22. Mai: Fahrt an die Mosel\n- 19. Juni: Sommerfest\n- 10. Juli: Abendwanderung\n- 14. August: Radtour\n- 11. September: Weinlese\n- 9. Oktober: Harzfahrt\n- 13. November: Laternenlauf', note: '' },
      { frontmatter: {}, content: '<div class="karte">\n  <h1>Mitgliederkarte</h1>\n  <MitgliederKarte :jahr="2026" />\n</div>', note: '' },
      { frontmatter: { layout: 'end' }, content: '# Vielen Dank!\n\nFragen?', note: '' },
    ],
  }
}

const imageField = (key: string, label: string): LayoutField => ({ key, type: 'image', label })

function layout(name: string, label: string, category: LayoutInfo['category'], sketch: LayoutInfo['sketch'], extra: Partial<LayoutInfo> = {}): LayoutInfo {
  return {
    name,
    label,
    description: '',
    origin: 'slidev',
    slots: [{ name: 'default', label: 'Inhalt' }],
    fields: [],
    sketch,
    starter: starterFor(name),
    category,
    ...extra,
  }
}

export const MOCK_LAYOUTS: LayoutInfo[] = [
  layout('cover', 'Titelfolie', 'title', 'cover', {
    origin: 'theme',
    fields: [
      imageField('background', 'Hintergrundbild'),
      { key: 'class', type: 'select', label: 'Textausrichtung', options: [{ value: '', label: 'Links' }, { value: 'text-center', label: 'Mittig' }] },
    ],
  }),
  layout('section', 'Abschnitt', 'title', 'section'),
  layout('default', 'Titel und Inhalt', 'content', 'title-body'),
  layout('center', 'Zentriert', 'content', 'center'),
  layout('two-cols', 'Zwei Spalten', 'content', 'two-cols', { slots: [{ name: 'default', label: 'Linke Spalte' }, { name: 'right', label: 'Rechte Spalte' }] }),
  layout('two-cols-header', 'Überschrift und zwei Spalten', 'content', 'two-cols-header', {
    slots: [{ name: 'default', label: 'Überschrift' }, { name: 'left', label: 'Linke Spalte' }, { name: 'right', label: 'Rechte Spalte' }],
  }),
  layout('image-right', 'Bild rechts', 'media', 'image-right', {
    fields: [imageField('image', 'Bild'), { key: 'backgroundSize', type: 'select', label: 'Bildgröße', options: [{ value: 'cover', label: 'Füllen' }, { value: 'contain', label: 'Ganz zeigen' }], default: 'cover' }],
  }),
  layout('image-left', 'Bild links', 'media', 'image-left', { fields: [imageField('image', 'Bild')] }),
  layout('image', 'Bild ganzseitig', 'media', 'image-full', { fields: [imageField('image', 'Bild')] }),
  layout('iframe', 'Webseite', 'media', 'iframe', {
    fields: [{ key: 'url', type: 'url', label: 'Adresse der Webseite', description: 'Die Seite wird auf der Folie angezeigt.' }],
  }),
  layout('quote', 'Zitat', 'emphasis', 'quote'),
  layout('fact', 'Große Zahl', 'emphasis', 'fact'),
  layout('statement', 'Aussage', 'emphasis', 'statement', {
    origin: 'theme',
    fields: [
      { key: 'accent', type: 'color', label: 'Akzentfarbe', default: '#2f6fdf' },
      { key: 'fontScale', type: 'number', label: 'Schriftgröße in Prozent', default: 100 },
      { key: 'dark', type: 'boolean', label: 'Dunkler Hintergrund' },
    ],
  }),
  layout('end', 'Schluss', 'special', 'end'),
  layout('none', 'Leer', 'special', 'blank', { fields: [{ key: 'caption', type: 'longtext', label: 'Bildunterschrift' }] }),
  layout('404', 'Nicht gefunden', 'special', 'generic', { hidden: true }),
]
