# @warn / @debug / @error

Diagnostics report from inside a rule; the selector is the condition. Nothing is written to the document.

## Writing diagnostics

```quark
img:not([alt]) { @warn "img needs alt"; }
form button:not([type]) { @warn "button defaults to type=submit"; }
provider-fetch[is-error] { @error "fetch failed", prop("provision").error; }
todo-list {
  $todos: prop("provision").body;
  @debug "todos", $todos.length;                    /* again when $todos changes */
  @on todo-remove { @debug "remove", event.detail.id; }
}
```

Each statement evaluates its expression on the matched element — bindings, `attr()`, `prop()`, `event` inside an `@on` block, module functions — and reports it. A comma list reports one value per item; a single expression is one value, even when it is a list.

## When it speaks

- `@warn` and `@error` speak **once per element and rule**. A warning repeated on every re-run is noise; a new offending element is its own warning.
- `@debug` speaks **on every application**, so it re-logs when a binding or `prop()` it reads changes — a trace of the value over time.
- A failing expression reports a `quark/error` (like any declaration) instead of a diagnostic.
- Outside a rule there is no element to evaluate against: a top-level statement is rejected when the sheet is built.

## Where it goes

- The console, at the matching logger level: `Quark @warn (img:not([alt])): img needs alt`. `@debug` is silent unless Quark logs at debug level (`VITE_LOG_LEVEL` ≥ 3).
- The DevTools hook, as `["quark", "diagnostic"]` — `level`, `values`, `message`, `expression`, the selector, rule and element — so the Nucleus DevTools extension and the agent tools can list them next to the rule. See [JS API](./JS_API.md).

Use `@warn` for invariants a sheet can state better than a test (`img:not([alt])`, `button:not([type])`), `@error` for States that should never occur, and `@debug` while developing a rule — then remove it. The `log()` and `debug()` built-ins remain for tracing inside an expression.
