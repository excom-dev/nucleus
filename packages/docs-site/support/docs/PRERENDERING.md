# Prerendering

Render every route to static HTML when the site is built. The browser takes each page over as it stands: nothing renders twice, nothing is fetched twice.

## Setup

[nucleus-ssr](/packages/nucleus-ssr) renders the built site in Node: a config module names the routes and the app, which for an app built on NucleusKit is the kit's server entry: `entry: () => import("@excom/nucleus-kit/server")`. Build the site with [vite-plugin-nucleus](/packages/vite-plugin-nucleus), then run `npx nucleus-ssr prerender.config.js`: it prerenders every route, reports each page and fails on a broken internal link. The nucleus-ssr page has the working example, the options and what fails a page. The app itself stays as it is: the same HTML, sheets, views and kit `<script>`. Prerender after every fresh build: a shell an earlier prerender wrote is refused.

## How it fits

The stack needs no second rendering model for this. Three things it already is are enough:

- **The HTML is the State.** State is attributes, text and children, so a serialized document is the State, fully formed. Provisions are State too: the page carries them, and each Adapter has its own again before it mounts.
- **Adapters are drivable.** Writing an Adapter's attributes reproduces what its protocol would have done, so a page that arrives with `is-active` or `is-success` set is an ordinary State to start from.
- **Hydration is a cold mount.** No element is told it hydrates. Each mounts as on any page load; its requests are answered at once, from the page, and its writes find their result already there. The Orchestrator derives the same State again and skips every equal write.

## In the browser

A prerendered page is static HTML plus the data it was built from, in a JSON `<script>` at the end of `<body>`. Once the kit loads:

- **Views** (`include-content`, `spa-route`) keep their prerendered content: no re-render, no refetch, no flash. `did-render` fires once, and content with `ready-on` is ready at once, never hidden. A view that changed since the build renders as on a cold load.
- **Providers** announce as on a cold load, `provider-fetch-loading` then `provider-fetch-success`, with the response the page carries and no request.
- **Loaded state** (`is-success` / `did-load`) is dropped and set again within one task as an element loads: content gated on it never flashes, and a MutationObserver sees one removal and one re-add.
- **Sheets** find what they would paint already there; `iterate()` adopts the prerendered rows.
- **`spa-manager`** runs its first update without a View Transition or `transition-delay` and leaves scroll to the browser; a reload gets its saved position back.
- **What the prerender left out** happens now, as on any page load: elements that read the device or the person, [`no-ssr` regions](#md-keeping-elements-out), `shadow` / `iframe` render hosts, `pre-fetch="idle"` fetches, anything behind a long timer (`@delay 3000`). An element whose data was kept out of the page arrives not loaded, its rendered content in place, and fetches as on a cold load.

Hydration ends once nothing holds it: kit requests, sheets and `@use` modules still loading, the first `spa-manager` update. From then on the page is an ordinary one. It lasts 10 s at most, and a console warning says when that limit ended it.

## Sheets

A sheet needs no change: the same sheet runs in the prerender and in the browser.

One contract to keep: **an `@on` write is a one-shot, on both sides.** `@on` blocks run during the prerender and their writes are in the HTML. In the browser the elements' events fire again (`provider-fetch-success`, `spa-route-did-render`), so a block applies again if its sheet is listening by then, the [load order](/docs/orchestrating#md-load-order) rule of any cold load. The first pass, though, paints again whatever a declarative rule also paints, and a `$binding` only an `@on` block wrote is unbound in the browser until that block runs again. Content that must survive prerendering derives from state attributes and provisions:

```quark
/* derived from State: the browser's first pass paints the same */
provider-fetch:not([is-success]) [bind-status] { content: "Loading…"; }
provider-fetch[is-success] [bind-status] { content: "Loaded"; }

/* a one-shot over a declarative paint: "Loading…" again, until the event is heard */
provider-fetch {
  [bind-status] { content: "Loading…"; }
  @on provider-fetch-success { [bind-status] { content: "Loaded"; } }
}
```

Four smaller things:

- Of two rules that set the same attribute, or text `content:`, on one element in one pass, only the later writes: a prerendered text node that already shows it is kept. `iterate()`, `template()`, `dangerous-html()` and `none` content is still written rule by rule, so one matching rule per element keeps the prerendered nodes.
- `iterate()` adopts prerendered rows by key: the key property's value, else a hash of the item, compared as text. A row whose key the browser does not find renders again.
- `template()` and `dangerous-html()` content is kept when its source is unchanged, replaced otherwise.
- A `$binding` not written yet, its sheet still loading a `@use` module, keeps what is painted until it is bound; once hydration ends, an unbound name is `undefined` again.

## Keeping elements out

What should not render at build time mounts in the browser instead, as on a cold load.

**`no-ssr` keeps a region out.** No Neutron element on or inside an element with the attribute mounts in the prerender, NucleusKit elements included. Use it for one place in a page, such as a live demo or a `lazy-load` view that should stay lazy:

```html
<include-content no-ssr lazy-load template-ref="/views/map/map.html"></include-content>
```

A sheet may write it too, on the element itself and first in the rule that activates it. An element that had already loaded or rendered when `no-ssr` reached it fails the page.

**`ssr: false` keeps a tag out.** `Neutron({ tag, props, ssr: false })` keeps every instance of your own element out, wherever it is written and without an attribute: for an element whose code reads the device or the person. Only the tag's own instances stay out; what they hold prerenders as usual.

## Your own elements

Compose `fetchable-element` / `renderable-element` and an element hydrates like the kit's own, with nothing to add. An element that calls `fetch()` and replaces its own content still works on a prerendered page: it fetches and renders again. To keep the prerendered result instead, use these from `@excom/kit-utils`:

- `fetchRecord(url, init)` in place of `fetch()`. It resolves the response as plain data (`ok`, `status`, `headers`, `body` as text). The prerender records a successful one, and in the browser the page answers, while it hydrates, as many identical GET / HEAD requests as the prerender made. A request that must be fresh or private always reaches the network: any other method, another origin, a `Request` object, `cache: "no-store"` / `"no-cache"` / `"reload"`, an `Authorization`, `Range` or `Cache-Control` header.
- `replaceNonTemplateChildren(host, nodes, { identity })` to render. `identity` names the source: `templateIdentity(ref, { scope })` or `htmlIdentity(html)`. Where `host` still holds what the prerender rendered from that source, its nodes stay (yours are not inserted) and the call returns `"adopted"`.
- `holdHydration(promise)` keeps the page hydrating until other start-up work settles, `whenHydrated()` resolves once hydration is over, and `isServerRender()` is `true` during a prerender.

A `provision` of plain data (what JSON carries) is restored from the page before the element mounts; any other is derived again in the browser. When the response it came from stayed out of the page, the element is written not loaded (no `is-success` / `did-load`) and fetches again. An element that reads the device or the person is defined with `ssr: false`, or stays undefined in the prerender: the entry does not load it, and `excludedTags` has the renderer check. A `<script>` an element inserts as HTML never runs in the browser, but does once it sits in a prerendered file: insert none. The attributes the prerender writes for itself (`n-ssr`, `n-tpl`, `n-tpl-id`, `n-inert`, `q-key`) are never written or selected on by hand.

## Static hosting

- **Slashless files.** `/docs/intro` is written to `docs/intro.html` and `/` to `index.html`. The host must serve `/docs/intro` from that file: many static hosts do, some need a rewrite rule.
- **A real 404.** Prerender the not-found route to `404.html`. Once `/` is prerendered, `index.html` is the home page: a host that falls back to it would answer every unknown URL with the home page and a 200. With a `404.html`, every route needs its file: a route that depends on the person (a bag, an account) is written as the untouched shell, through [`shellRoutes`](/packages/nucleus-ssr#md-options), and renders in the browser. The kit's server entry fails a soft 404, a page only the fallback route matches, so a link to a page that is gone cannot be written as one.
- **A file served for another URL** still works: the content of a route the URL does not match is removed, and the matching route renders.
- **Script loading.** Load the kit as a module or deferred script, so the page paints before the kit runs. A classic script works too: elements mount once the document is parsed.
- **Public files.** Nothing a per-person response returned may be in a prerendered page. nucleus-ssr fails a page built from a response marked private.

## Limits

- **Build time only.** No per-request rendering: what only a request knows (the person, a cookie) renders in the browser.
- **One renderer per process.** Pages render one at a time, or in a pool of worker processes; a cache writes a page again without rendering it while its shell and requests answer as in the last build. Both are [nucleus-ssr options](/packages/nucleus-ssr#md-workers-cache).
- **happy-dom, not a browser.** The prerender has no layout: every observed element counts as in view, so `lazy-load` views are in the page unless `no-ssr` keeps them out, and `matchMedia()` answers for one viewport. Where the browser derives something else, it writes it. Markup a browser would parse into other elements [fails the prerender](/packages/nucleus-ssr#md-failures): most often block content rendered into an element that sits in a `<p>`, or rows rendered straight into a `<table>` (write the `<tbody>`). The [hydration test](/packages/nucleus-ssr#md-test-hydration) runs on happy-dom too, so it cannot show what only a real browser does.
- **Time and randomness.** A page that depends on them differs between builds, and from what the browser derives.
