/**
 * Docs-site route base. Every generated docs route is emitted under it:
 * `/docs/<page>`, `/packages/<pkg>[/<page>]`, `/examples/<app>`. Empty: the
 * docs own the root of their origin (`SITE_ORIGIN`, `build-npm-readmes.mjs`).
 * It drives the rig's emitters and the shell's helpers only: the docs-site
 * shell (`index.html` routes, `_headers`, `manifest.json`, `shell.css`) names
 * these paths literally.
 *
 * Static assets and internals stay at the root whatever the base:
 * `/sandbox/*`, `/api/*`, `/views/*`, `/img/*`, `/package-metas/*`,
 * `/llms.txt`, the Markdown mirror (`/docs/<page>.md`, `/<pkg>.md`).
 */
export const SITE_BASE = "";

/** The site-package doc key served at `SITE_HOME` rather than under `/docs`. */
export const SITE_HOME_DOC = "introduction";

/**
 * The docs home route: the `introduction` guide. There is no
 * `/docs/introduction` route. `/` for an empty base, never `""`: an empty
 * link, route or sitemap entry is no page.
 */
export const SITE_HOME = SITE_BASE || "/";
