import {
  afterEach,
  describe,
  expect,
  it,
  readFileRelative,
  vi,
} from "@excom/nucleus-test";

const entry = await import("../prerender/entry");

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("a page's markdown file", () => {
  it("is the Introduction's at the docs home, `/docs/<name>.md` for a guide, `/<package>.md` for a package", () => {
    expect(entry.markdownHref("/")).toBe("/docs/introduction.md");
    expect(entry.markdownHref("/docs/quick_start")).toBe(
      "/docs/quick_start.md"
    );
    expect(entry.markdownHref("/packages/spa-route")).toBe(
      "/spa-route.md"
    );
  });

  it("is none for the pages with no markdown", () => {
    for (const pathname of [
      // the old address: no page here
      "/nucleus",
      "/nucleus/docs/quick_start",
      "/examples/todos",
      // a package's doc page: only the package's own page is mirrored
      "/packages/spa-route/quick_start",
      "/docs",
      "/docs/a/b",
      "/packages/",
      "/other/docs/quick_start",
      "/404",
    ]) {
      expect(entry.markdownHref(pathname), pathname).toBeUndefined();
    }
  });
});

describe("a prerendered page's head", () => {
  /** The files the site serves; any other path answers 404. */
  const SERVED = new Set([
    "/docs/introduction.md",
    "/docs/quick_start.md",
    "/spa-route.md",
  ]);
  const answer = (path: string) =>
    new Response(null, { status: SERVED.has(path) ? 200 : 404 });
  // a template to render, or the route logs that it has none
  const ROUTE = (attributes: string) =>
    `<spa-route ${attributes}><template></template></spa-route>`;
  const ROUTED = ROUTE("is-active");

  /** `afterRender` for `url`, whose window answers `fetch` as the site would. */
  const render = async (
    url: string,
    routes = ROUTED,
    fetch = vi.fn(async (path: string) => answer(path))
  ) => {
    document.body.innerHTML = routes;
    await entry.afterRender({
      url,
      window: { fetch },
      notFound: url === "/404",
      document,
    } as never);
    return {
      fetch,
      link: document.head.querySelector('link[rel="alternate"]'),
    };
  };

  it("links the page's markdown file after its canonical link and og:url, once a HEAD request for it is ok", async () => {
    const { fetch, link } = await render(
      "/docs/quick_start?tab=api#md-usage"
    );
    expect(fetch.mock.calls).toEqual([
      ["/docs/quick_start.md", { method: "HEAD" }],
    ]);
    expect(link!.outerHTML).toBe(
      `<link rel="alternate" type="text/markdown" href="${location.origin}/docs/quick_start.md" title="Markdown version of this page">`
    );
    expect(
      [...document.head.children].map(
        (node) => node.getAttribute("rel") ?? node.getAttribute("property")
      )
    ).toEqual(["canonical", "og:url", "alternate"]);
  });

  it("links the docs home and a package's page the same way, and a package whose file is missing none", async () => {
    expect((await render("/")).link!.getAttribute("href")).toBe(
      `${location.origin}/docs/introduction.md`
    );
    document.head.innerHTML = "";
    expect(
      (await render("/packages/spa-route")).link!.getAttribute("href")
    ).toBe(`${location.origin}/spa-route.md`);
    document.head.innerHTML = "";
    // a 404 answer is no error: the page keeps its canonical link and og:url
    const { fetch, link } = await render("/packages/quark");
    expect(fetch).toHaveBeenCalledWith("/quark.md", { method: "HEAD" });
    expect(link).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeNull();
  });

  it("links nothing when the request fails: an error is no answer", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { link } = await render("/docs/quick_start", ROUTED, failing);
    expect(link).toBeNull();
    expect(
      document.head.querySelector('meta[property="og:url"]')
    ).not.toBeNull();
  });

  it("asks for no file for a page with no markdown, nor for the not-found page", async () => {
    for (const [url, routes] of [
      ["/examples/todos", ROUTED],
      ["/packages/spa-route/quick_start", ROUTED],
      ["/404", ROUTE("is-fallback is-active")],
    ]) {
      const { fetch, link } = await render(url!, routes);
      expect(fetch, url).not.toHaveBeenCalled();
      expect(link, url).toBeNull();
      document.head.innerHTML = "";
    }
  });

  it("fails a soft 404 as it did, before any request", () => {
    const fetch = vi.fn();
    document.body.innerHTML = ROUTE("is-fallback is-active");
    expect(() =>
      entry.afterRender({
        url: "/docs/quick_start",
        window: { fetch },
        document,
      } as never)
    ).toThrow("/docs/quick_start matches no route");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("robots.txt", () => {
  const robots = readFileRelative(import.meta.url, "../../public/robots.txt");
  const rules = robots.slice(robots.indexOf("User-agent"));

  it("names the plain-text documentation in a comment above the rules", () => {
    const comment = robots.slice(0, robots.indexOf("User-agent"));
    for (const path of [
      "/llms.txt",
      "/llms-full.txt",
      "/docs/<page>.md",
      "/<package>.md",
    ]) {
      expect(comment, path).toContain(path);
    }
    expect(
      comment
        .trim()
        .split("\n")
        .every((line) => line.startsWith("#"))
    ).toBe(true);
    expect(robots).not.toMatch(/JavaScript application/i);
  });

  it("keeps the rules", () => {
    expect(rules).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://nucleus.excom.dev/sitemap.xml\n"
    );
  });
});
