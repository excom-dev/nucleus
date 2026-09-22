# dismiss-watcher

One dismissal Adapter for drawers, menus, dialogs and popovers — Escape / back gesture and outside click, without each panel element owning the logic.

<include-content data-demo="simple"></include-content>

## Features

- **Escape / back gesture** Through a `CloseWatcher` (Android back, Escape) via `watch-escape`
- **Outside click** A `mouseup` outside the target via `watch-outside-click`
- **One event** `dismiss-watcher-dismiss` with `detail.reason`; cancel it with `preventDefault()`
- **Default action** `command-name` commands invoked on the target (`--close`), or `fire-event` names dispatched at it
- **Any target** The parent by default, or `target-ref` (`:scope`-relative)
- **Gated by State** Live only while `is-active` — set it from Quark on the panel's open state

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Drop it inside the element being dismissed, gate `is-active` on that element's open state, and either react to `dismiss-watcher-dismiss` or let `command-name` / `fire-event` close the panel for you. When neither `watch-escape` nor `watch-outside-click` is present, both watchers are on.

```html
<nav>
  <dismiss-watcher fire-event="menu-close"></dismiss-watcher>
  …
</nav>
```

```quark
:scope {
  @on menu-open { data-is-open: ""; }
  @on menu-close { data-is-open: none; }
  &[data-is-open] dismiss-watcher { is-active: ""; }
  &:not([data-is-open]) dismiss-watcher { is-active: none; }
}
```

Why a separate element: dismissal is the same request whether the panel is a drawer, a menu, a dialog or a popover. Panel elements keep their own state (`is-open`); this Adapter only asks them to close. It renders nothing, listens only while `is-active`, and tears down when unset or removed. Write the inverse rule for `is-active` — Quark rules do not revert.

`dismiss-watcher-dismiss` bubbles and is cancelable. `detail.reason` is `"escape"` / `"outside-click"`. The default action invokes each `command-name` on the target (a `command` event, as a `<button command commandfor>` would) and dispatches each `fire-event` name at it as a bubbling `CustomEvent`; `preventDefault()` keeps the panel open (an unsaved-changes guard, for instance).

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Menu panel

Both watchers on (neither `watch-*` set), target = the parent `<nav>`. The sheet opens on `menu-open`, closes on `dismiss-watcher-dismiss`, and gates `is-active` on `data-is-open` with its inverse rule.

<include-content data-demo="simple"></include-content>

#### Content drawer

First child of `<content-drawer>`, `command-name="--close"` — the drawer needs no dismissal logic of its own. `is-active` follows `content-drawer[is-open]`.

Open with `--open`, not `--toggle`: an outside `mouseup` on the button closes the drawer first, then the button's `click` re-opens it. With `--toggle` the same click would close it again.

<include-content data-demo="drawer"></include-content>
