# Landmarks & section

`body > header`, `main` and `footer` are centered columns out of the box; `section`s space themselves vertically.

## Landmarks

```html
<body>
  <header>…</header>
  <main>…</main>
  <footer>…</footer>
</body>
```

Each direct landmark child of `body` gets the [container](./CONTAINER.md) column and `--v-block-spacing-vertical` / `-horizontal` padding. The role and class aliases (`[role="main"]`, `.tag-main`, …) count as landmarks too, and an `.abstract` wrapper between `body` and the landmark is looked through (an `<include-content class="abstract">` around a header keeps it a landmark).

## Section

<include-content data-demo="landmarks"></include-content>

`section` (and `[role="section"]` / `.tag-section`) is a block with `--v-block-spacing-vertical` below it. The spacing grows with the viewport: `1×` `--v-spacing` below 576px up to `2.25×` at 1536px, on landmarks, sections and cards alike.

## Document

The root sets the font stack, size, weight, line height, `overflow-wrap: break-word`, `box-sizing: border-box` everywhere and a responsive root font size (`100%` → `131.25%` at 1536px), so every `rem` scales with the viewport.
