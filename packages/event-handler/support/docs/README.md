# event-handler

Stitch behaviors of your app together, primarily through events.

<include-content data-demo="with-as"></include-content>

## Features

- **Fire custom events** Map any input event, such as clicks, or lifecycles to custom output events
- **Commands** `command-name` invokes the HTML Command API — built-in verbs (`show-modal`) and the `--verb` commands elements accept (`--submit`, `--close`)
- **Retarget** Aim events/commands at any selector (`target-ref`) — where a `<button commandfor>` needs an id
- **Global / host listening** Listen to events globally or on any element. Helpful for: escape to dismiss, global shortcuts, etc.
- **Keycode filter** Escape to dismiss, Shift+K shortcuts — keys / modifier chords
- **Listen filters** Debounce, selector, and pathname gates
- **Custom Event Payloads** `detail-*` attributes and forms convert to `event.detail` JSON

> In a view that already has a `<quark-sheet>`, the same wiring is a rule: `@on click (target: "[data-add]") { @dispatch cart-add (detail: (sku: attr("data-sku"))); }` — `@on` options cover `selector-filter` / `keycode-filter` / `is-debounced` / `host-ref`, and `@dispatch` / `@command` cover `fire-event` / `target-ref` / `form-ref` / `command-name`. Keep `<event-handler>` for markup without a sheet.

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Listen (default `click`), then either `fire-event` or `command-name`.

```html
<event-handler fire-event="cart-add">
  Add to cart
</event-handler>
```

Or, for example: a successful form submit re-fetches the related data by invoking the provider's `--fetch` command.
```html
<event-handler listen-for="super-form-success" target-ref="#fetch-todos" command-name="--fetch">
  <super-form>
    <form>
      <!-- form to create a new todo -->
    </form>
  </super-form>
</event-handler>
```

In a Nucleus Stack application, this will be one of the most heavily used elements. It is the primary method of linking a functional cause and effect.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Fire a custom event

Click dispatches `cart-add` event with `{ sku: "sku-1" }` in `event.detail`.

<include-content data-demo="fire-event"></include-content>

#### Open a dialog

`command-name` invokes the HTML Command API — here the built-in `show-modal` opens the sibling `<dialog>`. Custom commands (`command-name="--close"`) reach any element that handles them, such as `<content-drawer>`, through a relative `target-ref`.

<include-content data-demo="command-dialog"></include-content>

#### Close on Enter

`keycode-filter` gates keyboard handling — here Enter, focused in the
`input`, invokes the drawer's `--close` command (local / bubbling events only).

<include-content data-demo="enter-close"></include-content>

#### Escape to dismiss (global)

`host-ref="window"` listens for `keydown` on the window — Escape closes
the dialog even when focus is outside it.

<include-content data-demo="escape-close"></include-content>

#### Cancel a link click

`prevent-default` cancels the native action — here the wrapped `<a>` never navigates.
Use `stop-propagation` / `stop-immediate-propagation` the same way when you need to stop bubbling.

<include-content data-demo="prevent-default"></include-content>

#### Retarget

`target-ref` aims the outgoing event at another element — useful when the target sits outside of the bubble path.

<include-content data-demo="retarget"></include-content>

#### Debounced input / form data

Inherited `delay-ms` + `is-debounced` coalesce noisy `input` into one `search-query` event. Demo below is debounced every 200ms.

Also demonstrated is form conversion into JSON: `text` -> `string`, `checkbox` -> `boolean`, etc. Including the data structure: `detail.strict` -> `{detail: {strict}}`.

<include-content data-demo="debounce"></include-content>
