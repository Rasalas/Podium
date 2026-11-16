/** Starter decks and the files that go into every new deck. */
import type { Locale } from '../../shared/types'

const GENERIC_DE = `---
layout: cover
---

# {{title}}

Untertitel oder kurze Beschreibung

Vorname Nachname · Datum

---

# Worum es geht

- Erster Punkt
- Zweiter Punkt
- Dritter Punkt

<!--
Hier steht deine Notiz zu dieser Folie. Das Publikum sieht sie nicht.
-->

---
layout: two-cols
---

# Links

- Ein Gedanke
- Noch ein Gedanke

::right::

# Rechts

- Ein Gegenpunkt
- Noch ein Gegenpunkt

---
layout: statement
---

# Eine klare Aussage

---
layout: end
---

# Danke!

Fragen und Anmerkungen willkommen
`

const GENERIC_EN = `---
layout: cover
---

# {{title}}

Subtitle or short description

First name Last name · Date

---

# What this is about

- First point
- Second point
- Third point

<!--
Your note for this slide goes here. The audience does not see it.
-->

---
layout: two-cols
---

# Left

- One thought
- Another thought

::right::

# Right

- One counterpoint
- Another counterpoint

---
layout: statement
---

# A clear statement

---
layout: end
---

# Thank you!

Questions and comments welcome
`

export function genericStarter(locale: Locale): string {
  return locale === 'de' ? GENERIC_DE : GENERIC_EN
}

function yamlString(value: string): string {
  return /^[\w ]+$/.test(value) && !/^\d+$/.test(value.trim()) ? value : JSON.stringify(value)
}

/**
 * Put `theme` and `title` into the headmatter of a starter deck, keep its other keys
 * (such as `layout: cover` for slide 1) and fill `{{title}}` placeholders.
 */
export function prepareStarter(raw: string, themeId: string, title: string): string {
  const text = raw.replace(/\r\n/g, '\n').replace(/\{\{title\}\}/g, title.replace(/\n/g, ' '))
  const head = `theme: ${yamlString(themeId)}\ntitle: ${yamlString(title)}\n`
  const m = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!m)
    return `---\n${head}---\n\n${text.replace(/^\n+/, '')}`
  const kept = m[1]
    .split('\n')
    .filter(line => !/^(?:theme|title)\s*:/.test(line))
    .join('\n')
    .trim()
  const rest = text.slice(m[0].length)
  return `---\n${head}${kept ? `${kept}\n` : ''}---\n${rest}`
}

export const GITIGNORE = 'node_modules\ndist\n.slidev\n*.podium\n'
export const CLAUDE_MD = '@AGENTS.md\n'

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'praesentation'
}
