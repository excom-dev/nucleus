# vite-plugin-nucleus

Build, serve and preview a Nucleus Stack site with one Vite plugin: pages, Quark modules and the service worker are found by convention, and the preview answers as your host does.

## Features

- **One line of config** `plugins: [nucleus()]` covers `vite`, `vite build` and `vite preview`
- **Conventions, not entry lists** Root `*.html` files are pages, `*.ts` files are Quark `@use` modules, the service worker is bundled
- **Host-true preview** `vite preview` answers as Cloudflare Workers static assets do: `_redirects`, `_headers`, the 404 page
- **Kit from a CDN** `kit: "unpkg"` loads the Nucleus Kit from unpkg in a deploy build instead of bundling it
- **CSS chain included** `@import` / `@import-glob`, mixins, custom selectors and preset-env, nesting shipped as written
- **Prerender-ready** Builds what [nucleus-ssr](/nucleus/packages/nucleus-ssr) prerenders, and serves it for browser checks

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Add the plugin to `vite.config.js`; `vite`, `vite build` and `vite preview` need nothing else. It runs on Vite 8.3 and Node 24.13, or later.

```js
// vite.config.js
import { nucleus } from "@excom/vite-plugin-nucleus";

export default {
  plugins: [nucleus()], // a deploy build: nucleus({ kit: "unpkg" })
};
```

### Conventions

What the project holds decides what is built:

```text
index.html                              a page, as every *.html at the root
shell.ts                                a Quark module, built to /shell.js
public/
  _redirects                            /shell /shell.js 200
  views/cart/cart.ts                    a Quark module, built to /views/cart/cart.js
  service-worker/service-worker.js      bundled into one classic script
```

- Every `*.ts` at the root and under `publicDir` is a Quark module, built unhashed at its URL: keep other TypeScript in a folder of the root. Declarations, `*.config.ts`, `*.test.ts` and `*.spec.ts` are left alone
- An extensionless module URL (`@use "/shell"`) needs its `200` line in `_redirects`, in dev as on the host
- The files the service worker imports are left out of the build unless a page or sheet names them. Dev sends `Service-Worker-Allowed: /` with the worker; on the host that is a line of your `_headers`
- Two files that would answer at one URL stop the build

### The kit

A page loads the kit from a module script: `import "@excom/nucleus-kit/nucleus-kit.progressive";`. That path resolves from the first Nucleus Kit release after 0.3.0; with 0.3.0 write `…/nucleus-kit.progressive.min`, which works in both modes.

- `kit: "bundled"` (default) Vite bundles the kit like any dependency
- `kit: "unpkg"` `vite build` loads it from unpkg at the installed version, so the kit must be installed in the app. Imports of `@excom/nucleus-kit/<entry>` in a script and of `@excom/nucleus-kit/<name>.css` in a stylesheet are rewritten; the bare `@excom/nucleus-kit` is not. The build stops when kit code would ship, or on a path the kit does not export

### What the plugin sets

- **Set by the plugin** The build's inputs and output file names, `css.postcss` and, with `kit: "unpkg"`, `build.modulePreload: { polyfill: false }`. A PostCSS config file is not read: add plugins in `css.postcss.plugins`
- **Yours** `publicDir`, `build.outDir`, `build.emptyOutDir` (default `true`) and `build.assetsDir`
- **Not supported** `base`: the site is served from `/`

### Dev / preview

- `vite` applies the `200` lines of `_redirects` and answers any other unknown route with `index.html`. The site is read once per start: a new page or module needs a restart
- `vite preview` serves the build as Cloudflare Workers static assets do: `_redirects`, `_headers` (without `Cache-Control` and `Strict-Transport-Security`) and the `assets` options `not_found_handling` / `html_handling` of the nearest `wrangler.jsonc` or `wrangler.json` whose `assets.directory` is the build. What it does not emulate, it refuses with an error: a `wrangler.toml`, a Worker script (`main`), `run_worker_first`

### Host / CSS entries

- `@excom/vite-plugin-nucleus/host` `serveSite({ root, port?, shell? })` serves a build as the preview does, on every network interface, and resolves `{ port, close() }`: for browser checks. With `shell`, the file `nucleus-ssr --save-shell` wrote, every prerendered page answers with the untouched shell, the cold origin of nucleus-ssr's [cold-render check](/nucleus/packages/nucleus-ssr#md-test-in-a-browser). Also `hostHandler`, `answerOf`, `hostOf`, `rulesOf`, `redirectsOf`, `headersOf`
- `@excom/vite-plugin-nucleus/css` `cssConfig` is the Vite `css` option the plugin sets, for another Vite config; `transformCss(css, from)` runs the same chain on one stylesheet

### Credits

The host emulation holds portions ported from Cloudflare's [workers-sdk](https://github.com/cloudflare/workers-sdk): see [THIRD-PARTY-NOTICES.md](https://github.com/excom-dev/nucleus/blob/main/packages/vite-plugin-nucleus/THIRD-PARTY-NOTICES.md).
