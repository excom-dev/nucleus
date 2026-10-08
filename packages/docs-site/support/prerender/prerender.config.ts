/**
 * Prerender config (`npm run build:prerender`, after a fresh `build` and
 * `build:docs-index`): every sitemap URL becomes a slashless page in
 * `dist`, the fallback route `404.html`. A `dist` already prerendered is
 * refused: run `build` again first. The rig's runner then fails the run
 * when a written page links a page of the site that has no file, so a
 * route the sitemap misses cannot go unnoticed.
 */
import { SEED as NAMES } from "../../public/service-worker/names.js";
import { SEED } from "../../public/service-worker/todos.js";
import { SITE_ORIGIN } from "@excom/heft-rig/scripts/build-npm-readmes.mjs";
import { defineConfig, sitemapRoutes } from "@excom/nucleus-ssr";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The built site: read and written in place (`out` is `root`). The entry loads its modules from here. */
export const DIST = join(dirname(fileURLToPath(import.meta.url)), "../../dist");

/** Matched by the fallback route alone: rendered to `404.html`. */
export const NOT_FOUND = "/404";

/** What the service worker answers from client state: `/api/*`, the `/sandbox/*` documents. */
const CLIENT_STATE = /^\/(api|sandbox)\//;

/**
 * A URL the service worker answers from client state: its responses stay
 * out of the pages, and a link to it has no file to check.
 */
export const isClientState = (absoluteUrl: string): boolean =>
  CLIENT_STATE.test(new URL(absoluteUrl).pathname);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * The demos' reads of the service worker's mock API, answered from its
 * seed: what a first visit shows. `GET /api/todos[/<id>][?_limit=<n>]`,
 * `GET /api/names`.
 */
export const api = (request: Request): Response | undefined => {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname === "/api/names") return json(NAMES);
  const match = /^\/api\/todos(?:\/(\d+))?$/.exec(pathname);
  if (!match) return undefined;
  const [, id] = match;
  if (id === undefined) {
    const limit = Number(searchParams.get("_limit"));
    return json(limit ? SEED.slice(0, limit) : SEED);
  }
  const todo = SEED.find((item) => item.id === Number(id));
  return todo ? json(todo) : json({ message: "not found" }, 404);
};

/** The `prerender()` options; `sitemap` is the XML `build:docs-index` wrote. */
export default defineConfig((sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8")) => ({
  root: DIST,
  origin: SITE_ORIGIN,
  routes: sitemapRoutes(sitemap, SITE_ORIGIN),
  notFound: NOT_FOUND,
  entry: () => import("./entry"),
  exclude: isClientState,
  // the runner's link check (not a `prerender()` option)
  servedElsewhere: isClientState,
  api,
  // the slowest page, the spa-route README (all its demos at once), took
  // ~16 s locally: 2.5x for a slower CI runner
  budgetMs: 40_000,
}));
