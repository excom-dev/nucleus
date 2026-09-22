# Nucleus Kit

The whole Nucleus Stack in one package — every element, provider, Quark, and Valence.css behind a single import.

## Features

- **One JS import** Registers every Nucleus Kit element
- **One CSS import** Valence.css theme + shared element styles (`basic.css`)
- **App-ready** Routing, sheets, forms, drawers, providers, and more
- **À la carte** Every package is published on its own; if you only use a few elements, install just those

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

```js
import "@excom/nucleus-kit";
```

```css
@import "@excom/nucleus-kit/basic.css";
```

That loads Valence.css (`basic` theme) plus element CSS and registers the
packages below.

### Progressive bundle (experimental)

`nucleus-kit.progressive.min.js` registers nothing up front. It watches the
document for Nucleus Kit element tags and imports each element's package the
first time its tag appears (initial scan, then every inserted subtree), so a
page pays only for the elements it uses. Packages shared by several elements
(`neutron`, `kit-utils`, `quark`, the element bases) are separate chunks
under `dist/progressive/`, fetched once. The entry is 3 kB; a page using
`quark-sheet` and `content-drawer` loads ~55 kB gzip less than the all-in
build.

```html
<script type="module" src="/node_modules/@excom/nucleus-kit/nucleus-kit.progressive.min.js"></script>
```

Trade-offs: elements upgrade one network round-trip later (style the
pre-upgrade state with `:not(:defined)`), it is ES modules only, and elements
inside a shadow root need `observeElements(shadowRoot)` from the same module.
The all-in `index.umd.min.js` and the ESM `index.js` are unchanged.

### À la carte

Nucleus Kit is a convenience, not a requirement. If you find you are not using
most of its elements, install the packages you do use individually and drop it:

```sh
npm install @excom/quark-sheet @excom/provider-fetch @excom/content-drawer
```

```js
import "@excom/quark-sheet";
import "@excom/provider-fetch";
import "@excom/content-drawer";
```

Each package is self-contained — same elements, same versions, same CSS hooks —
and its README documents the slim install. Valence.css is `@excom/valence`.

### What's included

**Core**

- [`neutron`](/nucleus/packages/neutron) — custom element factory
- [`quark`](/nucleus/packages/quark) / [`quark-sheet`](/nucleus/packages/quark-sheet) — DOM
  orchestration
- [`valence`](/nucleus/packages/valence) — Valence.css, semantic CSS (via `basic.css`)

**Layout / chrome**

- [`content-carousel`](/nucleus/packages/content-carousel)
- [`content-drawer`](/nucleus/packages/content-drawer)
- [`content-tabs`](/nucleus/packages/content-tabs)
- [`dialog-anchor`](/nucleus/packages/dialog-anchor)
- [`dismiss-watcher`](/nucleus/packages/dismiss-watcher)
- [`data-table`](/nucleus/packages/data-table)

**Content / routing**

- [`include-content`](/nucleus/packages/include-content)
- [`spa-route`](/nucleus/packages/spa-route)
- [`scroll-into-view`](/nucleus/packages/scroll-into-view)

**Forms / auth**

- [`super-form`](/nucleus/packages/super-form)
- [`super-input`](/nucleus/packages/super-input)
- [`web-authn`](/nucleus/packages/web-authn)

**Providers**

- [`provider-fetch`](/nucleus/packages/provider-fetch)
- [`provider-geolocation`](/nucleus/packages/provider-geolocation)
- [`provider-orientation`](/nucleus/packages/provider-orientation)
- [`provider-storage`](/nucleus/packages/provider-storage)

**Platform**

- [`detect-browser`](/nucleus/packages/detect-browser)
- [`detect-features`](/nucleus/packages/detect-features)
- [`detect-media`](/nucleus/packages/detect-media)
- [`dom-observer`](/nucleus/packages/dom-observer)
- [`event-handler`](/nucleus/packages/event-handler)
- [`gesture-handler`](/nucleus/packages/gesture-handler)
- [`network-status`](/nucleus/packages/network-status)
- [`service-worker`](/nucleus/packages/service-worker)

### Not in Nucleus Kit

Install separately when needed: `mapbox-view`, `super-img`, element bases
(`abortable-element`, `fetchable-element`, …), and editor tooling such as
[`nucleus-quark-highlighter`](/nucleus/packages/nucleus-quark-highlighter).
