# detect-media

Live media-query facts as attributes — what CSS knows, Quark can now select on. One `<detect-media>` per query; `is-matched` follows `window.matchMedia` and flips as the query does.

<include-content data-demo="simple"></include-content>

## Features

- **Live `is-matched`** Follows `MediaQueryList.matches` and its `change` event
- **Any media query** Color scheme, pointer type, motion, width — whatever `matchMedia` accepts
- **CSS / Quark selectable** Gate content on `detect-media[is-matched]`, no listeners
- **Provision + event** `.provision` is `{ mediaQuery, isMatched }`; `detect-media-change` fires on every flip

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

One element per query. `media-query` takes anything `window.matchMedia` does.

```html
<detect-media media-query="(pointer: coarse)"></detect-media>
```

Select on `is-matched` from CSS:

```css
body:has(detect-media[media-query="(pointer: coarse)"][is-matched]) .hover-hint {
  display: none;
}
```

Or from Quark — the attribute, or the provision:

```quark
detect-media[media-query="(pointer: coarse)"][is-matched] ~ nav {
  data-is-touch: "";
}
detect-media[media-query="(pointer: coarse)"]:not([is-matched]) ~ nav {
  data-is-touch: none;
}
detect-media[media-query="(prefers-color-scheme: dark)"] {
  $app-is-dark: prop("provision").isMatched;
}
```

Missing / empty `media-query` leaves `is-matched` unset and `provision` `null`; changing it re-subscribes. `detect-media-change` fires on every flip after mount, never on mount — react to the attribute for the initial state.

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Touch vs pointer views

Quark flips `is-active` on two `<include-content>` hosts from `(pointer: coarse)` — a true render, so the inactive view is not in the document. Toggle device emulation in DevTools to switch live.

<include-content data-demo="pointer"></include-content>
