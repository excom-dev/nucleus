# Card

An `article` is a card: padding, radius, shadow, and sectioned `header` / `footer` bands.

## Usage

<include-content data-demo="card"></include-content>

```html
<article>
  <header>Header</header>
  Body
  <footer>Footer</footer>
</article>
```

`header` / `footer` (direct children, or through an `.abstract` wrapper) bleed to the card edges with `--v-card-sectioning-background-color` and a `--v-card-border-color` rule. `.nested` quiets a card inside another card (`--v-multiply-color-*` surfaces).

Tokens: `--v-card-background-color`, `--v-card-border-color`, `--v-card-box-shadow`, `--v-card-sectioning-background-color`; the padding is `--v-block-spacing-vertical` / `-horizontal`, so cards grow with the viewport like [sections](./LANDMARKS.md).

## Aliases

`[role="article"]` / `.tag-article` — the usual way to make a custom element a card (`<content-drawer class="tag-article">`).
