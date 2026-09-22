# Built-in functions

Available in every expression, after `@use` exports: element reads, loop context, rendering, listeners, utilities.

## Reference

*Generated.*

<!-- generated:builtin-functions -->
**Element reads**

| Name | Description |
| --- | --- |
| `attr("name")` | The matched element's attribute value (`null` when absent). `attr("content")` returns its `innerHTML`. A literal name is observed: the rule re-runs when that attribute changes, even if it is not in the selector. `attr($name)` reads but does not subscribe. |
| `prop("name")` | The matched element's JS property (`prop("provision")` reads a Neutron provision). A literal name is observed: the rule re-runs when JS assigns `element.name` (coalesced per microtask). In-place mutation and browser-driven native state are not observed. `prop($name)` reads but does not subscribe. |
| `closest("selector")` | `element.closest(selector)` from the matched element: the nearest ancestor-or-self matching the selector, else `null`. Not observed. |
| `element` | The matched element itself — the node the rule is applied to (inside an `@on … { }` block the listening element; `target` is the delegate). Hand it to `@use` functions that need the node: `@on click fire(element)`, `$chart: mount(element)`. Reads through it are not observed — use `attr()` / `prop()` for reactive reads. |

**Loop context**

| Name | Description |
| --- | --- |
| `item` | Inside an `iterate()` row: the current collection item (the value for objects). `undefined` outside a row. |
| `index` | Inside an `iterate()` row: the current position (the key for objects). `undefined` outside a row. |

**Rendering (`content`)**

| Name | Description |
| --- | --- |
| `iterate(collection, "template-ref"?, "key-property"?)` | For `content`: renders one clone of the element's `<template>` child (or the template at `template-ref`, a selector / URL) per array item or object entry, keyed by `key-property` (else a content hash) so existing rows are reused. `null` / `undefined` wipes the rows; an empty collection clears them; a non-collection no-ops. |
| `template("template-ref"?)` | For `content`: renders one clone of the referenced `<template>` (selector or URL; defaults to the element's own `<template>` child). |
| `dangerous-html(html)` | For `content`: sets `innerHTML` to the string. No sanitizing: never pass user-controlled markup. |

**Event listeners**

| Name | Description |
| --- | --- |
| `event` | Inside an `@on … { }` block, its per-event options and its `@dispatch` / `@command` statements: the DOM event being handled (`event.target`, `event.detail`, …). `undefined` elsewhere. |
| `target` | Inside an `@on … { }` block and its per-event options: the element the `target:` option matched (the delegate), or `event.target` without that option. `undefined` elsewhere. |
| `prevent-default` | A listener that calls `event.preventDefault()`, for `handle:`. The `(prevent-default)` flag is the shorter form. |
| `stop-propagation` | A listener that calls `event.stopPropagation()`, for `handle:`. The `(stop-propagation)` flag is the shorter form. |

**Utilities**

| Name | Description |
| --- | --- |
| `ternary(condition, whenTrue, whenFalse?)` | `whenTrue` if `condition` is truthy, else `whenFalse` (`null` when omitted). Prefer `if()` for multi-arm conditionals. |

**Debugging**

| Name | Description |
| --- | --- |
| `log(...values)` | Logs the values to the console and returns them as an array. |
| `debug(...values)` | Hits a `debugger` statement and returns the values as an array. |
<!-- /generated -->

Reading the matched element's JS properties and handing the node to module functions: [Element properties](./ELEMENT_PROPERTIES.md). Methods callable on values: [Allowed methods](./METHODS.md).
