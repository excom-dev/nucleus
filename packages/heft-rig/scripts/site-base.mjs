/**
 * Docs-site route base. Every generated docs route is emitted under it
 * (`/nucleus/docs/<page>`, `/nucleus/packages/<pkg>[/<page>]`,
 * `/nucleus/examples/<app>`); the bare site root is the company page.
 *
 * `SITE_BASE` itself is the docs home — the site package's `introduction`
 * guide. There is no `/nucleus/docs/introduction` route.
 *
 * Static assets and internals stay at the root: `/sandbox/*`, `/api/*`,
 * `/views/*`, `/img/*`, `/package-metas/*`, `/llms.txt`.
 */
export const SITE_BASE = "/nucleus";

/** The site-package doc key served at `SITE_BASE` rather than under `/docs`. */
export const SITE_HOME_DOC = "introduction";
