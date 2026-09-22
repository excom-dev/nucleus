# Sheets & scoping

A sheet lives next to the elements it orchestrates; its rules reach the host's subtree and nothing else, exactly like an inline `<style>` with `@scope`.

## Loading a sheet

App authors almost always load Quark through `<quark-sheet>`:

```html
<section>
  <quark-sheet>
    details[open] [bind-status] {
      content: "Open";
    }
    details:not([open]) [bind-status] {
      content: "Closed";
    }
  </quark-sheet>
  <details>
    <summary>Panel</summary>
    <span bind-status></span>
  </details>
</section>
```

Sheets can also be fetched (`<quark-sheet src-url="/views/app.quark">`) or constructed programmatically — see [JS API](./JS_API.md).

## Scoping

By default (`<quark-sheet>` without `is-global`, or the `isScoped` constructor option), sheets are implicitly wrapped in `@scope { … }`, anchored at the host (the sheet's parent element) — the same model and semantics as CSS inline-`<style>` scoping. Global sheets (`<quark-sheet is-global>`) skip the wrap: top-level rules run in the root context — e.g. to read a provider that is an ancestor of the host — and rules the author nests in an explicit `@scope { }` block stay host-scoped. Every part of a selector matches strict descendants of the host: an ancestor compound (e.g. the `provider-fetch[is-success]` in `provider-fetch[is-success] h4`) is only satisfied by an element *inside* the host, never by the host itself or anything above it. The host is reachable only via the explicit `:scope` selector:

```quark
:scope { data-app: "ready"; }             /* mutate the host itself */
:scope[data-mode="on"] [bind-x] { … }     /* react to host state */
```

Registered hosts carry a generated `q-scope="<id>"` attribute — Quark's scoping anchor. Treat it as internal: don't set, copy, or select on it.

## What runs

A sheet is minified (comments stripped, whitespace collapsed), optionally wrapped in `@scope { … }` (see above), and parsed. The runtime then executes:

- **Rules**, nested to any depth. A nested selector is joined to its parent as a descendant, or spliced over each `&`.
- **Declarations inside rules**, by key shape (see [Declaration kinds](./DECLARATIONS.md)).
- **`@use "url" [as name | as *]`** anywhere in the sheet. The namespace defaults to the URL's last path segment without its extension (`/api-client.js` → `api-client`); `as *` merges exports into the bare scope, last import winning on clashes. A `with (…)` clause is a parse error.
- **`@scope { … }`**, which takes no prelude: rules inside stay anchored to the host in a global sheet.
- **`@on <event> [(options)] …;`** inside rules: listeners (see [`@on`](./ON.md)).
- **`@view-transition [(options)] { … }`** inside rules, around rules or inside `@on` blocks: the writes inside it commit inside a view transition (see [`@view-transition`](./VIEW_TRANSITION.md)).
- **`@delay <ms> { … }`** inside rules and blocks: the block applies once, after the pause, if the rule still matches (see [`@delay`](./DELAY.md)).
- **`@warn` / `@debug` / `@error <expression>;`** inside rules and blocks: report on the matched element (see [Diagnostics](./DIAGNOSTICS.md)).

That list is the language: any other at-rule, a nested property block, a `%placeholder` selector, `#{…}` outside a string, and `!important` / `!default` / `!global` are parse errors, and a sheet that fails to parse does not run (`<quark-sheet>` sets `is-error`). Top-level declarations parse but have no element to write.

```quark
@use "/helpers.js" as *;
main {
  $items: prop("provision").body;
  ul {
    content: iterate($items);
    li { data-id: item.id; &[data-id="0"] { is-first: ""; } }
  }
}
```

## Load order

Imports (`@use`) and `src-url` sheets resolve before the first rule run, so a sheet that registers late misses events fired meanwhile — react to state attributes (`is-*`) rather than one-shot events, and put the sheet first in its host when it must hear boot-time events.
