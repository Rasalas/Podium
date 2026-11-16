# Templates

A template is a Slidev theme plus a description of its layouts. Podium builds its layout picker and its properties panel from that description.

This folder holds the themes that ship with the app. Each one is a normal Slidev theme package and gets copied into the runtime as it is.

- `slidev-theme-klar/` is Podium's own default template.

## Describing a theme: `podium.json`

Put a `podium.json` in the theme's root folder. Or put the same object into a `podium` field of its `package.json`. Both are optional. Without them Podium reads the layout `.vue` files and guesses.

```json
{
  "label": { "de": "Klar", "en": "Clear" },
  "description": { "de": "Ruhig und kontrastreich.", "en": "Calm and high contrast." },
  "colors": { "background": "#fbfbf9", "foreground": "#15181e", "accent": "#2459d3" },
  "starter": "starter.md",
  "layouts": {
    "two-cols": {
      "label": { "de": "Zwei Spalten", "en": "Two columns" },
      "description": { "de": "Zwei Inhalte nebeneinander.", "en": "Two contents side by side." },
      "category": "content",
      "sketch": "two-cols",
      "slots": [
        { "name": "default", "label": { "de": "Links", "en": "Left" } },
        { "name": "right", "label": { "de": "Rechts", "en": "Right" } }
      ],
      "fields": [
        { "key": "image", "type": "image", "label": { "de": "Bild", "en": "Image" } }
      ],
      "starter": {
        "de": "# Links\n\n::right::\n\n# Rechts",
        "en": "# Left\n\n::right::\n\n# Right"
      },
      "hidden": false
    }
  }
}
```

### Top level

| Key | Meaning |
| --- | --- |
| `label`, `description` | Name and one sentence for the template picker. |
| `colors` | `background`, `foreground`, `accent` as CSS colours. Used to draw the picker tile. |
| `starter` | Starter deck for new decks, a markdown file relative to the theme folder. |
| `layouts` | Layout descriptions, keyed by the layout name (the `layout:` value). |

Every text may be a plain string or an object `{ "de": "...", "en": "..." }`. Podium picks the app language and falls back to English.

### Starter deck

The starter is a complete Slidev markdown file. Podium fills in `theme` and `title` in the first block and replaces `{{title}}` anywhere in the file. Other keys of the first block, such as `layout: cover`, stay.

For English there may be a sibling file with `.en` before the extension (`starter.en.md`). It is used when the app language is English, otherwise `starter.md`.

### Layout entry

| Key | Meaning |
| --- | --- |
| `label`, `description` | Plain words for the picker. No technical terms. |
| `category` | `title`, `content`, `media`, `emphasis` or `special`. Decides the group in the picker. |
| `sketch` | Shape of the picker tile: `cover`, `title-body`, `center`, `two-cols`, `two-cols-header`, `image-left`, `image-right`, `image-full`, `section`, `quote`, `fact`, `statement`, `end`, `iframe`, `blank` or `generic`. |
| `slots` | The areas of the layout. `name` is `default` or the name used as `::name::` in markdown. `label` is shown in the editor. |
| `fields` | Frontmatter keys the layout reads. Each has `key`, `type`, `label`, and optionally `description`, `default` and `options`. |
| `starter` | Markdown for a new slide with this layout. Use `::name::` markers for named slots. |
| `hidden` | `true` keeps the layout out of the picker. It stays valid in files. |

Field types: `text`, `longtext`, `image`, `color`, `boolean`, `select`, `number`, `url`. A `select` lists `options` as `{ "value": "cover", "label": { "de": "...", "en": "..." } }`.

### Which information wins

For every layout, Podium combines three sources. The first one that has a value wins:

1. the theme's `podium.json` (or addon's, or the `podium` field)
2. the built-in catalog of Slidev's layouts and the official themes
3. what the scanner reads from the `.vue` file: slots from `<slot>` elements, props from `defineProps`

Layouts are collected in this order, later ones replacing earlier ones by name: Slidev's base layouts, the theme, the addons, the deck's own `layouts/` folder.

A manifest entry also applies to a layout the theme does not override, for example to relabel a Slidev base layout. Slots and fields given in a manifest replace the others completely.
