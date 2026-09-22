# content-drawer

Slide-in drawers and sheets for nav menus, filters, confirmations, and side panels — any edge, with peek stages.

<include-content data-demo="simple"></include-content>

## Features

- **Any edge** Bottom (default), top, left, or right via `from-side`
- **Peek stages** Full, half, or peek via `open-stage`
- **Command-driven** `--open` / `--close` / `--toggle` from any `<button command commandfor>`
- **Dismissal** Outside click + Escape via `<dismiss-watcher>`
- **Backdrop** Valence.css dimmer — sibling `[role="presentation"]` / `.tag-backdrop`
- **Auto-dismiss** `disappear-after` for toast-style confirmations
- **Singleton groups** One open drawer per `singleton-name`
- **Layout modes** Viewport sheet (default, `position: fixed`), `.absolute` (inside its parent), `.relative`, or `.sticky`
- **Scrubbable** Wrap in [`gesture-handler`](/nucleus/packages/gesture-handler): the sheet follows the finger via `is-scrubbing` + `--content-drawer-open-progress`

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Put content inside `<content-drawer>` and invoke `--open`, `--close`, or `--toggle` on it — a native `<button command commandfor>`, or `<event-handler command-name target-ref>` when the invoker is not a button. Its parent automatically becomes `position: relative; overflow: hidden`, so give the parent a real size along the drawer's axis.

```html
<button type="button" command="--toggle" commandfor="sheet">Toggle sheet</button>
<content-drawer id="sheet" class="absolute">
  <h2>Saved!</h2>
</content-drawer>
<event-handler class="tag-backdrop" role="presentation" target-ref="content-drawer:has(+ :scope)" command-name="--close"></event-handler>
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Peek stages

`--open` with `data-open-stage` on the button sets the stage — `0` full, `1` half, `2` peek. The exact heights of each stage are configurable through CSS variables.

<include-content data-demo="stages"></include-content>

#### Dismissal

`<dismiss-watcher command-name="--close">` as the drawer's first child closes it on outside click or Escape / back gesture; the sheet gates its `is-active` on `content-drawer[is-open]` (with the inverse rule). Open with `--open`, not `--toggle` — an outside `mouseup` on the button closes first, the `click` then re-opens. Immediate next sibling `[role="presentation"]` / `.tag-backdrop` is the Valence.css modal dimmer; `<event-handler command-name="--close">` on that node closes on click.

<include-content data-demo="dismiss"></include-content>

#### Side drawer

`from-side` slides from left / right / top instead of the default bottom.

<include-content data-demo="from-side"></include-content>

#### Auto-dismiss

`disappear-after` closes the drawer after N seconds — useful for success toasts.

<include-content data-demo="disappear"></include-content>

#### Singleton group

Drawers sharing `singleton-name` — opening one closes the other.

<include-content data-demo="singleton"></include-content>
