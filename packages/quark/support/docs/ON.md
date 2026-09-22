# @on

`@on` wires listeners inside a rule: one or more event names, an options group that filters and configures the listener, and a block applied once per event.

```quark
form {
  @on submit (prevent-default, handle: saveDraft($draft)) { is-submitted: ""; }
  @on input, change (debounce: 300) { data-draft: event.target.value; }
  @on keydown (key: "Escape", host: window) { is-open: none; }
}
```

The prelude says *when*: which events, which filters. The block says *what*: writes, `@dispatch` / `@command`, `@delay`. JS callouts are the `handle:` option. There is no handler list after the event names any more (`@on click go;` is a parse error that points at `handle:`).

## Events

`@on click`, `@on super-form-success`, `@on "my:event"` — a bare name or a string. A comma list shares one listener and one block: `@on input, change { … }`. `event.type` tells them apart inside the block.

## Blocks

`@on <events> [(options)] { … }` turns the event into a **one-shot transaction**: the block is an ordinary rule body, evaluated when the event fires instead of when the rule matches. Declarations write the matched element; nested rules write its matching descendants; `event` is the DOM event; `@dispatch` / `@command` statements fire after the writes are queued. It is how typed input, clicks and element events become State without JS:

```quark
:scope {
  $count: +attr("data-count");
  [bind-count] { content: $count; }
  @on counter-increment { data-count: $count + 1; }
  @on input {
    data-draft: event.target.value;
    #preview { content: event.target.value or preserve; }
  }
  @on submit (prevent-default) { is-submitted: ""; }
}
```

A nested rule whose selector starts with a sibling combinator writes the element's siblings instead of its descendants — `:scope { button { @on click { + provider-fetch { @command --fetch; } } } }` invokes `--fetch` on the `provider-fetch` right after the button.

Writes are batched like any rule's; `$variables` set in a block persist on the element. `@on` inside a block is not supported.

## Options

The **options group** after the events is a map: `name: value` entries and bare flags, which mean `true`. With options the block is optional — `@on submit (prevent-default);` is a complete statement. These are the same filters `<event-handler>` offers, in the sheet:

```quark
ul {
  @on click (target: "li[data-id]") { data-selected: target.getAttribute("data-id"); }
  @on keydown (key: "Escape", host: window) { is-open: none; }
  @on input (debounce: 300) { data-query: event.target.value; }
  @on scroll (throttle: 100, passive, handle: trackScroll);
  @on click (self, once, prevent-default);
}
```

| Option | Effect |
| --- | --- |
| `target: "<selector>"` | Delegation: fires only when the event target is inside a descendant matching the selector; that element is `target` in the block and in the other options (`event.target` otherwise). With `host:` the selector is matched document-wide. |
| `self` | Fires only when the event target is the matched element itself. |
| `key: "Escape"` / `"Shift+K"` | Keyboard chord; space-separated tokens are alternatives (`"Escape Enter"`). Listed modifiers (`shift`, `alt`, `ctrl`, `meta` / `cmd`) must be held. |
| `prevent-default` / `stop-propagation` / `stop-immediate-propagation` | Act on the event as soon as it passes the filters, before any timing. |
| `debounce: <ms>` / `throttle: <ms>` | Wait for a pause / run at most once per window (leading edge). Exclusive. |
| `handle: fn` | JS: a function, a call returning one, or a list `(a, b)` — each called with the event, `this` being the element, before the block. `prevent-default` and `stop-propagation` are also functions, for lists. |
| `once` | Detach after the first event that passes the filters. |
| `passive` / `capture` | Native `addEventListener` options. |
| `host: window` / `host: document` | Register on the window / document while the element is in the document; the listener lets go on the first event after the element is removed. |

### When values are evaluated

`target`, `key`, `debounce`, `throttle` and `handle` are expressions evaluated **when the event fires**, in the block's scope: `event`, `target`, `element` and the element's current `$bindings` are all in reach.

```quark
#list {
  $row: attr("data-row-selector");
  @on click (target: $row, handle: pick(target.getAttribute("data-id"), event)) { … }
}
```

So nothing about a listener is reactive — a changed `$row` is read by the next click, and no re-run ever re-registers the DOM listener. The flags, `once` and `host` configure the registration and are read once per match; they must be bare words.

Two `@on`s for one event may coexist when their options differ (`(key: "Escape")` and `(key: "Enter")`).

## Outgoing events

`@dispatch` and `@command` inside the block send events and commands from it — see [`@dispatch` / `@command`](./DISPATCH.md).

## No `@off`

There is no `@off`: a listener you would remove is a listener that should not fire — gate it with options or with event data inside its block. Listeners persist like any other write (see [No reversion](./NO_REVERSION.md)).
