# listenable-element

Declarative event and lifecycle listening for Neutron elements —
filter, debounce, vibrate, and hand off to your `actionHandler`.

## Features

- **Event / lifecycle hooks** Listen for DOM events or `connected` /
  `disconnected` / `adopted`
- **Host retarget** `host-ref="window"` / `document` / any selector —
  Escape to dismiss, shortcuts outside the bubble path
- **Target filters** Selector, keycode (`shift+k` chords), and pathname gates
- **Debounce / delay** Coalesce noisy input
- **Event hygiene** `prevent-default` / `stop-propagation` /
  `stop-immediate-propagation`
- **Haptic pulse** Optional `vibrate-ms` on handle

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Compose `ListenableElement` and implement `actionHandler`. Concrete
consumers include `<spa-a>` and `<event-handler>`.

```ts
import { Neutron } from "@excom/neutron";
import { ListenableElement } from "@excom/listenable-element";

export const TapLog = Neutron.compose([
  ListenableElement,
  Neutron({ tag: "tap-log" }),
])
  .defineMethods({
    actionHandler: (_el, e) => {
      console.log("handled", e.type);
    },
  });

TapLog.define();
```

```html
<tap-log listen-for="click keydown" keycode-filter="enter">
  Tap or Enter
</tap-log>
```

`host-ref` moves listening off `:scope` — e.g. `host-ref="window"` for
global keydown. See `<event-handler>` for Escape-to-dismiss examples.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Default click → navigate

`<spa-a>` inherits this base and defaults to click when `listen-for`
is unset:

```html
<spa-a route-href="/pricing">Pricing</spa-a>
```

#### Filter & debounce

```html
<event-handler
  listen-for="input"
  delay-ms="200"
  is-debounced
  fire-event="search-query"
>
  <input name="q" />
</event-handler>
```

See `<event-handler>` and `<spa-a>` package docs for more examples
built on this mixin.
