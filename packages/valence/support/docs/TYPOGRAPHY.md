# Typography

Headings, paragraphs, lists, quotes and inline text primitives — every one available as a tag, a role or an `.tag-*` class.

## Headings

`h1`–`h6` (or `[role="heading"][aria-level="n"]`) set their own `--v-font-size`, `--v-line-height` and color (`--v-h1-color` … `--v-h6-color`). A heading that follows a block (`p`, `ul`, `article`, `table`, …) gets `--v-typography-spacing-top` above it, so sections breathe without extra markup.

An `hgroup` keeps its children tight and mutes the last one — a title plus a subtitle:

<include-content data-demo="typography"></include-content>

## Blocks

`p`, `ul` / `ol`, `dl`, `blockquote`, `address`, `pre`, `table` share `--v-typography-spacing-vertical` below them. `ul` lists use square markers; nested lists drop their outer margin. A `blockquote` gets a left rule (`--v-blockquote-border-color`) and a muted `footer` for the citation.

## Inline

| Element | Style |
| --- | --- |
| `strong`, `b` | Bolder |
| `mark` | `--v-mark-background-color` highlight |
| `ins`, `del` | `--v-ins-color` / `--v-del-color` |
| `abbr[title]` | Dotted underline, help cursor |
| `sub`, `sup` | No line-height change |
| `small` | `0.875em`; `small[role="note"]` is a block-level muted note |
| `kbd`, `code`, `samp` | See [Code](./CODE.md) |

`hr` is a 1px `--v-muted-border-color` rule with vertical spacing. Text selection uses `--v-text-selection-color`.
