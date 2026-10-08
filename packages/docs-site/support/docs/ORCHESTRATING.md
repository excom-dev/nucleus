# Orchestrating

Quark is the Orchestrator: it observes the document and writes back into it. It is a derivative of CSS, written in CSS syntax. Selectors, nesting, declarations and comments are CSS's own. The few additions Quark makes — variables, expressions, and at-rules of its own (`@use`, `@scope`, `@on`, `@dispatch`, `@command`, `@view-transition`, `@delay`, `@warn`, `@debug`, `@error`) — stay compatible with that syntax, so anyone who can read a stylesheet can read a sheet. What differs is the runtime: a stylesheet paints, a Quark sheet writes State. Features of the browser's style engine, such as media queries and keyframes, stay in your stylesheet.

## A sheet and its host

Put a `<quark-sheet>` next to the markup it should govern. The parent of that sheet is the **host**; every rule matches only inside it.

```html
<section>
  <quark-sheet>
    details[open] [bind-status] { content: "Open"; }
    details:not([open]) [bind-status] { content: "Closed"; }
  </quark-sheet>
  <details>
    <summary>Panel</summary>
    <span bind-status></span>
  </details>
</section>
```

Scoping is identical to CSS `@scope`: selectors match strict descendants of the host. Reaching the host itself requires `:scope`.

```quark
:scope { data-ready: ""; }                  /* write to the host */
:scope[data-mode="edit"] [bind-x] { … }     /* react to host state */
```

- `src-url="/views/app.quark"` pulls the sheet from a file rather than inline text.
- `is-global` drops scoping so top-level rules run against the entire document. Use it sparingly, and nest rules inside an explicit `@scope { }` block wherever a region should stay host-scoped.
- Like many other elements, the sheet reflects its state: `is-loading` / `is-success` / `is-error`.

## Selectors

Quark rides the native selector engine, so whatever CSS can match, Quark can match — `:is()` / `:where()` / `:not()`, `:has()`, sibling combinators (`+`, `~`), structural pseudo-classes (`:nth-child()`, `:first-child`, `:empty`) and attribute-backed ones (`:disabled`, `:required`, `:lang()`) included. What Quark adds is observation: a rule re-runs when an attribute, class or id it names changes anywhere on its path — an ancestor, an earlier sibling, a `:has()` descendant — and when elements are inserted or removed where its match depends on them. The gaps are selector features backed by state the DOM does not reflect: interaction and validity pseudo-classes (`:hover`, `:focus`, `:checked`, `:invalid`) match on the first run only, and the sheet warns at build. Nesting works like CSS, and `&` means the current selector. See the related section under [Limitations](/docs/limitations).

```quark
/* an aggregate over the rows becomes a fact on the host — no JS, no observer element */
:scope:has(li[data-is-selected]) { data-has-selection: ""; }
:scope:not(:has(li[data-is-selected])) { data-has-selection: none; }
```

```quark
provider-fetch[is-success] {
  $user: prop("provision").body;
  h3 { content: $user.name; }
  &[data-admin] h4 { content: "Admin"; }
}
```

Select on state, not on classes: attribute changes re-run Quark (attributes in the selector, and names read via literal `attr("x")`), as do JS property assignments read via literal `prop("x")`. Classes and ids named in a selector re-run it too, but setting attributes is recommended over toggling / mutating classes and ids, since the latter has a heavier impact on Quark's performance. `attr($name)` / `prop($name)` do not subscribe.

## Writing attributes

A property that is not a keyword becomes an attribute. `none` removes it. Booleans are `""`.

```quark
dialog[open] input { autofocus: ""; }
dialog:not([open]) input { autofocus: none; }
li[data-done] { aria-checked: "true"; }
```

Grouped-attribute helpers: `dataset` and `ariaset` accept a map and write `data-*` / `aria-*` attributes; `class` accepts a string, a list, or a map of `name: boolean`.

### Form controls

On `<input>`, `<option>` and `<textarea>` the markup only describes the *default*: the `value` / `checked` / `selected` attributes and a textarea's text. Once a user has interacted with a control, the browser stops mirroring those attributes into the live `.value` / `.checked` / `.selected` (the spec's "dirty" flags), so an attribute write alone would not show.

Quark papers over this. The attribute stays the authoritative, serializable State, and whenever a rule writes `value:` / `checked:` on an `<input>`, `selected:` on an `<option>`, or `content:` on a `<textarea>`, the live property is set to match. There is no property-write syntax and nothing new to learn: an edited control simply follows the rule again.

```quark
:scope[data-source="fahrenheit"] [bind-celsius] input {
  value: (($fahrenheit - 32) * 5 / 9).toFixed(1); /* wins over what the user typed */
}
form[data-reset] input[type="checkbox"] { checked: none; } /* attribute removed, box unchecked */
```

- The sync happens only when the rule writes. An edited control stays edited until a rule matching it re-runs; a re-run that resolves to the value the attribute already holds still restores the control.
- It is one-way. Typing never touches an attribute, so nothing re-runs on keystrokes. Reflect what you need as state through events (an `@on input { data-draft: event.target.value; }` block writing a `data-*` attribute is the idiom, see [Events](#md-events)) and select on that.
- Custom elements are not touched; they own their own reflection. `<select>` has no `value` attribute: write `selected:` on its options.

## Content

```quark
[bind-title] { content: $article.title; }                         /* text */
article { content: template("#article-tmpl"); }                   /* clone a <template> */
aside { content: template("/views/aside.html"); }                 /* fetch a fragment */
[bind-body] { content: dangerous-html(markdown($article.body)); } /* trusted HTML string */
details:not([open]) p { content: none; }                          /* clear */
```

A module function may also return a `Node` or `NodeList` it built. That is how a chart or another third-party widget reaches the page: the function creates its own element, renders into it and returns it. It needs no matched element: it creates its own.

```quark
[bind-chart] { content: createChart($series); }
```

## Variables

`$variables` work like CSS custom properties. A declaration stores the value on each matched element; a consumer walks upward from its own element to the nearest ancestor that holds it. They cascade across sheets, and the nearest binding wins.

```quark
main {
  $theme: "dark";
  [bind-theme] { content: $theme; }
}
[bind-theme-anywhere] { content: $theme; }   /* resolves if inside <main> */
```

Storage is per element, so writers that share a name collide (last writer wins). Namespace application variables: `$app-theme`, `$cart-total`.

A declaration on a descendant shadows the ancestor's binding rather than updating it. To raise state, write it on the owner: an `@on` block on the owner rule with `target:` delegation (see [Events](#md-events)), or, from JavaScript, `element.quark.setProperty(name, value)` on the owner element — every element has `element.quark`, shaped like `element.style` (`setProperty`, `setProperties`, `removeProperty`, `getPropertyValue`). The element written to becomes the owner; readers below it re-run in every sheet. It is State, not an event: a value written before a sheet registers is read on its first run. Keep one writer per name per element, and reflect primitives that CSS or a selector should see into attributes instead.

Keywords:

- `none` → removes the target attribute / clears content.
- `preserve` → explicit no-op; leaves whatever is already there. Useful while data is still loading: `content: $todo.title or preserve;`
- `unset` → variables only; deletes the binding so consumers fall through to an ancestor.
- An expression that resolves to `null` / `undefined` wipes its target. A failed expression **never** wipes; it logs and does nothing.

## Expressions

Values are Quark expressions, not JavaScript. They are derived from CSS expressions. Quote strings; a number with a unit (`10px`) is a string; `+ - * / %` and comparisons behave as you would expect; `and` / `or` short-circuit; member access on a missing value yields `undefined` instead of throwing. Prefer `#{$x}` interpolation over `+` when building strings.

```quark
[bind-count] { content: "Items: #{$items.length}"; }
#my-price { content: "#{($price * 1.2).toFixed(2)} EUR"; }
[bind-field="status"] { content: if($n == 0: "none"; $n > 3: "many"; else: "few"); }
```

Use `if()` for a one-off value. When several rules would branch on the same condition, write the condition to the document once (`data-is-empty: $n == 0;` — a boolean writes `""` or removes the attribute) and select on `[data-is-empty]` instead; see [Best Practices](/docs/best_practices).

Method calls on values are limited to a read-only allowlist (`toUpperCase`, `slice`, `join`, `toFixed`, `getAttribute`, `closest`, …). Expressions may compute and read; they may not cause side effects. Logic they cannot express belongs in a module function (see [Modules](#md-modules)); anything that reaches the network, storage or the clock belongs in an Adapter.

## Element properties

`prop("<name>")` reads a JS property of the element the rule matches against; it mirrors `attr("<name>")`. `prop("provision")` reads the provision an element publishes.

```quark
provider-fetch[is-success] {
  $todo: prop("provision").body;
  h1#title { content: $todo.title; }
}
```

A rule that reads a literal `prop("x")` re-runs when JS assigns `element.x` (assignments coalesce per microtask). In-place mutation of an object is not observed — assign a new one. Changes the browser makes without a JS assignment (typing into an `<input>`'s `value`, a `<details>` toggling `open`) are not observed either: select on the reflected attribute / listen for the event. `prop($name)` reads but does not subscribe.

`element` is the matched element itself, for the rare expression that needs the node: `@command toggle-popover (target: element.nextElementSibling)` in an `@on` block toggles the popover that follows it. Reads through it are not observed.

`prop()` reads the matched element only. To read an ancestor provider, publish it as a binding from a rule that matches the provider — in a parent sheet whose host contains it (preferred) or an `is-global` sheet — and read the `$binding` from descendants:

```quark
/* shell sheet: its host contains <spa-manager> */
spa-route { $route-data: prop("provision"); }

/* any descendant view */
provider-fetch { api-url: "/api/users/#{$route-data.params.id}"; }
```

## Iterations

`iterate(array or object)` stamps one copy of the element's `<template>` per item, as siblings of that template. Inside each row, `item` and `index` are available to any rule — not only nested ones.

```html
<ul>
  <template>
    <li><span bind-title></span></li>
  </template>
</ul>
```

```quark
provider-fetch[is-success] {
  $todos: prop("provision").body;
  ul { content: iterate($todos); }
  li [bind-title] { content: "#{index}. #{item.title}"; }
}
```

## Events

`@on <events> [(options)] { … }` inside a rule listens on the matched elements — one event name, or a comma list — and applies the block once per event. With options the block is optional; the flags `prevent-default` and `stop-propagation` are options, and JS handlers are the `handle:` option.

```quark
form { @on submit (prevent-default) { is-submitted: ""; } }   /* the flag, then the writes */
a[data-external] { @on click (stop-propagation); }            /* options alone */
```

The block makes the event a one-shot transaction: a normal rule body, applied when the event fires instead of when the rule matches. Declarations write the matched element, nested rules write its matching descendants, and `event` is the DOM event. This is how user input becomes State without JavaScript:

```quark
:scope {
  $count: +attr("data-count");
  @on counter-increment { data-count: $count + 1; }            /* event → attribute */
  @on input, change { data-draft: event.target.value; }          /* typing → attribute */
  @on change { #panel { is-active: if(event.target.checked: ""; else: none); } }
}
```

Writes batch like any rule's, `$variables` set in a block persist on the element, and `preserve` skips a field you do not want to touch. `@on` inside a block is not supported.

### Listener options

The options group after the events is a map — `name: value` entries and bare flags — that filters and configures the listener: the same gates `<event-handler>` offers (`selector-filter`, `keycode-filter`, `is-debounced`, `host-ref`), written in the sheet:

```quark
ul { @on click (target: "li[data-id]") { data-selected: target.getAttribute("data-id"); } }  /* delegation */
dialog[is-open] { @on keydown (key: "Escape", host: window) { is-open: none; } }             /* global key */
form { @on input (debounce: 300) { data-query: event.target.value; } }                        /* typing settles */
main { @on scroll (throttle: 100, passive) { data-is-scrolled: event.target.scrollTop > 0; } }
a[data-external] { @on click (self, once, prevent-default); }
```

| Option | Effect |
| --- | --- |
| `target: "<selector>"` | Fire only when the event target is inside a matching descendant; that element is `target` in the block (`event.target` otherwise). |
| `self` | Fire only when the event target is the matched element itself. |
| `key: "Escape"` / `"Shift+K"` | Keyboard chord; space-separated tokens are alternatives. |
| `prevent-default` / `stop-propagation` / `stop-immediate-propagation` | Act on the event once it passes the filters. |
| `debounce: <ms>` / `throttle: <ms>` | Wait for a pause / at most once per window. |
| `handle: fn` | A JS listener: a function, a list `(a, b)`, or a call that returns one. Called with the event before the block, `this` being the element. |
| `once` | Detach after the first event that passes the filters. |
| `passive` / `capture` | Native listener options. |
| `host: window` / `host: document` | Listen there while the element is in the document. |

`target`, `key`, `debounce` and `throttle` are evaluated when the event fires, in the block's scope: `event`, `target`, `element` and the element's current `$bindings`. `handle:` is evaluated on every event too, so it reads current `$bindings`, but its value is the listener itself: `event` and `target` are not in its scope, because the listener receives the event. A call in `handle:` is a factory that must return the listener, and it runs on every event. Keep `handle:` for imperative DOM work Quark has no declaration for, such as moving focus once content renders:

```quark
include-content { @on include-content-did-render (handle: focusInput); }
```

Two `@on`s for one event may coexist when their options differ. There is no `@off`: rather than removing a listener, gate it — with options, or with `event` data and `preserve` inside its block.

### Dispatching events and commands

`@dispatch` and `@command` inside an `@on` block send an event or a command from it — the outgoing half of `@on`, and what `<event-handler>`'s `fire-event` / `command-name` do:

```quark
provider-fetch { @on super-form-success { @command --fetch; } }
todo-item { @on click (target: "[data-remove]") { @dispatch todo-remove (detail: (id: attr("data-id"))); } }
[data-help] { @on click { @command toggle-popover (target: element.nextElementSibling); } }
```

`detail:`, `target:` (a selector resolved like `<event-handler target-ref>` — `:scope` is the block's element, not the sheet's host — or an element from an expression), `host: window | document`, `form:` and the flags `bubbles` / `cancelable` / `composed` are the `@dispatch` options; `@command` takes `target:` and invokes native (`show-modal`, `close`, `toggle-popover`, …) or custom `--commands`. Both run at the end of the block, after its writes are queued — the event is an occurrence, not a delivery of State, so a recipient that needs the new State should select on it. Not allowed at rule level: a rule matching is not an occurrence.

## Modules

Functions come from modules imported with `@use`, for expressions and for `handle:`. Imports begin as soon as the sheet parses, load in parallel, and the first rule run waits for them.

```quark
@use "/helpers.js" as *;    /* bare exports */
@use "/utils.js" as utils;  /* namespaced */

[bind-total] { content: formatPrice(utils.total($items)); }
```

A module should be pure business logic: values in, a value out. It is also the exit for anything Quark cannot yet declare. Bridging a protocol, such as the network, storage, the clock or a person, belongs to an Adapter, which carries the result as attributes and a provision. Quark leans that way on purpose: it calls module functions synchronously and does not await what they return, so a fetch inside a module is deliberately awkward. A function may build and return a node it owns, like the chart under [Content](#md-content), and fill it once its work finishes (see [Asynchronous work](/packages/quark/use#md-asynchronous-work)); it should still leave the document around it alone.

Before writing a helper, check the built-in modules: `@use "quark:math"`, `quark:list`, `quark:map`, `quark:string`, `quark:date`, `quark:url` and `quark:util` ship pure functions for the derivations views need most — clamping, sorting and grouping a list by a dot path, counting, plurals, dates, query strings — imported like any module and never global:

```quark
@use "quark:list" as list;
@use "quark:string" as *;

ul { content: iterate(list.sort-by(list.filter($todos, "completed", false), "title"), none, "id"); }
[bind-left] { content: plural(list.count($todos, "completed", false), (one: "# item left", other: "# items left")); }
```

## Delayed writes

`@delay <ms> { … }` applies a block once, after a pause — a "Copied!" flash, a toast that hides itself, an undo window — with no timer in JS. The timer restarts on every application of the rule (one per element), and the block is dropped if the element left the document or the rule stopped matching by the time it fires:

```quark
button[data-copy] {
  @on click {
    data-copied: "";
    @delay 2000 { data-copied: none; }     /* rapid clicks restart it */
  }
}
todo-item[is-pending-delete] {
  @on click (target: "[data-undo]") { is-pending-delete: none; }
  @delay 5000 { is-deleted: ""; }           /* undo clears the gate, the delete never lands */
}
```

The block is an ordinary rule body (`event` / `target` are kept inside an `@on` block), keeps the loop guard's causal depth, and its timers are cleared when the sheet unregisters. Time is otherwise an Adapter's protocol: `@delay` is for a wait that belongs to one State change, not for clocks or polling.

## Diagnostics

`@warn`, `@debug` and `@error` report from inside a rule; the selector is the condition, and nothing is written to the document:

```quark
img:not([alt]) { @warn "img needs alt"; }
provider-fetch[is-error] { @error "fetch failed", prop("provision").error; }
todo-list { $todos: prop("provision").body; @debug "todos", $todos.length; }   /* again when $todos changes */
```

`@warn` / `@error` speak once per element and rule; `@debug` speaks on every application. All three reach the console and the DevTools hook (`["quark", "diagnostic"]`), so the inspector and the agent tools list them next to the rule.

## Animating writes

Wrap writes in `@view-transition [(options)] { … }` and they commit inside `document.startViewTransition()`, so CSS animates the change — rows that leave included, which CSS transitions cannot reach. The block decides *how* its declarations and its nested rules' writes land, never *when* rules run:

```quark
provider-fetch[is-success] {
  $todos: prop("provision").body;
  @view-transition (types: "todo-change") {
    ul { content: iterate($todos, none, "id"); }
    [bind-count] { content: $todos.length; }
  }
}
```

```css
ul { view-transition-name: todos; }
li { view-transition-name: match-element; view-transition-class: todo; }
::view-transition-old(.todo):only-child { animation: todo-out 200ms; }
```

Every write of the same tick lands in the same cut, and the transition waits for Quark to settle before the new state is captured, so rows rendered by later rule passes are complete. Writes that change nothing, the sheet's first render, reduced motion and browsers without the API commit without a transition; so do writes while another transition runs (a route change), unless the block says `if-active: replace`. Options: `types`, `timeout`, `delay`, `first-render`, `if-active`, and `until: "<selector>"` to keep the transition open until the block's element matches — for short waits only, the page is frozen meanwhile. Styling recipes are in [Styling](/docs/styling) (*Animation*); the full option table is on the [quark `@view-transition`](/packages/quark/view_transition) page.

## CSS variables

`--custom-prop:` declarations write CSS custom properties onto the matched element's inline style, so stylesheets consume Quark state through `var()`. Values are expressions — quote CSS literals.

```quark
#loadingbar { --progress: "#{($done / $total * 100)}%"; }
main[data-theme="warm"] { --accent: "#c96"; }
```

Write-only: Quark cannot read CSS variables back. If rules need the value, own it in a `$variable`.

## No rule reversion

In CSS, a declaration stops applying the moment its selector stops matching. For the time being, **Quark rules do not revert.** Attributes, content, listeners, variables, and CSS variables all remain after the rule that set them stops matching. Write the counter-rule for every state you leave:

```quark
details[open] {
  aria-expanded: "true";
  --border: "red";
}
details:not([open]) {
  aria-expanded: "false";
  --border: "transparent";
}
```

This was by design. Quark does not own the document; anything can write an attribute outside its knowledge, so claiming to "unapply" a rule would not be guaranteed. Reversion may appear in a later version, with no guarantee.

## Load order

Load a sheet before the elements it listens to begin their lifecycles: put `<quark-sheet>` first inside its host, and prefer inline sheets for anything that must catch connect-time events — `src-url` and `@use` delay the first run until they resolve. Attribute-driven rules are safe either way — the first run reads the settled document — so when in doubt, react to a state attribute rather than a one-shot event.

## Pitfalls

- A rule that renders a template containing elements its own selector matches will recurse forever. Match the template's host with a dedicated attribute or a nesting-guarded selector like `section:not(section section)`.
- Assigning an unused `$variable` purely to invoke a side-effecting function is an anti-pattern. Give the behavior a real element and a real event.
- Changes more than a tick apart are separate runs; encode a transition as a single write when coherence matters, or wrap the writes in `@view-transition` when the change should animate.
- A `@view-transition` block holding only `$variable` writes never animates: variables do not paint. Put the declarations that write attributes and content inside the block.
- A Quark sheet is not a place to park CSS. A sheet that holds an at-rule Quark does not have (`@media`, `@supports`, `@keyframes`, …) or an `!important` fails to load and is left `is-error`. Keep those in the stylesheet and have both sides select on the same attributes.

More in [Troubleshooting](/docs/troubleshooting). The complete language reference lives on the [quark](/packages/quark) package page.

## Next steps

- [Quick Start - A working page, in five minutes.](/docs/quick_start)
- [Core Concepts - The mental model, in one sitting.](/docs/core_concepts)
- [Using Elements - The NucleusKit catalog and how elements behave.](/docs/using_elements)
- [Orchestrating - Get familiar with Quark.](/docs/orchestrating)
- [Styling - Valence.css themes, tokens, and state-driven CSS.](/docs/styling)
- [Building Views - Structure a real app: routes, views, lazy loading.](/docs/building_views)
- Other Guides - [Business Logic](/docs/business_logic), [Creating Elements](/docs/creating_elements), [Best Practices](/docs/best_practices), [Troubleshooting](/docs/troubleshooting), [Debugging with Agents](/docs/debugging_with_agents)
- [Diving Deeper - The architecture behind it all, for the curious and the skeptical.](/docs/diving_deeper)
