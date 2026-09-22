# Element properties

`prop("<name>")` reads a JS property of the matched element and re-runs when JS assigns it — the way a sheet reads an Adapter's `provision`.

## `prop()`

`prop("<name>")` reads a JS property of the **matched element**; it mirrors `attr("<name>")`. `prop("provision")` reads a Neutron element's provision:

```quark
provider-fetch[is-success] {
  $todo: prop("provision").body;
  [bind-title] { content: $todo.title; }
}
```

A literal `prop("x")` subscribes to `x`: the rule re-runs when JS assigns `element.x` (assignments coalesce per microtask). In-place mutation of an object is not observed — assign a new object. Changes the browser makes without a JS assignment (a user typing into an `<input>`'s `value`, a `<details>` toggling `open`) are not observed either: select on the reflected attribute / listen for the event. `prop($name)` reads but does not subscribe.

## Reading an ancestor provider

`prop()` reads the matched element only. To read an ancestor provider, publish it as a binding from a rule that matches the provider — in a parent sheet whose host contains it (preferred) or an `is-global` sheet — and read the `$binding` from descendants:

```quark
provider-fetch[is-success] { $todos: prop("provision").body; }
[bind-count] { content: $todos.length; }
```

## `element`

`element` is the matched element itself — the way to hand the node to a module function (a handler factory, a chart mount) without a selector walk. Reads through it are not observed; use `attr()` / `prop()` for those:

```quark
[data-chart] { $chart: mountChart(element, $series); }
button[data-sku] { @on click (handle: addToCart(element, event)); } /* evaluated per click */
```
