# network-status

Live connectivity readout — `navigator.onLine` plus connection type and
speed where the browser exposes them.

<include-content data-demo="simple"></include-content>

## Features

- **CSS-driven UI** Style from `[is-online]` / `[connection-type]`
- **Live events** `online` / `offline` / `change` fire as connectivity
  shifts — on transitions, never at mount
- **Bindable state** `.provision` is the full snapshot; read it from Quark
  with `prop("provision")`
- **Network Information API** Connection type + effective speed where
  supported
- **Graceful degradation** Unsupported fields stay `null`; core
  online/offline still works everywhere

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Drop it anywhere and hook `[is-online]` / `[is-mounted]` with CSS, or
listen for its events from a parent.

```html
<network-status></network-status>
```

```css
network-status:not([is-mounted])::before {
  content: "Loading…";
}
network-status[is-online]::before {
  content: "📶 Online";
}
network-status[is-mounted]:not([is-online])::before {
  content: "📵 Offline";
}
```

Nothing fires at mount: the first read sets `is-online` and `.provision`
only. React to the attribute (or `prop("provision")`) for the initial
state; `network-status-online` / `-offline` report transitions.

The Network Information API (`connection-type`, `effective-type`,
`downlink`, `rtt`) is Chromium-only — Safari and Firefox leave those
fields `null`. Build critical UX on `is-online` alone; treat the rest as
a progressive enhancement. Safari/iOS also have known `navigator.onLine`
reliability quirks — see `INTERNAL.md`.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Offline banner

A banner shown purely by CSS attribute selector — no listeners needed.

<include-content data-demo="offline-banner"></include-content>
