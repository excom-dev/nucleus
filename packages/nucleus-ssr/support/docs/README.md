# nucleus-ssr

Prerender a Nucleus Stack app to static HTML that the browser takes over as it stands: no second render, no second fetch.

## Features

- **Build-time SSR / SSG** Server-side rendering as static site generation: one HTML file per route plus a `404.html`, for a static host
- **Hydration without re-rendering** Each page carries the data it was built from, so views, lists and provisions are kept
- **The real app** Your elements, sheets and views run in Node on happy-dom: no server-side copy to maintain
- **Loud failures** A console error, an unhandled `-error` event or a page that never settles fails the build
- **Public pages** A per-person response fails the page; scripts that Quark paints and fetched views inserted are made inert
- **Hydration tests** `hydrate()` reports every node, attribute and text hydration changed, and its requests

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

`prerender()` renders every route of a built site and writes the files. Run it in Node (24.13 or newer) once the site is built; the app itself needs no change. How a prerendered page behaves in the browser: [Prerendering](/nucleus/docs/prerendering).

```js
// prerender.mjs
import { prerender } from "@excom/nucleus-ssr";

const { pages } = await prerender({
  root: "dist", // the built site, served at `origin` while rendering
  out: "dist", // may be `root`: files are written once every page has rendered
  origin: "https://example.com", // the production origin
  entry: () => import("./prerender-entry.js"),
  routes: ["/", "/menu"], // index.html, menu.html
  notFound: "/404", // 404.html
});
for (const { file, bytes, ms } of pages) console.log(file, bytes, `${ms} ms`);
```

`entry` loads the app once the renderer's window is in place, so it is a dynamic `import()`. The module it resolves to defines the elements and exports the hooks:

```js
// prerender-entry.js
import { Quark } from "@excom/nucleus-kit/server";
import { resetRouter } from "@excom/spa-route/testing";

// elements that read the device or the person: the renderer checks none is defined
export { SERVER_EXCLUDED_TAGS } from "@excom/nucleus-kit/server";

// before each page parses: module state back to a cold load of `url`
export const beforeRender = ({ url }) => resetRouter(url);

// a page is rendered once the window and Quark are quiet together
export const settle = () => Quark.whenSettled({ timeout: Infinity });
```

- The page's own `<script>`s never run in the renderer: import your own elements from the entry too, or they stay undefined in the page
- `afterRender({ url, window, document })` runs before the page is serialized: add its `<link rel="canonical">` or `<meta name="description">` there
- A sheet's `@use "/helpers.js"` is imported by Node: point `Quark.moduleLoader` at the built file, `(url) => import(pathToFileURL(join("dist", url)).href)` with `join` / `pathToFileURL` from `node:path` / `node:url`
- Modules evaluate once per process, so a process gets one renderer; pages render one at a time

### Options

- `shell` is the page each route starts from: `<root>/index.html` by default, read once before any page renders, or a string / `(url) => html`. A shell an earlier prerender wrote (`<html n-ssr>`) rejects the whole run, whatever `onError` says: prerender always follows a fresh build of the site. So does a shell, or the `fallback` file, that [a browser parses into other elements](#md-failures)
- `api` answers `/api/*` GET / HEAD requests, as a mock backend: `(request) => Response | null`
- `fallback` is the file under `root` served for an extensionless path with no file of its own, e.g. `"index.html"`
- `exclude` keeps responses out of the page by absolute URL (every other option takes a path), e.g. what a service worker answers from client state: `(absoluteUrl) => new URL(absoluteUrl).pathname.startsWith("/api/")`
- `excludedTags` lists more custom elements that must not be defined in the renderer
- `viewport` sizes `matchMedia()` / `innerWidth`: 1024 × 768 by default
- `holdTimersAbove` (100) is the longest timer, in ms, that still fires: a 3 s `@delay` neither delays a page nor shows in it
- `budgetMs` (5000) is the time a page may take to settle
- `onError` and `warnIslandBytes`: see [Failures](#md-failures)

### What a page carries

A prerendered page is the settled document, `<html n-ssr>`, with a JSON `<script id="nucleus-hydration">` at the end of `<body>`:

- **Responses** The successful same-origin GET / HEAD responses the kit fetched (views, sheets, `provider-fetch` data), in full. The browser answers as many identical requests from each as the render made, and the next one goes to the network; a URL that answered with different bodies within one render ships its first, and a request aborted before its answer does not count. A request that asks for a fresh or private answer (`cache: "no-store"`, an `Authorization` header) is left out
- **Provisions** Each custom element's `provision`, when it is plain data and the response it came from is in the page. Any other is derived again in the browser and listed, with the reason, in `diagnostics.skippedProvisions`. An element whose data stayed out (`exclude`, a response that cannot be recorded) is written not loaded, without `is-success` / `did-load`: its rendered content stays visible, and in the browser it fetches as on a cold load

What stays out:

- **Per-person data** A response from `api` marked `Cache-Control: private` / `no-store`, or `Vary` on `Cookie` / `Authorization` / `Accept-Language` / `*`, fails the page. `Set-Cookie` alone goes unseen: mark the response
- **Excluded URLs** What `exclude` names is fetched for the render but not shipped
- **Live scripts** A `<script>` that `dangerous-html()` or a fetched view inserted runs on no client-rendered page, so it is written as `type="text/plain"`; a `<template shadowrootmode>` the render inserted loses that attribute. The shell's own scripts and data blocks (JSON-LD) stay. A `<script>` your own element inserts as HTML is written as it is, and runs once the file is parsed
- **Head additions** Nodes the render added to `<head>` are dropped, except `<title>`, `<meta>` and `<link rel="canonical">`
- **Build paths** A `file:` URL in an attribute, script or style, or the path of `root` / the working directory, fails the page

### Failures

A page fails on:

- a console error, an unhandled rejection, or an event whose type ends in `-error` that no listener `preventDefault()`s
- a request it may not make: any method but GET / HEAD, a WebSocket, a fetched `file:` / `data:` / `blob:` URL (a `data:` / `blob:` image source that nothing fetches is fine)
- an element still `is-loading` or `delaying-ready` once the page settled, or a page not settled within `budgetMs`
- markup a browser parses into other elements than the render built: a block element rendered inside a `<p>`, text that looks like a tag in an inline sheet or another element's text, a nested `<a>`, `<form>` or `<button>`, rows rendered straight into a `<table>` (write the `<tbody>`). The error names the place and quotes the page there
- text that would end early once parsed from the file (`</script>` in script text, `-->` in a comment), and a throwing hook or `shell` function

A `fetch()` to another origin gets a network error, which a kit element announces as its `-error` event. Warnings never fail a page: console warnings, another origin's stylesheets (skipped), any iframe's page (never loaded), a page's JSON over `warnIslandBytes`.

- `onError: "fail"` (default) `prerender()` rejects once every route ran, writing nothing; `error.report.pages` has each page's `diagnostics.errors`. `render()` rejects with `error.diagnostics`
- `onError: "shell"` The route is written as the untouched shell and renders in the browser. Per route: `onError: (url) => (url.startsWith("/account") ? "shell" : "fail")`

Every page comes with its `diagnostics`: `errors`, `warnings`, `pending` (on a timeout), `requests`, `skippedProvisions`, `heldTimers`, `islandBytes`, `neutralizedScripts` / `neutralizedShadowRoots`.

### Output

One slashless file per route: `/` is `index.html`, `/docs/intro` is `docs/intro.html`, `notFound` is `404.html`. The host must serve `/docs/intro` from `docs/intro.html`: many static hosts do, some need a rewrite rule. Query and hash name no file; routes that would share a file, or write outside `out`, are refused before any page renders. [Static hosting](/nucleus/docs/prerendering#md-static-hosting) has the hosting rules.

### Test hydration

`createRenderer()` is the renderer `prerender()` drives: `render(url)` resolves `{ html, diagnostics }` and writes nothing. `hydrate()` from `@excom/nucleus-ssr/testing` then loads that HTML into the renderer's window as a browser would and reports what hydration changed from the page as parsed, element upgrades included. Nothing in `removed`, `added`, `attributes` and `texts`: hydration was a no-op. Nothing in `flashes`: nothing the server painted was missing between two tasks and back later, a gap a browser could paint.

```js
import { createRenderer } from "@excom/nucleus-ssr";
import { hydrate } from "@excom/nucleus-ssr/testing";
import { afterAll, beforeAll, expect, it } from "vitest";

let renderer, app;
beforeAll(async () => {
  renderer = await createRenderer({
    root: "dist",
    origin: "https://example.com",
    entry: async () => (app = await import("./prerender-entry.js")),
  });
});
afterAll(() => renderer.close());

it("hydrates /menu without a change", async () => {
  const { html } = await renderer.render("/menu");
  const report = await hydrate(renderer.window, html, {
    beforeParse: () => app.beforeRender({ url: "/menu" }), // the reset a render gets
  });
  expect(report).toMatchObject({ removed: [], added: [], attributes: [], texts: [], flashes: [] });
});
```

A flash reads `body > include-content without [did-load]`, or names a node; a removal undone within its task, or by the animation frame that task asked for, is none. `rewrites` lists attributes written back to the same value, `requests` what the page fetched, `windowMs` how long hydration lasted. `hydrate()` also takes `url` (the window's by default), `timeout` (5000 ms per wait) and `splitTimeouts`: each 0 ms timeout gets its own task, as in a browser, unless it is `false` (happy-dom runs all that are due in one). It runs on happy-dom, so it cannot show what only a real browser does.
