# Themes & layers

A theme is a token file plus the shared mixins; `basic` (Pico-faithful) ships today, and every theme shares the same tokens so markup never changes.

## Entry points

```css
@import "@excom/valence/basic.css";        /* the theme: mixins + tokens + every module */
@import "@excom/valence/src/mixins.basic.css"; /* mixins only, for element authors */
```

`basic.css` is `mixins.basic.css` + `basic-vars.css` (the tokens, both schemes) + `apply.css` (every module applied once). `basic-vars.css` alone gives the tokens without any element styling.

The `nucleus-kit` bundle re-exports `basic.css`, so Nucleus Kit users already have it.

## Layers

`apply.css` puts every element / alias module inside one anonymous `@layer`. Anything unlayered — your stylesheet, a custom element's CSS — beats it regardless of specificity, so overriding Valence.css never needs `!important`. The class utilities (`.container`, `.grid`, `.overflow-auto`, `.abstract`, [opt-outs](./OPT_OUTS.md)) are deliberately *unlayered* so they win over element styles a custom element ships later.

## Mixins for element authors

Custom elements that want to look native import `src/mixins.basic.css` (tokens are read from the document; no theme is duplicated) and apply the mixins in their own CSS:

| Mixin | Use |
| --- | --- |
| `modal-backdrop` | The dimmer behind a dialog / drawer (`dialog::backdrop`, `[role="presentation"]`, `.tag-backdrop`) |
| `modal-close-control` | The close icon control (`.close`, `[rel="prev"]`) |
| `util-nested-card`, `util-elevated` | Card surfaces |
| `util-focus-ring`, `util-press-feedback` | Interaction states |
| `util-small-note` | Muted block note (what `small[role="note"]` uses) |
| `abstract-wrapper` | Donut-scope a direct-child rule through `.abstract` wrappers |
| `details-animated-content` | The accordion's animated `::details-content` |
| `unanimated` | Kill motion (the opt-out) |

Module mixins (`module-button`, `module-card`, …) apply a whole module; a theme calls them all from `apply.css`.

## Further themes

`flat` and `paper` token files exist in the repository (`support/`) but are not published entries yet; they will swap in without markup changes because they only redefine tokens.
