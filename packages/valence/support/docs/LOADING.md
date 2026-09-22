# Loading

`aria-busy="true"` on almost any element shows a spinner before its content; on buttons and links it also blocks the pointer.

## Usage

<include-content data-demo="loading"></include-content>

```html
<button aria-busy="true">Saving…</button>
<button aria-busy="true"></button>       <!-- spinner only -->
<article aria-busy="true">Loading…</article>
```

The spinner is `--v-icon-loading` (`1em`); empty busy elements center it. Form controls (`input`, `select`, `textarea`) and `form` / `html` are excluded. Because the state is an attribute, a Quark rule sets it from any fact: `button { aria-busy: attr("is-loading") != null; }` or `provider-fetch[is-loading] button { aria-busy: "true"; }` (with its inverse).
