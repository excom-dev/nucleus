/**
 * Prerender config (`npm run build:prerender`, after a fresh `build`): the
 * catalogue's pages render to slashless pages in `dist`, the fallback route
 * to `404.html`. The person's pages (saved, bag, checkout, account) are
 * written as the untouched shell and render in the browser; every order page
 * is one such file, which the host serves for `/account/orders/*`
 * (`public/_redirects`). A `dist` already prerendered is refused: run `build`
 * again first.
 */
import { createApi, memoryStore } from "../../public/service-worker/api.js";
import { CATEGORIES } from "../../public/service-worker/config.js";

// Node's built-ins, typed here: the package has no Node types (support/tests/app.ts)
declare const process: {
  getBuiltinModule(id: "node:fs"): { readFileSync(path: string, encoding: "utf8"): string };
  getBuiltinModule(id: "node:path"): { dirname(path: string): string; join(...paths: string[]): string };
  getBuiltinModule(id: "node:url"): { fileURLToPath(url: string): string };
};
const { readFileSync } = process.getBuiltinModule("node:fs");
const { dirname, join } = process.getBuiltinModule("node:path");
const { fileURLToPath } = process.getBuiltinModule("node:url");

/** The built app: read and written in place. */
export const DIST = join(dirname(fileURLToPath(import.meta.url)), "../../dist");

/** The production origin (`routes` in wrangler.jsonc). */
export const ORIGIN = "https://wrenfield.excom.dev";

/** Matched by the fallback route alone: rendered to `404.html`. */
export const NOT_FOUND = "/404";

/** The one file of every order page (`public/_redirects`). */
export const ORDER_SHELL = "/account/orders/order";

/** The person's pages: written as the shell, rendered in the browser. */
export const SHELL_ROUTES = [
  "/saved",
  "/bag",
  ...["details", "delivery", "payment", "review", "complete"].map((step) => `/bag/checkout/${step}`),
  "/account",
  ORDER_SHELL,
];

/** The catalogue's pages: home, the shop, each category and piece, the two pages about the house. */
export const catalogRoutes = ({ products }: { products: { category: string; slug: string }[] }): string[] => [
  "/",
  "/shop",
  ...Object.keys(CATEGORIES).map((category) => `/shop/${category}`),
  ...products.map(({ category, slug }) => `/shop/${category}/${slug}`),
  "/account/story",
  "/account/delivery-returns",
];

/**
 * The service worker's answers: the state of the person's device
 * (IndexedDB), fetched for the render and never shipped.
 */
export const isDeviceState = (absoluteUrl: string): boolean => new URL(absoluteUrl).pathname.startsWith("/api/");

/** What the host serves with no file of its own: the worker's API, and every order page through a rewrite. */
export const isServedElsewhere = (absoluteUrl: string): boolean =>
  isDeviceState(absoluteUrl) || new URL(absoluteUrl).pathname.startsWith("/account/orders/");

/**
 * The service worker's API as a first visit finds it: GET requests on the
 * default state, each on its own, so a page's visit records nothing another
 * page sees.
 */
export const firstVisitApi =
  (catalog: string) =>
  (request: Request): Promise<Response> | undefined =>
    request.method === "GET"
      ? createApi({ store: memoryStore(), fetchCatalog: async () => new Response(catalog), origin: ORIGIN })(request)
      : undefined;

/** The `prerender()` options; `catalog` is the JSON the build copied into `dist`. */
export default (catalog = readFileSync(join(DIST, "data/catalog.json"), "utf8")) => ({
  root: DIST,
  out: DIST,
  origin: ORIGIN,
  routes: catalogRoutes(JSON.parse(catalog)),
  shellRoutes: SHELL_ROUTES,
  notFound: NOT_FOUND,
  entry: () => import("./entry"),
  exclude: isDeviceState,
  // the runner's link check (not a `prerender()` option)
  servedElsewhere: isServedElsewhere,
  api: firstVisitApi(catalog),
});
