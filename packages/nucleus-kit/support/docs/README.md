# NucleusKit

The whole Nucleus Stack in one package — every element, provider, Quark, and Valence.css behind a single import.

## Features

- **One JS import** Registers every NucleusKit element
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
document for NucleusKit element tags and imports each element's package the
first time its tag appears (initial scan, then every inserted subtree), so a
page pays only for the elements it uses. Packages shared by several elements
(`neutron`, `kit-utils`, `quark`, the element bases) are separate chunks
under `dist/progressive/`, fetched once. The entry is 3.5 kB; a page using
`quark-sheet` and `content-drawer` loads ~55 kB gzip less than the all-in
build.

```html
<script type="module" src="/node_modules/@excom/nucleus-kit/dist/nucleus-kit.progressive.min.js"></script>
```

With a bundler, `import "@excom/nucleus-kit/nucleus-kit.progressive";` loads the same entry.

Trade-offs: elements upgrade one network round-trip later (style the
pre-upgrade state with `:not(:defined)`), it is ES modules only, and elements
inside a shadow root need `observeElements(shadowRoot)` from the same module.
The all-in `index.umd.min.js` and the ESM `index.js` are unchanged.

On a [prerendered page](/docs/prerendering), the packages for the tags present at startup load before hydration ends, so those elements keep the prerendered markup.

#### Idle loading

Prefetch the remaining packages once the page has loaded, so later views, dialogs and SPA navigations upgrade instantly with no round-trip. Packages load one per browser idle period; tags already on the page load first and are never fetched twice.

Opt in on `<body>` (works with inline / bundled imports) or on the entry's own `<script>`:

```html
<body nucleus-kit-idle>                                    <!-- every package -->
<body nucleus-kit-idle="spa-route super-form data-table">  <!-- only these -->

<script type="module" src="/node_modules/@excom/nucleus-kit/dist/nucleus-kit.progressive.min.js" data-idle></script>
```

An empty value loads everything; a space-separated list loads only the packages behind those tags (unknown tags log a warning). `data-idle` is read only from the `<script>` whose `src` is the entry itself and wins over the body attribute. Nothing is prefetched in data-saver mode (Save-Data). From JS, `idleLoadElements(tags?)` does the same.

### Server entry

`@excom/nucleus-kit/server` is the kit for [prerendering](/docs/prerendering) in Node: every export of the main entry except the elements that read the device or the person (`detect-browser`, `detect-features`, `detect-media`, `gesture-handler`, `network-status`, `provider-geolocation`, `provider-orientation`, `provider-storage`, `service-worker`, `web-authn`). Those stay as written in the prerendered page and upgrade in the browser; `SERVER_EXCLUDED_TAGS` lists their tags. It also exports the hooks a prerender runs around each page (`beforeRender`, `settle`, `afterRender`), so it is the whole `entry` of a [nucleus-ssr](/packages/nucleus-ssr) config: `entry: () => import("@excom/nucleus-kit/server")`. ES modules only, not for the browser.

### À la carte

NucleusKit is a convenience, not a requirement. If you find you are not using
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

### TypeScript

Generally, you are advised to avoid TypeScript unless your app starts having a lot of complex JS customization. In that case, NucleusKit elements declare global types: their `HTML…Element` interfaces, `HTMLElementTagNameMap` entries (so `querySelector("spa-manager")` and `closest(…)` are typed) and Quark's `element.quark`. TypeScript loads them only when it sees an import of the package, so an app that loads NucleusKit from a `<script type="module">` or a CDN gets "Property does not exist" on `element.closest("spa-manager")?.router` or `element.quark`.

Add one declaration file that the app's `tsconfig.json` includes:

```ts
// globals.d.ts
import "@excom/nucleus-kit";
```

A `.d.ts` file emits nothing: no runtime import, no bundle cost. À la carte apps import each package they use instead (`import "@excom/spa-route"; import "@excom/quark";`). If a TypeScript file in the app already imports NucleusKit or the packages, nothing is needed.

### What's included

**Core**

- [`neutron`](/packages/neutron) — custom element factory
- [`quark`](/packages/quark) / [`quark-sheet`](/packages/quark-sheet) — DOM
  orchestration
- [`valence`](/packages/valence) — Valence.css, semantic CSS (via `basic.css`)

**Layout / chrome**

- [`content-carousel`](/packages/content-carousel)
- [`content-drawer`](/packages/content-drawer)
- [`content-tabs`](/packages/content-tabs)
- [`dialog-anchor`](/packages/dialog-anchor)
- [`dismiss-watcher`](/packages/dismiss-watcher)
- [`data-table`](/packages/data-table)

**Content / routing**

- [`include-content`](/packages/include-content)
- [`spa-route`](/packages/spa-route)
- [`scroll-into-view`](/packages/scroll-into-view)

**Forms / auth**

- [`super-form`](/packages/super-form)
- [`super-input`](/packages/super-input)
- [`web-authn`](/packages/web-authn)

**Providers**

- [`provider-fetch`](/packages/provider-fetch)
- [`provider-geolocation`](/packages/provider-geolocation)
- [`provider-orientation`](/packages/provider-orientation)
- [`provider-storage`](/packages/provider-storage)

**Platform**

- [`detect-browser`](/packages/detect-browser)
- [`detect-features`](/packages/detect-features)
- [`detect-media`](/packages/detect-media)
- [`dom-observer`](/packages/dom-observer)
- [`event-handler`](/packages/event-handler)
- [`gesture-handler`](/packages/gesture-handler)
- [`network-status`](/packages/network-status)
- [`service-worker`](/packages/service-worker)

### Not in NucleusKit

Install separately when needed: `mapbox-view`, `super-img`, element bases
(`abortable-element`, `fetchable-element`, …), and editor tooling such as
[`nucleus-quark-highlighter`](/packages/nucleus-quark-highlighter).
