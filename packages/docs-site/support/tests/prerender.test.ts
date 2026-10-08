import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/nucleus-test";
import { Quark } from "@excom/quark";

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://nucleus.excom.dev/</loc></url>
  <url><loc>https://nucleus.excom.dev/docs/quick_start</loc></url>
  <url><loc>https://nucleus.excom.dev/packages/a&amp;b</loc></url>
</urlset>
`;

const originalLoader = Quark.moduleLoader;
const config = await import("../prerender/prerender.config");
const entry = await import("../prerender/entry");

afterAll(() => {
  Quark.moduleLoader = originalLoader;
});

afterEach(() => {
  document.head
    .querySelectorAll('link[rel="canonical"], meta[property="og:url"]')
    .forEach((node) => node.remove());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("prerender config", () => {
  it("renders every sitemap URL from dist into dist, the fallback to 404.html", async () => {
    const options = config.default(SITEMAP);
    expect(options).toMatchObject({
      root: config.DIST,
      origin: "https://nucleus.excom.dev",
      routes: ["/", "/docs/quick_start", "/packages/a&b"],
      notFound: "/404",
    });
    // no `out`: pages are written into `root`
    expect(options).not.toHaveProperty("out");
    expect(config.DIST).toMatch(/\/packages\/docs-site\/dist$/);
    expect(options.exclude).toBe(config.isClientState);
    // the runner's link check skips them too: no file serves them
    expect(options.servedElsewhere).toBe(config.isClientState);
    expect(options.api).toBe(config.api);
    expect(await options.entry()).toBe(entry);
  });

  it("refuses an empty sitemap and URLs off the site", () => {
    expect(() => config.default("<urlset></urlset>")).toThrow(
      "prerender: the sitemap lists no URL"
    );
    expect(() =>
      config.default("<url><loc>https://elsewhere.test/x</loc></url>")
    ).toThrow(
      "prerender: https://elsewhere.test/x is not on https://nucleus.excom.dev"
    );
  });

  it("keeps what the service worker answers from client state out of pages", () => {
    expect(
      [
        "https://nucleus.excom.dev/api/todos/1",
        "https://nucleus.excom.dev/sandbox/todo-app",
        "https://nucleus.excom.dev/views/todo-app/todo-app.html",
        "https://nucleus.excom.dev/package-metas/index.json",
      ].map(config.isClientState)
    ).toEqual([true, true, false, false]);
  });

  it("answers the demos' todo reads from the service worker's seed", async () => {
    const get = async (path: string) => {
      const response = config.api(new Request(`https://nucleus.excom.dev${path}`));
      return response && [response.status, await response.json()];
    };
    const [status, all] = (await get("/api/todos"))!;
    expect(status).toBe(200);
    expect(all.map(({ id }: { id: number }) => id)).toEqual([1, 2, 3]);
    expect((await get("/api/todos?_limit=2"))![1]).toHaveLength(2);
    expect(await get("/api/todos/2")).toEqual([200, all[1]]);
    expect(await get("/api/todos/9")).toEqual([404, { message: "not found" }]);
    expect(await get("/api/todos/x")).toBeUndefined();
    expect(await get("/api/names")).toEqual([200, [
      { id: 1, name: "Hans", surname: "Emil" },
      { id: 2, name: "Max", surname: "Mustermann" },
      { id: 3, name: "Roman", surname: "Tisch" },
    ]]);
    expect(await get("/api/echo")).toBeUndefined();
  });
});

describe("prerender entry", () => {
  it("names the elements a prerender must not define", () => {
    expect(entry.SERVER_EXCLUDED_TAGS).toContain("service-worker");
  });

  it("loads @use modules from the built files, extensionless as .js", () => {
    const file = (name: string) => `file://${config.DIST}/${name}`;
    expect(entry.moduleFile("/shell")).toBe(file("shell.js"));
    expect(entry.moduleFile(`${location.origin}/demo-utils`)).toBe(
      file("demo-utils.js")
    );
    expect(entry.moduleFile("/views/cells-app/cells-app.js")).toBe(
      file("views/cells-app/cells-app.js")
    );
    expect(() => entry.moduleFile("https://cdn.test/x.js")).toThrow(
      "https://cdn.test/x.js is not a module of this site"
    );
  });

  it("points Quark's module loader at those files", async () => {
    expect(Quark.moduleLoader).not.toBe(originalLoader);
    await expect(Quark.moduleLoader("/no-such-module")).rejects.toThrow(
      "no-such-module.js"
    );
  });

  it("starts each page from a cold load of its URL and settles on Quark", async () => {
    entry.beforeRender({ url: "/docs/quick_start", window } as never);
    expect(location.pathname).toBe("/docs/quick_start");
    // no cap of its own: the renderer's budget bounds the page
    const settled = vi.spyOn(Quark, "whenSettled").mockResolvedValue("settled");
    expect(await entry.settle()).toBe("settled");
    expect(settled).toHaveBeenCalledWith({ timeout: Infinity });
  });

  const render = (url: string, routes: string) => {
    document.body.innerHTML = routes;
    // the hook asks for the page's markdown file: no such file here
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(null, { status: 404 })
    );
    entry.afterRender({
      url,
      window,
      notFound: url === config.NOT_FOUND,
      document,
    } as never);
    return [
      document.head
        .querySelector('link[rel="canonical"]')
        ?.getAttribute("href"),
      document.head
        .querySelector('meta[property="og:url"]')
        ?.getAttribute("content"),
    ];
  };

  it("gives a routed page its canonical URL and og:url, without query or hash", () => {
    const url = `${location.origin}/packages/quark`;
    expect(
      render(
        "/packages/quark?tab=api#md-usage",
        `<spa-route is-active></spa-route>`
      )
    ).toEqual([url, url]);
  });

  it("gives the not-found page neither", () => {
    expect(
      render(config.NOT_FOUND, `<spa-route is-fallback is-active></spa-route>`)
    ).toEqual([undefined, undefined]);
  });

  it("fails a soft 404 and a not-found path a route matched", () => {
    expect(() =>
      render("/nope", `<spa-route is-fallback is-active></spa-route>`)
    ).toThrow("/nope matches no route");
    expect(() =>
      render(config.NOT_FOUND, `<spa-route is-active></spa-route>`)
    ).toThrow("/404 is not the fallback route");
  });
});
