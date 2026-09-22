# At-rules

Seven at-rules run: `@use` imports modules, `@scope` anchors rules, `@on` wires listeners, `@dispatch` / `@command` send events and commands from an `@on` block, `@view-transition` animates a block's writes, `@delay` defers a block, and `@warn` / `@debug` / `@error` report from a rule.

## Reference

`@on` takes a comma list of event names, an optional options group (a map: `name: value` entries and bare flags) and a block applied once per event — or just the options. `@dispatch` / `@command` take a name list and options, inside `@on` blocks only. `@delay` takes a duration expression and a block; `@warn` / `@debug` / `@error` take an expression. *Generated.*

<!-- generated:at-rules -->
| At-rule | Effect |
| --- | --- |
| `@use "url" [as name \| as *];` | Imports a JS module anywhere in the sheet. The namespace defaults to the URL's last path segment without its extension; `as *` merges exports into the bare scope, last import winning. A `with (…)` clause is a parse error. |
| `@scope { … }` | Rules inside stay anchored to the host in a global sheet (the implicit wrapper of a scoped sheet). It takes no prelude. |
| `@on <event>[, <event>] [(options)] { … }` | Inside a rule: listens for the events (bare names such as `click` or `super-form-success`, or strings; a comma list shares one listener) on the matched element and applies the block once per event — a one-shot transaction. The block is an ordinary rule body: declarations write the matched element (attributes, `$variables`, `--props`, `content`), nested rules write its matching descendants, or its siblings when the nested selector starts with `+` / `~`, `@dispatch` / `@command` statements fire after those writes are queued. `event` names the DOM event and `target` the delegate (or `event.target`) inside the block and in its per-event options. `@on` inside a block is not supported. |
| `@on <event> (option, option: value) …` | An options group after the events gates and configures the listener; with it the block is optional (`@on submit (prevent-default);`). A bare name is a flag. Filters: `target: "<selector>"` (delegation — fires only when the event target is inside a matching descendant; that element is `target` in the block), `self` (only when the event target is the matched element), `key: "Escape"` / `"Shift+K"` (keyboard chords; space-separated alternatives). Event flags: `prevent-default`, `stop-propagation`, `stop-immediate-propagation`. Timing: `debounce: <ms>`, `throttle: <ms>`. JS: `handle: fn` — a function (or a call returning one, or a list `(a, b)`) called with the event before the block, `this` being the element. Registration: `once` (removed after the first event that passes the filters), `passive`, `capture`, `host: window` / `host: document` (listen there while the element is connected; `target` then resolves against the whole document). `target`, `key`, `debounce`, `throttle` and `handle` are evaluated when the event fires, in the block's scope; the rest once per match. Two `@on`s for one event may coexist when their options differ. |
| `@dispatch <event>[, <event>] [(options)];` | Inside an `@on` block (or a nested rule / `@delay` block within one): dispatches a `CustomEvent` of each name from the block's element after the block's writes are queued — synchronously, before they paint, so the event is an occurrence, not a delivery of State. Options, evaluated per event: `detail: <expression>`; `target: "<selector>"` (every match in the element's document; `:scope` = the block's element, not the sheet host — resolved as `<event-handler target-ref>` is) or `target: <element \| list>` (`closest("provider-fetch")`); `host: window` / `host: document`; `form: "<selector>"` or `form: <form>` (its field values become the detail, an explicit `detail` map merges over them); the flags `bubbles` (default true), `cancelable` (default true), `composed` (default false), each settable to `false`. Dispatching the enclosing `@on` event is refused; every dispatch is one loop-guard hop, so an event cycle is cut. Not allowed at rule level: a rule matching is not an occurrence. |
| `@command <name>[, <name>] [(target: …)];` | Inside an `@on` block: invokes each command on the target elements (the block's element by default; `target` as for `@dispatch`) the way a `<button command commandfor>` would — native commands (`show-modal`, `close`, `request-close`, `show-popover`, `hide-popover`, `toggle-popover`) and custom `--names`, which reach the target as a `command` event. Where the browser lacks the Invoker Commands API, custom commands are dispatched as a synthetic `command` event and native ones call the element's method. Only `target` is an option. |
| `@view-transition [(options)] { … }` | Inside a rule, around rules, or inside an `@on` block: every paint of the writes in the block — its declarations (on the rule's element) and its nested rules' — commits inside `document.startViewTransition()`, so CSS animates the change (`view-transition-name`, `::view-transition-*`). It scopes *how* writes land, never *when* rules run. The transition waits for Quark to settle before the new state is captured, so writes that react to these land in the same cut. Committed without a transition: writes that change nothing, the sheet's first render, `prefers-reduced-motion: reduce`, browsers without the API, and writes while another view transition is active. |
| `@view-transition (option, option: value) { … }` | `types: "a b"` names the transition for `:active-view-transition-type()` (a string or a list). `timeout: <ms>` caps the settle wait (default 300). `delay: <ms>` holds these writes back first. `first-render` also animates the sheet's first render. `if-active: skip \| replace`: while another transition runs, commit unanimated (default) or start anyway, which skips the running one. `until: "<selector>"` keeps the transition open until the block's element matches the selector, `until: <promise>` until it settles (default timeout 1000; the page is frozen meanwhile, so for short waits only). Values are evaluated per write. |
| `@delay <ms> { … }` | Inside a rule or an `@on` / `@delay` block: applies the block once, `<ms>` milliseconds (an expression) after the rule applied or the event fired — provided the element is still in the document and the rule still matches; otherwise the block is dropped. Applying the rule again restarts the timer (one per element). The block is an ordinary rule body (declarations write the matched element, nested rules its descendants; `event` / `target` are kept inside an `@on` block). Timers keep the loop guard's causal depth and are cleared when the sheet unregisters. |
| `@warn <expression>; / @debug <expression>; / @error <expression>;` | Inside a rule or a block: evaluates the expression on the matched element and reports it — to the console at that level (`@debug` is silent below debug logging) and to DevTools as `quark/diagnostic`. The selector is the condition (`img:not([alt]) { @warn "img needs alt"; }`). `@warn` / `@error` speak once per element and rule; `@debug` speaks on every application, so it re-logs when a binding or `prop()` it reads changes. A comma list reports one value per item. |
<!-- /generated -->

```quark
form {
  @on submit (prevent-default, handle: saveDraft);
  @on keydown (key: "Escape") { is-editing: none; }
  @on reset { @dispatch draft-cleared (target: "#status"); }
  &:not([is-locked]) { @on input (debounce: 200) { data-draft: event.target.value; } }
  button[data-copy] { @on click { data-copied: ""; @delay 2000 { data-copied: none; } } }
  img:not([alt]) { @warn "img needs alt"; }
}
```

## Pages

- [`@use`](./USE.md) — JS modules
- [`@on`](./ON.md) — events, blocks, options
- [`@dispatch` / `@command`](./DISPATCH.md) — outgoing events and commands
- [`@view-transition`](./VIEW_TRANSITION.md) — animated writes
- [`@delay`](./DELAY.md) — deferred writes
- [`@warn` / `@debug` / `@error`](./DIAGNOSTICS.md) — diagnostics
- `@scope` — see [Sheets & scoping](./SHEETS.md)

That is the whole set. Any other name — CSS's `@media`, `@supports`, `@keyframes`, SCSS's `@if`, `@mixin`, … — is a parse error (`@media is not a Quark at-rule`).
