# CSS variables

`--custom-prop:` declarations write CSS custom properties on matched elements (inline style), so stylesheets consume Quark state via `var()` — computed colors, progress percentages, live theming. Values that attribute selectors can't express.

## Writing custom properties

<include-content data-demo="css-variables"></include-content>

- Values are Quark expressions — **CSS literals must be quoted**: `--accent: "#ccc"`, not `--accent: #ccc`. Same for keywords, lengths, and functions: `"red"`, `"10px"`, `"var(--x)"`, `"red !important"` (a trailing `!important` inside the string maps to the priority argument).
- Numeric expression results work: `--progress: "#{($done / $total * 100)}%"`.
- Wipe values (`none` / `undefined` / `null`) remove the property; `preserve` no-ops.
- Write-only: Quark never reads CSS variables back. Own the value in a `$variable` if rules need to react to it.

## No reversion

Like every other write, a CSS variable persists after its rule stops matching — write the inverse rule (see [No reversion](./NO_REVERSION.md)).
