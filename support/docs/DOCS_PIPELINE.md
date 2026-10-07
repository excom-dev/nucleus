# Advanced

Deeper notes on how this repository is put together. Package-level architecture lives next to each package; this page is the repo-wide map.

## Monorepo layout

- **Nucleus Kit elements** — one tag (or a small family) per package, `excom.packageType: "kit-element"`.
- **Element bases** — `Neutron.compose` mixins (`fetchable-element`, `renderable-element`, …). Not registered on their own (`noop-tag`).
- **Libraries** — Quark, Valence.css, the shared `kit-*` modules, parsers. No custom-element tag. Node-only ones (`nucleus-dom`, `nucleus-ssr`, `nucleus-test`, and the `vite-plugin-nucleus` tool) set `excom.umd: false`: no UMD bundle, and the install snippet lists no CDN script.
- **Site** — `@excom/docs-site`. `documented: false`, but `support/docs/*.md` still emit a slim `package-meta.json` so these pages can be fetched like package READMEs.

## Docs pipeline

Generated artifacts (`support/package-meta.json`, `support/custom-elements.json`, `support/dist-docs/`, repo `dist-docs/`) are **not in git**. Site `dev`/`build` and CI recreate them.

1. `rush build:package-metas` — CEM from JSDoc, flatten APIs, render every `support/docs/*.md` to HTML.
   - `readme` — `README.md` (package pages).
   - `docs` — `{ [lowercase basename]: html }` for every markdown file in that folder except `INTERNAL.md` (contributor notes). Relative links between them (`./PROPS.md`, `EVENTS.md#md-emit`) work on GitHub and are rewritten to site routes. Every relative link (anything not `scheme:`, `//host` or `#hash`) renders as `<spa-a route-href="…" role="link">` so the site navigates without a reload (`render-markdown.mjs`); external and same-page links stay `<a>`.
   - `docSections` — from `support/docs-sections.json` (`{ sections: [{ id, title, docs: ["props", …] }] }`): the sidebar groups of a package whose docs span several pages, page titles from each first `<h1>`. `neutron` is the model.
   - `readme` ends with the release notes from `CHANGELOG.json` (`major` / `minor` / `patch` / `hotfix` comments, newest first; `dependency` and `none` dropped, `release-notes.mjs`) as a closed `<details>`; `build-docs.mjs` adds the three newest releases as `## Release notes` to the primary element's markdown, so they reach `llms-full.txt`.
   - Site `dev`/`build` run this for every `@excom/*` workspace link before collecting (fresh clone works).
2. `collect:docs-metas` (docs-site `dev` / `build`) copies metas into `public/package-metas/`.
   - `index.json` is `{ packages, docs }`. `packages` omits `packageType: "site"` and carries `docSections` where a package has them. `docs` is the overview catalog (name + title from the first `<h1>`).
   - `excom.navGroup: "libraries"` (the only value `format-package-json` accepts) moves a package from its type's sidebar list into the collapsed Libraries group, and `index.json` entries carry it; `nucleus-dom`, `nucleus-ssr`, `nucleus-test`, `quark-formatter` and `vite-plugin-nucleus` set it.
   - `search-docs.json` indexes each doc page as `kind: "page"` (`doc` = page key).
3. `/packages/:packageName`, `/packages/:packageName/:docName` and `/docs/:name` share `package.html`. The sheet picks `/package-metas/<pkg>.json` vs `docs-site.json` and renders `readme` vs `docs[name]`, plus the page's breadcrumb and previous / next links.
4. `rush build:docs` + `rush build:docs-index` — markdown API tables + `dist-docs/llms.txt` / `llms-full.txt`. `build:docs-index` also copies those two files into `packages/docs-site/dist` so Cloudflare serves `/llms.txt` and `/llms-full.txt`.
5. `rush build:prerender` — every sitemap URL becomes a prerendered page in `packages/docs-site/dist`, plus `404.html` (`@excom/nucleus-ssr`).
   - The rig's `prerender.mjs` hands the run to nucleus-ssr's `runPrerender()`, loading the config and entry from workspace source. Pages render in a pool of workers, and a page whose shell and requests answer as in the last run is reused from the package's `temp/prerender-cache`; the untouched shell is saved to `temp/prerender-shell.html`. The package's `build:prerender` script takes `--concurrency <n>` (default: one worker per core but one, at most 6) and `--no-cache`.
   - The site build is `@excom/vite-plugin-nucleus`, which the rig consumes (`scripts/vite-config.mjs`). `pnpm run dev` in `packages/docs-site` (port 3001) serves the source shell and never prerenders. `pnpm run preview` (port 4173) serves `dist` through the plugin's host, as Cloudflare Workers static assets do, with the `assets` options of the package's `wrangler.jsonc`: `_redirects`, `_headers` (without `Cache-Control` and `Strict-Transport-Security`), `/a/b/` moved to `/a/b`, `404.html` with a 404 for an unknown page.
   - `node support/tests/browser/run.mjs [--detail] [--throttle <rate>]`, from `packages/docs-site` after `build:prerender`, checks in headless Chrome that prerendered pages hydrate without touching what the server painted, and that the server rendered what Chrome renders from the untouched shell. It needs Google Chrome and cannot run in a sandbox. happy-dom is not the judge of browser behaviour: a change to hydration, to the renderer or to nucleus-dom's shims is checked there.

Event `@type` after `@fires` / `@listens` names a dedicated event type (`FooEvent`), including `type`, `bubbles`, `cancelable`, and `composed`. Neutron `emit` defaults those last three to `true` unless the element overrides them. Native listeners (e.g. form `submit`) use the DOM event's real flags.

## Release & deploy

One workflow, **Release** (`.github/workflows/publish.yml`), runs on every push to `main`, in this order:

1. **Bump** — `rush publish --apply` consumes the change files and bumps `package.json` versions / `CHANGELOG.json`. The bump is committed locally (`Bump versions [skip ci]`), not pushed.
2. **Build** — full `rush build`, package metas, docs, llms index and npm READMEs, all from the bumped tree, so the site and every generated file carry the new versions. `apply-exports` runs after the bump commit; its `exports` edits are never committed.
3. **Publish** — every package whose version npm lacks; the rest are skipped.
4. **Deploy** — bundle-size baseline, then each site in turn, the docs site and Wrenfield: the kit check, a deploy build (`pnpm run build --kit=unpkg`; the default is `bundled`), for the docs site `rush build:docs-index` again (the build empties `dist`), `rush build:prerender --only <project>` between the restore and save steps of its prerender cache, the site's Chrome suite (`node support/tests/browser/run.mjs`, `continue-on-error` for now), then `wrangler deploy --config packages/<site>/wrangler.jsonc` to Cloudflare Workers static assets. Runs on every push, including docs-only pushes with nothing to publish.
   - A deploy build loads the Nucleus Kit from unpkg at the version just published, not bundled. The kit check (`scripts/kit-check.mjs` in the rig) stops the deploy unless that version on unpkg is, file for file, the kit built here: prerendered pages hydrate with it.
5. **Push** — the bump commit goes to `main` last, once npm has the versions. A push rejected because `main` moved fails the run; the run queued by that newer push re-applies the change files, skips versions already on npm and pushes the bump.

Why one workflow: a deploy running in parallel builds the pre-bump commit and leaves the site one version behind npm, and the bump commit starts no workflow to correct it (`[skip ci]`, pushed with `GITHUB_TOKEN`). **Deploy Docs Site** and **Deploy Wrenfield** (`deploy-docs.yml`, `deploy-wrenfield.yml`) are manual-only (`workflow_dispatch`), for redeploying one site from `main` without a release, by the same deploy steps.

## Commands worth knowing

```bash
rush build:package-metas   # CEM + package-meta.json (all documented packages + site docs)
rush build:docs            # support/dist-docs markdown API tables
rush build:docs-index      # repo dist-docs/ + llms; copies llms into docs-site/dist when present
rush build:prerender       # each site's dist: one static page per route + 404.html (after a fresh site build; docs-site: and build:docs-index)
pnpm run collect:docs-metas  # from docs-site — refresh public/package-metas (after metas exist)
```
