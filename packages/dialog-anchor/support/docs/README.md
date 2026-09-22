# dialog-anchor

Open and close a native `<dialog>` — no JavaScript required.

<include-content data-demo="simple"></include-content>

## Features

- **Click to toggle** Opens / closes a `<dialog>` on click
- **Target or fallback** Point at any `<dialog>` via `target-ref`, or let
  it find the nearest ancestor automatically (great for close buttons)
- **Modal or non-modal** `is-modal` blocks the rest of the page; omit it
  for a lightweight, dismissible popover
- **Any trigger event** Inherits `listen-for` to open/close on custom
  events instead of `click`

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Wrap a trigger in `<dialog-anchor>` and point it at a `<dialog>`. A
`<dialog-anchor>` with no `target-ref`, placed inside the `<dialog>` it
should close, needs no configuration at all.

```html
<dialog-anchor target-ref="#confirm" role="button">Delete</dialog-anchor>
<dialog id="confirm">
  <p>Are you sure?</p>
  <dialog-anchor role="button">Cancel</dialog-anchor>
</dialog>
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Modal dialog

`is-modal` opens the dialog as a modal, blocking interaction with the rest
of the page until it's closed (using native `::backdrop`). Without that attribute,
the dialog is opened without a backdrop.

If using Valence.css, setting `.absolute` on the `dialog` element will display it `absolute`
in the surrounding content (as opposed to fixed).

<include-content data-demo="is-modal"></include-content>

#### Close on a custom event

`listen-for` swaps the default `click` for any event. Pair it with a real
`<super-form>`'s `super-form-success` event to auto-close a dialog
once a form inside it succeeds — simulated here with `<event-handler>`.

<include-content data-demo="auto-close"></include-content>
