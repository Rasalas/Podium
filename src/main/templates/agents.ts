/** The AGENTS.md that goes into every deck. English, because agents read it. */
import type { LayoutInfo } from '../../shared/types'

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
}

export function layoutTable(layouts: LayoutInfo[]): string {
  const rows = layouts
    .filter(l => !l.hidden)
    .map((l) => {
      const slots = l.slots.length === 0
        ? 'none'
        : l.slots.map(s => (s.name === 'default' ? `default (${s.label})` : `\`::${s.name}::\` (${s.label})`)).join(', ')
      const fields = l.fields.length === 0
        ? 'none'
        : l.fields.map(f => `\`${f.key}\` (${f.type})`).join(', ')
      return `| \`${l.name}\` | ${cell(l.description || l.label)} | ${cell(slots)} | ${cell(fields)} |`
    })
  return [
    '| Layout | Use it for | Slots | Frontmatter fields |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

export function buildAgentsFile(deck: { title: string, theme: string, addons: string[] }, layouts: LayoutInfo[]): string {
  const addons = deck.addons.length > 0 ? `Addons: ${deck.addons.map(a => `\`${a}\``).join(', ')}.` : 'No addons.'
  return `# ${deck.title}

This is a presentation written in Slidev markdown. People edit it visually in the desktop app Podium, and you edit the same file as text. Both sides must be able to keep working on it, so keep the file plain.

Theme: \`${deck.theme}\`. ${addons}

## How the file is built

- The whole deck is one file, \`slides.md\`. Slides are separated by a line with only \`---\`.
- The first block at the top of the file is the deck configuration (theme, title and so on).
- A slide can start with its own settings between two \`---\` lines, for example:

\`\`\`md
---
layout: image-right
image: /images/photo.jpg
---

# Heading

Text next to the picture.
\`\`\`

- Without \`layout\`, the first slide uses \`cover\` and all others use \`default\`.
- Some layouts have named areas. Start an area with \`::name::\` on its own line, for example \`::right::\`.
- Speaker notes go in an HTML comment at the end of the slide: \`<!-- what to say -->\`.

## Rules

- Use layouts and plain markdown. Avoid raw HTML, inline styles and Vue components, because the visual editor cannot edit them.
- One idea per slide. Keep titles short.
- Keep text short so nothing overflows: at most 6 to 7 bullet points, a few words each. Split the slide if it needs more.
- Put images in \`public/images/\` and refer to them as \`/images/name.png\`. Never link to files outside the deck folder.
- Add a new slide by adding \`---\`, optional settings, and the content. Do not renumber or reformat other slides.
- Write in the language the deck already uses.

## Layouts you can use

${layoutTable(layouts)}

## Check your work

- While the deck is open in Podium, Slidev serves an MCP endpoint at \`<server address>/__mcp\`. Podium shows the address in its agent panel. Use it to look at slides and see whether text overflows.
- Without Podium, run \`slidev export slides.md --format png\` and look at the images.

## Do not change unless asked

- The theme and anything in the configuration block at the top of \`slides.md\`.
- Files outside this deck folder.
- Slides the task does not mention.
`
}
