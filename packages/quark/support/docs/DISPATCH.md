# @dispatch / @command

`@dispatch` sends a custom event and `@command` invokes a command, from inside an `@on` block. They are the outgoing half of `@on`: the sheet heard an event, wrote State, and now tells another element.

```quark
todo-item {
  @on click (target: "[data-remove]") {
    @dispatch todo-remove (detail: (id: attr("data-id")));
  }
}
provider-fetch {
  @on super-form-success { @dispatch provider-fetch-trigger; }
}
button[data-help] {
  @on click { @command toggle-popover (target: element.nextElementSibling); }
}
```

<include-content data-demo="dispatch"></include-content>

## Where they may appear

Inside an `@on … { }` block, its nested rules (then the event goes out from each matching descendant) and a `@delay` block within it. Not at rule level and not at sheet level: a rule matching is not an occurrence, so a rule cannot announce one. The runtime logs an error and drops such a statement.

## When they run

At the end of the block, after every write in it has been queued and before those writes paint — synchronously, like a handler. An event is an occurrence, not a delivery of State: a listener that needs the block's writes should react to the State the block wrote (an attribute the recipient's own rule selects on), not to the event. Dispatching the enclosing `@on` event type is refused. Every dispatch is one [loop-guard](./LOOP_GUARD.md) hop, so an event cycle (`@on a { @dispatch b } … @on b { @dispatch a }`) is cut like a write cycle.

## `@dispatch`

`@dispatch <event>[, <event>] [(options)];` — a `CustomEvent` per name. Options are evaluated per event, in the block's scope (`event`, `target`, `element`, `$bindings`):

| Option | Effect |
| --- | --- |
| `detail: <expression>` | The event's `detail` — a map `(id: $id, at: event.timeStamp)`, a `$binding`, anything. |
| `target: "<selector>"` | Dispatch on every element matching the selector in the element's document (or shadow root). **`:scope` is the block's element — the one the `@on` matched — not the sheet's `:scope` host.** Resolved exactly as `<event-handler target-ref>` is (`selectAll` from kit-utils): `provider-fetch:has(+ :scope)` is the `provider-fetch` right before the element, `:scope + dialog` the dialog right after it. Default: the block's element. |
| `target: <element>` / `<list>` | An element or list of elements from an expression: `closest("provider-fetch")`, `element.nextElementSibling`, `closest("section").children`. |
| `host: window` / `host: document` | Dispatch on the window / document instead. |
| `form: "<selector>"` / `form: <form>` | The form's field values (as `formToJson` reads them) become the detail; an explicit `detail` map merges over them. |
| `bubbles` / `cancelable` / `composed` | Event flags. Bare means `true`; `bubbles: false` switches one off. Defaults: bubbles and cancelable on, composed off. |

An unmatched `target` warns once per element and sends nothing. Events bubble by default, so an ancestor's sheet hears a dispatch from a descendant without any `target`.

## `@command`

`@command <name>[, <name>] [(target: …)];` — invokes each command on the target elements the way a `<button command="…" commandfor="…">` would. Native commands — `show-modal`, `close`, `request-close`, `show-popover`, `hide-popover`, `toggle-popover` — and custom ones, which start with `--` and reach the target as a `command` event (`event.command`; `event.source` is the invoker — under the Command API the hidden button Quark clicks, so a recipient should read State from itself or the sheet rather than from `source`; without the API, the block's element).

```quark
[data-open-help] { @on click { @command show-modal (target: "#help"); } }
#help { @on keydown (key: "Escape") { @command close; } }
[data-refresh] { @on click { @command --refresh (target: "#feed"); } }
```

Where the browser has the Invoker Commands API, a hidden invoker button carries the command so native behaviour and `event.source` are exactly the platform's. Elsewhere, custom commands are dispatched as a synthetic `command` event and native ones call the element's method (`showModal()`, `togglePopover()`, …); an unknown native command warns once. `target` is the only option and resolves like `@dispatch`'s: the whole document, `:scope` = the block's element (not the sheet host).

```quark
:scope {
  button {
    @on click {
      /* the provider-fetch right before this button */
      @command --fetch (target: "provider-fetch:has(+ :scope)");
    }
  }
}
```

A nested rule starting with a sibling combinator is the other spelling: `+ provider-fetch { @command --fetch; }` inside the block runs against the `provider-fetch` right after the button, with no `target` to resolve.

```quark
:scope {
  button {
    @on click {
      + provider-fetch { @command --fetch; }
    }
  }
}
```

## Replacing `<event-handler>`

`@on` with `@dispatch` / `@command` covers what `<event-handler>` wires: `listen-for` is the event list, `selector-filter` / `keycode-filter` / `is-debounced` / `host-ref` are options, `fire-event` + `detail-*` + `form-ref` are `@dispatch (detail: …, form: …)`, `target-ref` is `target:`, `command-name` is `@command`. Prefer the sheet when the page has one; keep the element for markup without a sheet.
