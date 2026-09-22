# @use

Import JS modules directly in the sheet; pure functions are the sanctioned way for logic to enter a sheet.

## Importing

`as *` exposes exports bare; `as name` (or the name derived from the url) namespaces them:

```quark
@use "/helpers.js" as *;
@use "/api-client.js" as api;

#out {
  content: formatPrice(api.getAmount());
}
```

Imports start as soon as the sheet is parsed and load in parallel; the first rule run waits until they resolve. A failed import is logged and skipped. A `with (…)` clause is a parse error.

`quark:` URLs import Quark's own helpers without a fetch — `@use "quark:math";` derives the namespace `math` — see [Built-in modules](./MODULES.md). Reach for them before writing a module function of your own.

## Writing module functions

Exports are plain functions called from expressions (`formatPrice($amount)`), as `@on` handlers (`@on click (handle: addToCart)`, or a call evaluated per event: `@on click (handle: addToCart(element, event))`), or handed the matched node through `element`. Prefer pure functions; a function that needs to write State does it through [`element.quark`](./JS_WRITES.md) or by dispatching an event an `@on` block turns into attributes.
