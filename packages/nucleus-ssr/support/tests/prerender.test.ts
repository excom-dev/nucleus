import { createRenderer, prerender } from "../../index";
import { routeFile } from "../../src/prerender";
import { loadKit, ORIGIN, ownEntry, parse, SITE } from "./helpers";
import { afterEach, describe, expect, it } from "@excom/nucleus-test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SITE_SHELL = readFileSync(join(SITE, "index.html"), "utf8");

const temporary: string[] = [];
afterEach(() => {
  temporary
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

/** A copy of the fixture site to prerender in place. */
const copySite = () => {
  const dir = mkdtempSync(join(tmpdir(), "nucleus-ssr-"));
  temporary.push(dir);
  cpSync(SITE, dir, { recursive: true });
  return dir;
};

const read = (dir: string, file: string) =>
  readFileSync(join(dir, file), "utf8");

describe("routeFile", () => {
  it("maps a route to a slashless file", () => {
    expect(
      [
        "/",
        "/menu",
        "/menu/",
        "/docs/a/b",
        "/caf%C3%A9",
        "/menu?x=1#top",
        "/menu.html",
        "/Guide.HTML",
      ].map(routeFile)
    ).toEqual([
      "index.html",
      "menu.html",
      "menu.html",
      "docs/a/b.html",
      "café.html",
      "menu.html",
      "menu.html",
      "Guide.HTML",
    ]);
  });

  it("refuses a route whose file could land outside the output, on any platform", () => {
    for (const route of ["/..%2Fsecret", "/a%5C..%5C..%5Csecret", "/C:/secret", "/a%00b"])
      expect(() => routeFile(route)).toThrow(
        `nucleus-ssr: route ${route} has no file in the output`
      );
  });
});

describe("prerender", () => {
  it("writes each route to a slashless file and the not-found page to 404.html", async () => {
    const site = copySite();
    const report = await prerender({
      root: site,
      out: pathToFileURL(site),
      origin: ORIGIN,
      entry: loadKit,
      routes: ["/", "/menu", "/specials/"],
      notFound: "/no-such-page",
    });
    expect(report.failed).toEqual([]);
    expect(report.pages.map(({ url, file }) => [url, file])).toEqual([
      ["/", "index.html"],
      ["/menu", "menu.html"],
      ["/specials/", "specials.html"],
      ["/no-such-page", "404.html"],
    ]);
    for (const { file, bytes, ms, diagnostics } of report.pages) {
      expect(bytes).toBe(new TextEncoder().encode(read(site, file)).byteLength);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(diagnostics.errors).toEqual([]);
    }
    expect(existsSync(join(site, "menu"))).toBe(false);
    expect(
      parse(read(site, "index.html")).querySelector("spa-route[is-active] > h1")!
        .textContent
    ).toBe("Welcome to Wren Café");
    // each page parsed the original shell, not the prerendered index.html
    for (const file of ["menu.html", "specials.html", "404.html"]) {
      const html = read(site, file);
      expect(html.match(/id="nucleus-hydration"/g)).toHaveLength(1);
      expect(parse(html).querySelectorAll("spa-route[is-active]")).toHaveLength(1);
    }
    expect(parse(read(site, "specials.html")).title).toBe("Specials");
    expect(
      parse(read(site, "404.html")).querySelector("spa-route[is-active] > h1")!
        .textContent
    ).toBe("Not found");
  });

  it("writes no file before every page has rendered: none reads another's output", async () => {
    const site = copySite();
    await prerender({
      root: site,
      out: site,
      origin: ORIGIN,
      fallback: "index.html",
      entry: loadKit,
      // its data falls back to `index.html`, which `/` writes
      shell: (url) =>
        url === "/landing"
          ? SITE_SHELL.replace(
              /<body>[\s\S]*<\/body>/,
              `<body><provider-fetch api-url="/landing-data"></provider-fetch></body>`
            )
          : SITE_SHELL,
      routes: ["/", "/landing"],
    });
    const island = JSON.parse(
      parse(read(site, "landing.html")).getElementById("nucleus-hydration")!
        .textContent!
    );
    expect(island.responses[0]).toMatchObject({
      url: "/landing-data",
      record: { body: SITE_SHELL },
    });
    expect(read(site, "index.html")).toContain('<html lang="en" n-ssr="">');
  });

  it("refuses routes that would write the same file, before rendering any", async () => {
    const options = { root: SITE, out: SITE, origin: ORIGIN, entry: loadKit };
    for (const [routes, notFound, clash] of [
      [["/menu", "/Menu"], undefined, "routes /menu and /Menu would both write Menu.html"],
      [["/a?x=1", "/a?x=2"], undefined, "routes /a?x=1 and /a?x=2 would both write a.html"],
      [["/404"], "/missing", "routes /404 and /missing would both write 404.html"],
    ] as const)
      await expect(prerender({ ...options, routes, notFound })).rejects.toThrow(
        `nucleus-ssr: ${clash}`
      );
  });

  it("writes nothing and rejects, naming the pages that failed", async () => {
    const site = copySite();
    await expect(
      prerender({
        root: site,
        out: site,
        origin: ORIGIN,
        entry: loadKit,
        // a shell function that throws is that page's failure, not the run's
        shell: (url) => {
          if (url === "/lost") throw new Error("no shell for /lost");
          return SITE_SHELL;
        },
        routes: ["/", "/broken", "/lost"],
      })
    ).rejects.toMatchObject({
      message: "nucleus-ssr: 2 of 3 pages failed: /broken, /lost",
      report: {
        failed: ["/broken", "/lost"],
        pages: [
          { url: "/", file: "index.html" },
          { url: "/broken", file: "broken.html", bytes: 0 },
          {
            url: "/lost",
            bytes: 0,
            diagnostics: { errors: ["shell: Error: no shell for /lost"] },
          },
        ],
      },
    });
    expect(read(site, "index.html")).toBe(SITE_SHELL);
    expect(existsSync(join(site, "broken.html"))).toBe(false);
  });

  it("writes nothing, whatever the policy, from a shell an earlier prerender wrote", async () => {
    const site = copySite();
    const options = { root: site, out: site, origin: ORIGIN, entry: loadKit };
    await prerender({ ...options, routes: ["/", "/menu"] });
    const written = read(site, "index.html");
    expect(written).toContain('<html lang="en" n-ssr="">');
    for (const onError of ["fail", "shell"] as const)
      for (const shell of [undefined, () => read(site, "index.html")])
        await expect(
          prerender({ ...options, onError, shell, routes: ["/", "/specials"] })
        ).rejects.toThrow(
          "nucleus-ssr: the shell was written by an earlier prerender (<html n-ssr>): rebuild the site, then prerender from its built shell"
        );
    expect(read(site, "index.html")).toBe(written);
    expect(existsSync(join(site, "specials.html"))).toBe(false);
  });

  it("writes the shell for a failed page whose route's policy is shell", async () => {
    const site = copySite();
    const report = await prerender({
      root: site,
      out: site,
      origin: ORIGIN,
      onError: (url) => (url === "/broken" ? "shell" : "fail"),
      entry: loadKit,
      routes: ["/menu", "/broken"],
    });
    expect(report.failed).toEqual(["/broken"]);
    expect(read(site, "broken.html")).toBe(SITE_SHELL);
    expect(read(site, "menu.html")).toContain('<html lang="en" n-ssr="">');
  });

  it("writes each shell route as its untouched shell: not rendered, not cached", async () => {
    const site = copySite();
    const cacheDir = mkdtempSync(join(tmpdir(), "nucleus-ssr-cache-"));
    temporary.push(cacheDir);
    const options = {
      root: site,
      out: site,
      origin: ORIGIN,
      entry: loadKit,
      routes: ["/menu"],
      shellRoutes: ["/bag", "/account/orders/order"],
      notFound: "/no-such-page",
      cache: { dir: cacheDir, key: "v1", verify: 0 },
    };
    const report = await prerender(options);
    expect(
      report.pages.map(({ url, file, shellRoute, reused, cacheMiss, diagnostics }) => [
        url,
        file,
        shellRoute,
        reused,
        cacheMiss,
        diagnostics.requests.length,
      ])
    ).toEqual([
      ["/menu", "menu.html", undefined, false, "no cache found", 3],
      ["/bag", "bag.html", true, false, undefined, 0],
      ["/account/orders/order", "account/orders/order.html", true, false, undefined, 0],
      ["/no-such-page", "404.html", undefined, false, "no cache found", 1],
    ]);
    expect(read(site, "bag.html")).toBe(SITE_SHELL);
    expect(read(site, "account/orders/order.html")).toBe(SITE_SHELL);
    const cached = JSON.parse(read(cacheDir, "pages.json"));
    expect(Object.keys(cached.pages)).toEqual(["/menu", "/no-such-page"]);
  });

  it("refuses a shell route that is rendered too, or shares a file, before rendering any", async () => {
    const options = { root: SITE, out: SITE, origin: ORIGIN, entry: loadKit };
    for (const [routes, shellRoutes, notFound, refusal] of [
      [["/menu", "/bag"], ["/bag"], undefined, "shell routes also rendered (routes, notFound): /bag"],
      [["/menu"], ["/menu", "/missing"], "/missing", "shell routes also rendered (routes, notFound): /menu, /missing"],
      [["/menu"], ["/Menu"], undefined, "routes /menu and /Menu would both write Menu.html"],
    ] as const)
      await expect(prerender({ ...options, routes, shellRoutes, notFound })).rejects.toThrow(
        `nucleus-ssr: ${refusal}`
      );
  });

  it("fails a shell route whose shell function throws, and the run on a shell an earlier prerender wrote", async () => {
    const site = copySite();
    const options = { root: site, out: site, origin: ORIGIN, entry: loadKit, routes: ["/menu"] };
    await expect(
      prerender({
        ...options,
        shellRoutes: ["/bag"],
        onError: "shell",
        shell: (url) => {
          if (url === "/bag") throw new Error("no shell for /bag");
          return SITE_SHELL;
        },
      })
    ).rejects.toMatchObject({
      message: "nucleus-ssr: 1 of 2 pages failed: /bag",
      report: {
        failed: ["/bag"],
        pages: [
          { url: "/menu", diagnostics: { errors: [] } },
          { url: "/bag", bytes: 0, shellRoute: true, diagnostics: { errors: ["shell: Error: no shell for /bag"] } },
        ],
      },
    });
    await expect(
      prerender({
        ...options,
        shellRoutes: ["/bag"],
        shell: (url) => (url === "/bag" ? SITE_SHELL.replace("<html", "<html n-ssr") : SITE_SHELL),
      })
    ).rejects.toThrow("nucleus-ssr: the shell was written by an earlier prerender");
    expect(existsSync(join(site, "menu.html"))).toBe(false);
  });

  it("stops at a render that fails before its page does, closing the renderer", async () => {
    const options = {
      root: SITE,
      origin: ORIGIN,
      shell: "<p>static</p>",
      entry: ownEntry(),
    };
    await expect(
      prerender({
        ...options,
        out: copySite(),
        routes: ["https://elsewhere.test/menu"],
      })
    ).rejects.toThrow(TypeError);
    await (await createRenderer(options)).close();
  });
});
