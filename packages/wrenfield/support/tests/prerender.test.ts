// The prerender config: its routes against index.html's, the host's rewrite of order pages, and what hydrating a
// prerendered page changes.
import { createRenderer, type Renderer } from "@excom/nucleus-ssr";
import { hydrate } from "@excom/nucleus-ssr/testing";
import { afterAll, beforeAll, describe, expect, it, readFileRelative, vi } from "@excom/nucleus-test";
import { ROOT } from "./backend/worker.mjs";
import { hostAnswers } from "./host.mjs";

const config = await import("../prerender/prerender.config");
const CATALOG = readFileRelative(import.meta.url, "../../public/data/catalog.json");
const INDEX = readFileRelative(import.meta.url, "../../index.html");
// as built, less the stylesheet the build makes of shell.css: public/ has no file for it
const SHELL = INDEX.replace('<link rel="stylesheet" href="./shell.css">', "");

/** index.html's routes, in order: a pattern, the view each renders, whether it is the fallback or loads when idle. */
// the body only: parsing the head loads its remote stylesheets too
const BODY = new DOMParser().parseFromString(INDEX.match(/<body[\s\S]*<\/body>/)![0], "text/html");
const ROUTES = [...BODY.querySelectorAll("spa-route")].map((route) => ({
  pattern: new RegExp(route.getAttribute("route-regex") ?? `^${route.getAttribute("route-href")!.replace(/:\w+/g, "[^/]+")}$`),
  view: route.getAttribute("template-ref")!.replace(/^\/views\/|\.html$/g, ""),
  fallback: route.hasAttribute("is-fallback"),
  idle: route.getAttribute("pre-fetch") === "idle",
}));
/** The views a path renders: the fallback's only when no other route matches. */
const viewsOf = (path: string) => {
  const matched = ROUTES.filter(({ pattern, fallback }) => !fallback && pattern.test(path));
  return matched.length ? matched.map(({ view }) => view) : ["not-found/not-found"];
};

describe("prerender config", () => {
  it("renders the catalogue's pages from dist into dist, the fallback to 404.html", async () => {
    const options = config.default(CATALOG);
    // relative to the config's folder; no `out`: pages are written into `root`
    expect(options).toMatchObject({
      root: "../../dist",
      origin: "https://wrenfield.excom.dev",
      notFound: "/404",
      shellRoutes: config.SHELL_ROUTES,
      exclude: config.isDeviceState,
      servedElsewhere: config.isServedElsewhere,
    });
    expect(options).not.toHaveProperty("out");
    // the backend's categories, the catalogue's pieces
    expect(config.catalogRoutes({ products: [{ category: "tables", slug: "a-table" }] })).toEqual([
      "/",
      "/shop",
      ...["seating", "tables", "storage", "lighting", "objects"].map((category) => `/shop/${category}`),
      "/shop/tables/a-table",
      "/account/story",
      "/account/delivery-returns",
    ]);
    const { products } = JSON.parse(CATALOG);
    expect(options.routes).toEqual(config.catalogRoutes({ products }));
    expect(options.routes).toHaveLength(53);
  });

  it("renders the catalogue's views and writes the person's as the shell, every route of index.html one or the other", () => {
    const rendered = new Set(config.default(CATALOG).routes.flatMap(viewsOf));
    const shells = new Set(config.SHELL_ROUTES.flatMap(viewsOf));
    expect([...rendered]).toEqual(["home/home", "shop/shop", "product/product", "story/story", "delivery-returns/delivery-returns"]);
    expect([...shells]).toEqual(["saved/saved", "bag/bag", "checkout/checkout", "checkout/complete", "account/account", "order/order"]);
    expect(ROUTES.filter(({ view, fallback }) => !fallback && !rendered.has(view) && !shells.has(view))).toEqual([]);
    expect(viewsOf(config.NOT_FOUND)).toEqual(["not-found/not-found"]);
  });

  it("keeps the service worker's answers out of pages, and the link check off them and order pages", () => {
    const paths = ["/api/me", "/api/products?category=tables", "/account/orders/WF-24001", "/views/home/home.html", "/shop"];
    const absolute = paths.map((path) => `${config.ORIGIN}${path}`);
    expect(absolute.map(config.isDeviceState)).toEqual([true, true, false, false, false]);
    expect(absolute.map(config.isServedElsewhere)).toEqual([true, true, true, false, false]);
  });

  it("answers GET requests as a first visit, each from the default state", async () => {
    const api = config.firstVisitApi(CATALOG);
    const get = async (path: string) => (await api(new Request(`${config.ORIGIN}/api${path}`))!).json();
    expect(await get("/products/thorpe-coffee-table")).toMatchObject({ name: "Thorpe Coffee Table", isSold: false });
    // that visit recorded nothing for the next request: no piece seen yet
    expect(await get("/home")).toMatchObject({ recent: [] });
    expect(await get("/me")).toMatchObject({ bag: { count: 0 }, saved: { count: 0 }, isTrade: false });
    expect(api(new Request(`${config.ORIGIN}/api/bag`, { method: "POST", body: "{}" }))).toBeUndefined();
  });

  it("serves the one order shell for every order page through the host's rewrite, and 404.html for the rest", async () => {
    const order = `${config.ORDER_SHELL.slice(1)}.html`;
    const files = {
      _redirects: readFileRelative(import.meta.url, "../../public/_redirects"),
      [order]: "",
      "account/story.html": "",
      "404.html": "",
    };
    expect(config.SHELL_ROUTES).toContain(config.ORDER_SHELL);
    expect(await hostAnswers(files, ["/account/orders/WF-24001", config.ORDER_SHELL, "/account/story", "/account/nope", "/api/me"])).toEqual([
      [200, order],
      [200, order],
      [200, "account/story.html"],
      [404, "404.html"],
      [404, "404.html"],
    ]);
  });
});

describe("prerender entry", () => {
  /** A rendered page: the routes, then a view's provider. */
  const page = (fallback: boolean, provider = "") =>
    new DOMParser().parseFromString(
      `<body><spa-route route-href="/shop"${fallback ? "" : " is-active"}></spa-route><spa-route is-fallback${fallback ? " is-active" : ""}></spa-route>${provider}</body>`,
      "text/html",
    );

  it("is Nucleus Kit's server entry, its afterRender with the app's check added", async () => {
    const entry = await import("../prerender/entry");
    const kit = await import("@excom/nucleus-kit/server");
    expect(entry).toMatchObject({ beforeRender: kit.beforeRender, settle: kit.settle, SERVER_EXCLUDED_TAGS: kit.SERVER_EXCLUDED_TAGS });
    expect(entry.afterRender).not.toBe(kit.afterRender);
  });

  it("fails a route only the fallback matches, a not-found path a route matches, and data that came back an error", async () => {
    const { afterRender } = await import("../prerender/entry");
    const check = (url: string, document: Document) => () => afterRender({ url, notFound: url === config.NOT_FOUND, document });
    expect(check("/shop", page(false))).not.toThrow();
    expect(check(config.NOT_FOUND, page(true))).not.toThrow();
    expect(check("/shop/nope", page(true))).toThrow("/shop/nope matches no route");
    expect(check(config.NOT_FOUND, page(false))).toThrow("/404 is not the fallback route");
    const failed = page(false, '<provider-fetch api-url="/api/products/gone" is-error></provider-fetch>');
    expect(check("/shop", failed)).toThrow("/shop: /api/products/gone answered an error");
  });
});

describe("a prerendered page hydrated in the renderer's window, the backend answering", () => {
  let renderer: Renderer;
  let app: typeof import("../prerender/entry");

  beforeAll(async () => {
    renderer = await createRenderer({
      ...config.default(CATALOG),
      root: ROOT,
      shell: SHELL,
      entry: async () => {
        vi.resetModules();
        return (app = await import("../prerender/entry"));
      },
    });
  });
  afterAll(() => renderer.close());

  const MAIN = "body > provider-fetch#me > spa-manager > main";
  /** Load-state attributes an element gets as it loads, absent from the page as written. */
  const loads = (element: string, names = ["is-success", "did-load"]) => names.map((name) => ({ element, name, server: null, final: "" }));

  it.each([
    ["/", "home", "/api/home"],
    ["/shop/tables/thorpe-coffee-table", "product", "/api/products/thorpe-coffee-table"],
  ])("%s keeps its catalogue content: only what was kept out loads again", async (url, view, data) => {
    const { html } = await renderer.render(url);
    const report = await hydrate(renderer.window, html, { beforeParse: () => app.beforeRender({ url }) });
    const body = await (await config.firstVisitApi(CATALOG)(new Request(`${config.ORIGIN}${data}`))!).json();
    // the catalogue in the page itself, the splash gone at first paint, no API answer in the island
    expect(html).toContain(view === "home" ? body.hero.name : `<h1 bind-product="name">${body.name}</h1>`);
    expect(html).toMatch(/<spa-manager [^>]*has-rendered=""/);
    const island = JSON.parse(html.match(/<script type="application\/json" id="nucleus-hydration">(.*?)<\/script>/s)![1]!);
    expect(island.responses.map(({ url }: { url: string }) => url).filter((path: string) => path.startsWith("/api/"))).toEqual([]);

    expect(report).toMatchObject({ removed: [], added: [], texts: [], flashes: [], keptOut: [] });
    // in document order: the person's data and the view's, kept out of the page, load again, and every other route
    // that loads when idle loads its template
    const route = ROUTES.findIndex(({ pattern, fallback }) => !fallback && pattern.test(url)) + 1;
    const others = ROUTES.flatMap(({ idle }, index) =>
      idle && index + 1 !== route ? [{ n: index + 1, change: loads(`${MAIN} > spa-route:nth-of-type(${index + 1})`, ["did-load"]) }] : [],
    );
    expect(report.attributes).toEqual([
      ...loads("body > provider-fetch#me"),
      ...others.filter(({ n }) => n < route).flatMap(({ change }) => change),
      ...loads(`${MAIN} > spa-route:nth-of-type(${route}) > article#${view} > provider-fetch`),
      ...others.filter(({ n }) => n > route).flatMap(({ change }) => change),
    ]);
    expect(report.requests.filter(({ url }) => url.includes("/api/")).map(({ url }) => url)).toEqual([
      `${config.ORIGIN}/api/me`,
      `${config.ORIGIN}${data}`,
    ]);
  });
});
