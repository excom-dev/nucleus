import { prerender, type PrerenderCache } from "../../index";
import { loadKit, ORIGIN, ownEntry, SITE } from "./helpers";
import { afterEach, describe, expect, it } from "@excom/nucleus-test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROUTES = ["/", "/menu", "/specials/", "/optional"];
const NOT_FOUND = "/no-such-page";
const SITE_SHELL = readFileSync(join(SITE, "index.html"), "utf8");
// a page that renders whether or not `/later.json` is there
const OPTIONAL = SITE_SHELL.replace(
  /<body>[\s\S]*<\/body>/,
  "<body><x-optional></x-optional></body>"
);

// time limits that hold on a loaded machine: a page fails only when it never
// settles, a test or its cleanup only when it never ends (removing temporary
// directories took up to 56 s with memory swapping)
const BUDGET = 30_000;
const LIMIT = 120_000;

const temporary: string[] = [];
afterEach(() => {
  temporary.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
}, LIMIT);

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "nucleus-ssr-cache-"));
  temporary.push(dir);
  return dir;
};

/**
 * The kit, waiting for Quark to settle without its own 1 s cap (on a loaded
 * machine a page would be written before it settled; `budgetMs` bounds it),
 * plus `x-optional`: the text of `/later.json`, or "none" while it 404s.
 */
const entry = async () => {
  const kit = await loadKit();
  const { Quark } = await import("@excom/quark");
  customElements.define(
    "x-optional",
    class extends HTMLElement {
      async connectedCallback() {
        const response = await fetch("/later.json");
        this.textContent = response.ok ? await response.text() : "none";
      }
    }
  );
  return { ...kit, settle: () => Quark.whenSettled({ timeout: Infinity }) };
};

/** The pages under `dir`, by file. */
const pagesIn = (dir: string) =>
  Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith(".html"))
      .sort()
      .map((file) => [file, readFileSync(join(dir, file), "utf8")])
  );

/** Why each page the cache did not give rendered, by URL. */
const missesOf = ({ pages }: { pages: { url: string; cacheMiss?: string }[] }) =>
  Object.fromEntries(pages.filter((page) => page.cacheMiss).map(({ url, cacheMiss }) => [url, cacheMiss]));

/** A copy of the fixture site, and a run that renders it to a fresh directory with `cache`. */
const setUp = (cache: Partial<PrerenderCache> = {}) => {
  const root = tempDir();
  cpSync(SITE, root, { recursive: true });
  const options = { dir: tempDir(), key: "v1", verify: 0, ...cache };
  const run = async (overrides: Partial<PrerenderCache> = {}) => {
    const out = tempDir();
    const report = await prerender({
      root,
      out,
      origin: ORIGIN,
      entry,
      budgetMs: BUDGET,
      shell: (url) => (url === "/optional" ? OPTIONAL : SITE_SHELL),
      routes: ROUTES,
      notFound: NOT_FOUND,
      cache: { ...options, ...overrides },
    });
    return { report, out, reused: report.pages.filter((page) => page.reused).map(({ url }) => url) };
  };
  return { root, cacheFile: join(options.dir, "pages.json"), run };
};

describe("prerender with a cache", { timeout: LIMIT }, () => {
  it("reuses every page of a second run, written byte for byte as the first", async () => {
    const { run } = setUp();
    const first = await run();
    expect(first.reused).toEqual([]);
    expect(new Set(Object.values(missesOf(first.report)))).toEqual(new Set(["no cache found"]));
    const second = await run();
    expect(second.reused).toEqual([...ROUTES, NOT_FOUND]);
    expect(missesOf(second.report)).toEqual({});
    expect(pagesIn(second.out)).toEqual(pagesIn(first.out));
    // a reused page keeps its diagnostics
    expect(second.report.pages.map(({ diagnostics }) => diagnostics)).toEqual(
      first.report.pages.map(({ diagnostics }) => diagnostics)
    );
    expect(second.report.verified).toEqual([]);
  });

  it("renders again exactly the pages whose fetched file changed", async () => {
    const { root, run } = setUp();
    await run();
    const menu = join(root, "data/menu.json");
    writeFileSync(menu, readFileSync(menu, "utf8").replace("Rhubarb crumble", "Plum tart"));
    const { reused, out, report } = await run();
    expect(reused).toEqual(["/", "/optional", NOT_FOUND]);
    expect(missesOf(report)).toEqual({
      "/menu": "GET /data/menu.json answered another body",
      "/specials/": "GET /data/menu.json answered another body",
    });
    expect(readFileSync(join(out, "menu.html"), "utf8")).toContain("Plum tart");
  });

  it("renders again a page that got a 404 where a file now is", async () => {
    const { root, run } = setUp();
    const first = await run();
    expect(readFileSync(join(first.out, "optional.html"), "utf8")).toContain("<x-optional>none</x-optional>");
    writeFileSync(join(root, "later.json"), "later");
    const { reused, out, report } = await run();
    expect(reused).toEqual(["/", "/menu", "/specials/", NOT_FOUND]);
    expect(missesOf(report)).toEqual({ "/optional": "GET /later.json answered 404, now 200" });
    expect(readFileSync(join(out, "optional.html"), "utf8")).toContain("<x-optional>later</x-optional>");
  });

  it("renders again a page whose api response turned private, which fails it", async () => {
    let headers = {};
    const options = {
      root: SITE,
      origin: ORIGIN,
      shell: "<p>Today: <x-today></x-today></p>",
      api: () => new Response('"Plum tart"', { headers }),
      entry: async () => {
        customElements.define(
          "x-today",
          class extends HTMLElement {
            async connectedCallback() {
              this.textContent = await (await fetch("/api/today")).text();
            }
          }
        );
      },
      routes: ["/"],
      cache: { dir: tempDir(), key: "v1", verify: 0 },
    };
    await prerender({ ...options, out: tempDir() });
    expect((await prerender({ ...options, out: tempDir() })).pages[0]!.reused).toBe(true);
    headers = { "cache-control": "private" };
    await expect(prerender({ ...options, out: tempDir() })).rejects.toMatchObject({
      report: {
        pages: [
          {
            reused: false,
            cacheMiss: "a response it used is private now",
            diagnostics: { errors: [expect.stringContaining("Private response to GET")] },
          },
        ],
      },
    });
  });

  it("reuses a page whose aborted request got no answer: it gave the page nothing", async () => {
    const options = {
      root: SITE,
      origin: ORIGIN,
      shell: "<p><x-abort></x-abort></p>",
      entry: async () => {
        customElements.define(
          "x-abort",
          class extends HTMLElement {
            connectedCallback() {
              const controller = new AbortController();
              fetch("/data/menu.json", { signal: controller.signal }).catch(() => {});
              controller.abort();
            }
          }
        );
      },
      routes: ["/"],
      cache: { dir: tempDir(), key: "v1", verify: 0 },
    };
    const first = await prerender({ ...options, out: tempDir() });
    expect(first.pages[0]!.diagnostics.requests).toEqual([
      { method: "GET", url: `${ORIGIN}/data/menu.json`, status: 0 },
    ]);
    expect((await prerender({ ...options, out: tempDir() })).pages[0]!.reused).toBe(true);
  });

  it("renders every page again when what the entry fetched while it loaded changed", async () => {
    const root = tempDir();
    cpSync(SITE, root, { recursive: true });
    writeFileSync(join(root, "prices.json"), "4.50");
    const options = {
      root,
      origin: ORIGIN,
      shell: "<p>Pie: <x-price></x-price></p>",
      // once, before any page: in no page's requests
      entry: async () => {
        const price = await (await fetch("/prices.json")).text();
        customElements.define(
          "x-price",
          class extends HTMLElement {
            connectedCallback() {
              this.textContent = price;
            }
          }
        );
      },
      routes: ["/a", "/b"],
      cache: { dir: tempDir(), key: "v1", verify: 0 },
    };
    await prerender({ ...options, out: tempDir() });
    writeFileSync(join(root, "prices.json"), "5.00");
    const out = tempDir();
    const { pages } = await prerender({ ...options, out });
    expect(pages.map(({ reused }) => reused)).toEqual([false, false]);
    expect(readFileSync(join(out, "b.html"), "utf8")).toContain("<x-price>5.00</x-price>");
  });

  it("renders again a page whose shell changed, and every page when the fixed shell did", async () => {
    const titles: Record<string, string> = { "/a": "A", "/b": "B" };
    const options = {
      root: SITE,
      origin: ORIGIN,
      entry: ownEntry(),
      routes: ["/a", "/b"],
      cache: { dir: tempDir(), key: "v1", verify: 0 },
    };
    const own = {
      ...options,
      shell: (url: string) =>
        `<!doctype html><html><head><title>${titles[url]}</title></head><body><x-own></x-own></body></html>`,
    };
    await prerender({ ...own, out: tempDir() });
    titles["/b"] = "Bee";
    const changed = await prerender({ ...own, out: tempDir() });
    expect(changed.pages.map(({ reused }) => reused)).toEqual([true, false]);
    expect(missesOf(changed)).toEqual({ "/b": "the shell changed" });
    const root = tempDir();
    cpSync(SITE, root, { recursive: true });
    const fixed = { ...options, root };
    await prerender({ ...fixed, out: tempDir() });
    expect((await prerender({ ...fixed, out: tempDir() })).pages.map(({ reused }) => reused)).toEqual([true, true]);
    writeFileSync(join(root, "index.html"), SITE_SHELL.replace("Wren Café", "Wren Bistro"));
    expect(missesOf(await prerender({ ...fixed, out: tempDir() }))).toEqual({
      "/a": "the shell changed",
      "/b": "the shell changed",
    });
  });

  it("renders every page again under another key", async () => {
    const { run } = setUp();
    await run();
    const { reused, report } = await run({ key: "v2" });
    expect(reused).toEqual([]);
    expect(new Set(Object.values(missesOf(report)))).toEqual(new Set(["the cache key changed"]));
    expect(Object.keys(missesOf(report))).toHaveLength(5);
  });

  it("says a page was not in the cache, or failed in the run that wrote it", async () => {
    const root = tempDir();
    cpSync(SITE, root, { recursive: true });
    const view = join(root, "views/menu.html");
    const menu = readFileSync(view, "utf8");
    rmSync(view);
    const options = {
      root,
      origin: ORIGIN,
      entry,
      budgetMs: BUDGET,
      onError: "shell" as const,
      cache: { dir: tempDir(), key: "v1", verify: 0 },
    };
    expect((await prerender({ ...options, routes: ["/", "/menu"], out: tempDir() })).failed).toEqual(["/menu"]);
    writeFileSync(view, menu);
    const report = await prerender({ ...options, routes: ["/", "/menu", "/specials"], out: tempDir() });
    expect(missesOf(report)).toEqual({
      "/menu": "it failed in the last run",
      "/specials": "not in the cache",
    });
  });

  it("renders reused pages again to verify them, and fails the run on a difference, discarding the cache", async () => {
    const { cacheFile, run } = setUp({ verify: 10 });
    await run();
    const verified = await run();
    expect(verified.reused).toHaveLength(5);
    expect(verified.report.verified).toEqual([...ROUTES, NOT_FOUND]);
    // as if an input the key misses had changed since
    const stored = JSON.parse(readFileSync(cacheFile, "utf8"));
    stored.pages["/menu"].html = stored.pages["/menu"].html.replace("Rhubarb crumble", "Plum tart");
    writeFileSync(cacheFile, JSON.stringify(stored));
    await expect(run()).rejects.toThrow(
      "nucleus-ssr: /menu rendered other HTML than cached from the same shell and requests: the cache key misses an input. The cache is discarded"
    );
    expect(existsSync(cacheFile)).toBe(false);
  });

  it("verifies a page whose copy differs only in the order of attributes in a tag, and nothing else", async () => {
    const { cacheFile, run } = setUp({ verify: 10 });
    await run();
    const stored = JSON.parse(readFileSync(cacheFile, "utf8"));
    const menu: string = stored.pages["/menu"].html;
    const plant = (html: string) => {
      writeFileSync(cacheFile, JSON.stringify({ ...stored, pages: { ...stored.pages, "/menu": { ...stored.pages["/menu"], html } } }));
    };
    // two loads finishing in the other order: the same element
    const reordered = menu.replace('<html lang="en" n-ssr="">', '<html n-ssr="" lang="en">');
    expect(reordered).not.toBe(menu);
    plant(reordered);
    const { report } = await run();
    expect(report.verified).toContain("/menu");
    expect(report.pages.every(({ reused }) => reused)).toBe(true);
    const island = /(<script type="application\/json" id="nucleus-hydration">)(\{"v":1)/;
    expect(menu).toMatch(island);
    for (const changed of [
      reordered.replace('lang="en"', 'lang="fr"'),
      reordered.replace("<h2>Menu</h2>", "<h2>Menus</h2>"),
      reordered.replace(island, '$1{"v":1,"x":0'),
    ]) {
      plant(changed);
      await expect(run()).rejects.toThrow("nucleus-ssr: /menu rendered other HTML than cached");
    }
  });

  it("fails the run on a verified page that renders other HTML each time, without blaming the key", async () => {
    let renders = 0;
    const options = {
      root: SITE,
      origin: ORIGIN,
      shell: "<p>Visit <x-count></x-count></p>",
      entry: async () => {
        customElements.define(
          "x-count",
          class extends HTMLElement {
            connectedCallback() {
              this.textContent = String(++renders);
            }
          }
        );
      },
      routes: ["/"],
      cache: { dir: tempDir(), key: "v1", verify: 1 },
    };
    await prerender({ ...options, out: tempDir() });
    await expect(prerender({ ...options, out: tempDir() })).rejects.toThrow(
      "nucleus-ssr: / rendered other HTML each time: its output is not deterministic (ids, the clock, the order requests complete in), so no cache can hold it"
    );
    expect(renders).toBe(3);
    expect(existsSync(join(options.cache.dir, "pages.json"))).toBe(true);
  });

  it("says a verified page that fails now was rendered again to verify the cache", async () => {
    let renders = 0;
    const options = {
      root: SITE,
      origin: ORIGIN,
      shell: "<p><x-flaky></x-flaky></p>",
      entry: async () => {
        customElements.define(
          "x-flaky",
          class extends HTMLElement {
            connectedCallback() {
              if (++renders > 1) console.error("flaky");
            }
          }
        );
      },
      routes: ["/"],
      cache: { dir: tempDir(), key: "v1", verify: 1 },
    };
    await prerender({ ...options, out: tempDir() });
    await expect(prerender({ ...options, out: tempDir() })).rejects.toMatchObject({
      report: {
        pages: [{ reused: false, cacheMiss: "rendered again to verify the cache", diagnostics: { errors: ["flaky"] } }],
        verified: [],
      },
    });
  });

  it("writes no cache from a failed run, and keeps the last one", async () => {
    const { cacheFile, root, run } = setUp();
    // a view the menu route needs is gone
    const view = join(root, "views/menu.html");
    const menu = readFileSync(view, "utf8");
    rmSync(view);
    await expect(run()).rejects.toThrow("nucleus-ssr: 2 of 5 pages failed: /menu, /specials/");
    expect(existsSync(cacheFile)).toBe(false);
    writeFileSync(view, menu);
    await run();
    const written = readFileSync(cacheFile, "utf8");
    rmSync(view);
    await expect(run()).rejects.toThrow("pages failed");
    expect(readFileSync(cacheFile, "utf8")).toBe(written);
  });

  it("renders the same bytes twice", async () => {
    const { run } = setUp();
    const first = await run({ dir: tempDir() });
    const second = await run({ dir: tempDir() });
    expect(second.reused).toEqual([]);
    expect(pagesIn(second.out)).toEqual(pagesIn(first.out));
  });
});
