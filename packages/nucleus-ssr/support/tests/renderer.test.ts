import {
  createRenderer,
  type Renderer,
  type RenderPage,
} from "../../index";
import { loadKit, ORIGIN, ownEntry, parse, SITE } from "./helpers";
import { afterAll, beforeAll, describe, expect, it, vi } from "@excom/nucleus-test";
import fs, { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const SITE_SHELL = readFileSync(join(SITE, "index.html"), "utf8");
// a site whose index.html a browser parses into other elements
const MISPARSED_SITE = join(SITE, "../misparsed");
const CAUSES =
  "Usual causes: a block element inside <p>, text that looks like a tag inside an inline sheet or another element's text, a nested <a>, <form> or <button>, content a <table> cannot hold.";

// files on the build machine, outside the site, that no page may read
const SENTINELS = mkdtempSync(join(tmpdir(), "nucleus-ssr-sentinel-"));
const SECRET = `sentinel-${Math.random().toString(36).slice(2)}`;
for (const [name, content] of [
  ["secret.json", JSON.stringify({ secret: SECRET })],
  ["secret.txt", SECRET],
  ["secret.css", `body::after { content: "${SECRET}"; }`],
])
  writeFileSync(join(SENTINELS, name), content);
afterAll(() => rmSync(SENTINELS, { recursive: true, force: true }));
const LOCAL = (name: string) => pathToFileURL(join(SENTINELS, name)).href;
const DATA_CSS = `data:text/css,${"p%7Bcolor:red%7D".repeat(12)}`;
const SEPARATORS = String.fromCharCode(0x2028, 0x2029);
const NOTE = `</script><script>alert(1)</script><!-- <script type="application/json" id="nucleus-hydration">{"v":1,"provisions":{},"responses":[]}</script> ${SEPARATORS}`;
const ATTACK = "<img src=x onerror=alert(1)>";

/** The site's shell with `body` as its page. */
const page = (body: string) =>
  SITE_SHELL.replace(/<body>[\s\S]*<\/body>/, `<body>${body}</body>`);

/** Elements doing what app code does during a render; defined in the renderer's window. */
const defineTestElements = () => {
  const define = (
    tag: string,
    connected: (element: HTMLElement) => void,
    disconnected?: () => void
  ) =>
    customElements.define(
      tag,
      class extends HTMLElement {
        connectedCallback() {
          connected(this);
        }
        disconnectedCallback() {
          disconnected?.();
        }
      }
    );
  // an html paint: Quark marks the scripts it inserts; a JSON-LD block runs nothing
  define("x-paint", (element) => {
    element.innerHTML = `<p>Painted</p><script n-inert>alert(1)</script><script n-inert type="module" src="/evil.js"></script><script n-inert type="application/ld+json">{"@type":"Menu"}</script>`;
  });
  // a bundler's runtime and app code writing to <head> once mounted
  define("x-head", () => {
    queueMicrotask(() =>
      document.head.append(
        Object.assign(document.createElement("link"), {
          rel: "modulepreload",
          href: "file:///app/assets/chunk.js",
        })
      )
    );
    setTimeout(() => {
      document.head.append(
        Object.assign(document.createElement("meta"), {
          name: "description",
          content: "Today's menu",
        }),
        document.createElement("style"),
        "\n"
      );
      document.title = "Head";
    });
  });
  define("x-warn", () => {
    console.warn("careful", { n: 1 });
    window.console.warn("virtual warning");
    window.console.log("virtual log");
  });
  define("x-fail", (element) => {
    console.error("broken", element);
    window.console.error(new Error("virtual"));
    element.dispatchEvent(new CustomEvent("x-fail-error", { bubbles: true }));
    document.dispatchEvent(
      new CustomEvent("app-error", {
        detail: new Error("offline", { cause: "no network" }),
      })
    );
  });
  define("x-reject", () => {
    void Promise.reject(new Error("lost"));
  });
  // a declarative shadow root inserted by script: inert, until parsed from the file
  define("x-shadow", (element) => {
    element.innerHTML = `<div><template shadowrootmode="open"><b>inserted</b></template></div>`;
  });
  // text the DOM holds safely, until written to the file raw
  define("x-breakout", (element) => {
    element.append(
      Object.assign(document.createElement("script"), {
        type: "application/ld+json",
        textContent: `{"name": "</script>${ATTACK}"}`,
      }),
      Object.assign(document.createElement("style"), {
        textContent: `p { color: red } </style>${ATTACK}`,
      }),
      document.createComment(` note --> ${ATTACK}`),
      document.createElement("img src=x onerror=alert(1)")
    );
  });
  // the build machine's paths
  define("x-leak", (element) => {
    element.innerHTML = `<img src="file:///build/site/logo.png"><p>${join(SITE, "views")}</p>`;
  });
  // the previous page's teardown, when the next one loads
  define(
    "x-teardown",
    () => {},
    () => console.error("teardown of the previous page")
  );
  // live data: code that falls back when the socket fails
  define("x-socket", (element) => {
    try {
      void new WebSocket("wss://live.example/feed");
    } catch {
      element.textContent = "offline";
    }
  });
  // waits for data that never comes
  define("x-stuck", (element) => element.setAttribute("is-loading", ""));
  // reads what its attributes name, as content may set them
  define("x-local", (element) => {
    void fetch(element.getAttribute("src")!)
      .then((response) => response.text())
      .then(
        (text) => (element.textContent = text),
        () => (element.textContent = "unavailable")
      );
    try {
      const request = new XMLHttpRequest();
      request.open("GET", element.getAttribute("sync-src")!, false);
      request.send();
      element.dataset.sync = request.responseText;
    } catch {
      element.dataset.sync = "unavailable";
    }
  });
  // an image from the page's own memory: nothing fetched
  define("x-blob", (element) => {
    const image = document.createElement("img");
    image.src = URL.createObjectURL(new Blob(["<svg/>"], { type: "image/svg+xml" }));
    element.append(image);
  });
  // a failure the page handles, and failures in a shadow root
  define("x-handled", (element) => {
    element.addEventListener("x-handled-error", (event) => event.preventDefault());
    element.dispatchEvent(
      new CustomEvent("x-handled-error", { bubbles: true, cancelable: true })
    );
    const shadow = element.attachShadow({ mode: "open" });
    shadow.innerHTML = "<i></i>";
    const inside = shadow.firstElementChild!;
    inside.dispatchEvent(new CustomEvent("x-shadow-error", { composed: true }));
    inside.dispatchEvent(new CustomEvent("x-hidden-error", { composed: false }));
  });
};

const SHELLS: Record<string, string> = {
  "/paint": page(
    `<script type="module" src="/app.js"></script><x-paint></x-paint>`
  ),
  "/head": page(`<x-head></x-head>`),
  "/notes": page(`<provider-fetch api-url="/api/notes"></provider-fetch>`),
  "/order": page(
    `<provider-fetch api-url="/api/orders" api-method="POST"></provider-fetch>`
  ),
  "/missing": page(
    `<provider-fetch api-url="/data/missing.json"></provider-fetch>`
  ),
  "/account": page(
    ["me", "feed", "lang"]
      .map((name) => `<provider-fetch api-url="/api/${name}"></provider-fetch>`)
      .join("")
  ),
  "/sandbox": page(
    [
      `api-url="/api/sandbox"`,
      `api-url="/data/menu.json?fresh" header-cache-control="no-cache"`,
      `api-url="/api/menu"`,
      `api-url="/api/shell"`,
    ]
      .map((attributes) => `<provider-fetch ${attributes}></provider-fetch>`)
      .join("")
  ),
  // the shell's own preload too: its inert parse, at another URL, requests nothing
  "/foreign": page(
    `<link rel="stylesheet" href="https://fonts.example/css2"><link rel="preload" as="fetch" href="https://cdn.example/menu.json" crossorigin><link rel="preload" as="fetch" href="/data/menu.json" crossorigin><iframe src="https://video.example/embed/1"></iframe>`
  ),
  "/socket": page(`<x-socket></x-socket>`),
  "/local": page(
    [
      `<link rel="stylesheet" href="${LOCAL("secret.css")}">`,
      `<link rel="stylesheet" href="${DATA_CSS}">`,
      `<provider-fetch api-url="${LOCAL("secret.json")}"></provider-fetch>`,
      `<x-local src="${LOCAL("secret.json")}" sync-src="${LOCAL("secret.txt")}"></x-local>`,
    ].join("")
  ),
  // its own file read both ways too
  "/inline": page(
    `<link rel="icon" href="data:image/svg+xml,%3Csvg%2F%3E"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><x-blob></x-blob><x-local src="/data/menu.json" sync-src="/data/menu.json"></x-local>`
  ),
  // a `ready-on` event that never comes, elements that never load
  "/stuck": page(
    `<spa-manager><spa-route route-href="/stuck" ready-on="never-ready"><template><p>Soon</p></template></spa-route></spa-manager><x-stuck id="feed"></x-stuck><x-stuck></x-stuck><x-stuck class="card" data-source="${"/data/".padEnd(70, "x")}"></x-stuck>`
  ),
  "/foreign-fetch": page(
    `<provider-fetch api-url="https://api.example/data"></provider-fetch>`
  ),
  "/dsd": page(
    `<div id="own"><template shadowrootmode="open"><b>own</b></template></div><x-shadow></x-shadow>`
  ),
  "/breakout": page(`<x-breakout></x-breakout>`),
  "/leak": page(`<x-leak></x-leak>`),
  "/teardown": page(`<x-teardown></x-teardown>`),
  "/handled": page(`<x-handled></x-handled>`),
  "/stale": page(
    `<provider-fetch n-ssr="9"></provider-fetch><template><i n-ssr="3"></i></template>`
  ),
  "/quirks": `<html><head></head><body><p>quirks</p></body></html>`,
  "/legacy": `<!-- built -->\n<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd"><html><body><p>legacy</p></body></html>`,
  "/warn": page(`<x-warn></x-warn>`),
  "/fail": page(`<x-fail></x-fail>`),
  "/reject": page(`<x-reject></x-reject>`),
};

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
  });

/** A response as Node's own `fetch` makes one: `Set-Cookie` readable (happy-dom's `Response` drops it). */
const withCookie = (body: unknown) =>
  ({
    type: "basic",
    status: 200,
    statusText: "OK",
    headers: new Map([
      ["content-type", "application/json"],
      ["set-cookie", "session=1"],
    ]),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  }) as unknown as Response;

const API: Record<string, () => Response> = {
  "/api/notes": () => json({ note: NOTE }),
  "/api/me": () => withCookie({ name: "Ada" }),
  "/api/feed": () => json({ items: [] }, { "cache-control": "private, max-age=60" }),
  "/api/lang": () => json({ hello: "Hallo" }, { vary: "Accept-Language" }),
  "/api/menu": () => json({ special: "Rhubarb crumble" }),
  // public, but answered from client state in the browser: `exclude`d
  "/api/sandbox": () => json({ draft: "" }),
};

// `/api/shell` has no answer: the files' `fallback` serves it
const api = (request: Request) => API[new URL(request.url).pathname]?.() ?? null;

const islandOf = (html: string) =>
  JSON.parse(parse(html).getElementById("nucleus-hydration")!.textContent!);

const requested = ({ responses }: { responses: { method: string; url: string }[] }) =>
  responses.map(({ method, url }) => `${method} ${url}`);

const PRIVATE = (url: string, reason: string) =>
  `Private response to GET ${ORIGIN}${url} (${reason}): a public page must not be built from it`;

/** Node's HTTP(S) requests (happy-dom's fetches, `ws` sockets) fail and are counted, until restored. */
const offline = () => {
  const spies = [http, https].map((module) =>
    vi.spyOn(module, "request").mockImplementation(() => {
      throw new Error("a test reaches no network");
    })
  );
  return {
    calls: () => spies.flatMap(({ mock }) => mock.calls),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
};

describe("a renderer", () => {
  let renderer: Renderer;
  const scoped: string[] = [];
  // each page as settled, failed ones too: its markup and the island's responses
  const settled = new Map<string, string>();

  beforeAll(async () => {
    renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      fallback: "index.html",
      api,
      warnIslandBytes: 1000,
      exclude: (url) => url === `${ORIGIN}/api/sandbox`,
      viewport: { width: 390, height: 844 },
      shell: (url) => SHELLS[url] ?? SITE_SHELL,
      entry: async () => {
        const kit = await loadKit();
        defineTestElements();
        return {
          ...kit,
          afterRender: ({ url, document }: RenderPage & { document: Document }) => {
            if (document.querySelector("[q-scope]")) scoped.push(url);
            const { __NUCLEUS_SSR__: server } = globalThis as {
              __NUCLEUS_SSR__?: { responses: unknown[] };
            };
            settled.set(
              url,
              document.documentElement.outerHTML + JSON.stringify(server?.responses)
            );
            document.head.append(
              Object.assign(document.createElement("link"), {
                rel: "canonical",
                href: `${ORIGIN}${url}`,
              }),
              Object.assign(document.createElement("link"), {
                rel: "alternate",
                href: `${ORIGIN}/fr${url}`,
              })
            );
          },
        };
      },
    });
  });

  afterAll(() => renderer.close());

  it("renders routes in one window, each page with its own content and island", async () => {
    expect(renderer.window.innerWidth).toBe(390);
    const started = Date.now();
    const menu = await renderer.render("/menu");
    // a 3 s `@delay` neither delays the page nor shows in it
    expect(Date.now() - started).toBeLessThan(2000);
    expect(menu.diagnostics.heldTimers).toContain(3000);
    const home = await renderer.render("/");

    const menuPage = parse(menu.html);
    // the shell's own doctype
    expect(menu.html.startsWith('<!doctype html><html lang="en" n-ssr="">')).toBe(true);
    expect(menuPage.querySelector("[bind-special]")!.textContent).toBe("Rhubarb crumble");
    expect(menuPage.title).toBe("Menu");
    const island = islandOf(menu.html);
    const [route, fetcher] = ["spa-route[is-active]", "provider-fetch"].map(
      (selector) => menuPage.querySelector(selector)!.getAttribute("n-ssr")!
    );
    expect(island.provisions[route]).toMatchObject({ routeHref: "/menu", match: ["/menu"] });
    expect(island.provisions[fetcher]).toMatchObject({
      ok: true,
      url: `${ORIGIN}/data/menu.json`,
      body: { special: "Rhubarb crumble" },
    });
    expect(Object.keys(island.provisions)).toHaveLength(2);
    expect(requested(island)).toEqual(["GET /views/menu.html", "GET /data/menu.json"]);
    expect(island.responses[1].record).toMatchObject({
      status: 200,
      body: readFileSync(join(SITE, "data/menu.json"), "utf8"),
    });
    // its route data holds a class instance: derived again in the browser
    expect(menu.diagnostics.skippedProvisions).toEqual([
      expect.stringMatching(/^<spa-manager .*>: not plain data$/),
    ]);
    // q-scope ids come from a module-level counter: never in the output
    expect(scoped).toContain("/menu");
    expect(menu.html).not.toContain("q-scope");
    // of the head nodes the render added, the canonical link stays
    expect(menuPage.querySelector('link[rel="canonical"]')!.getAttribute("href")).toBe(
      `${ORIGIN}/menu`
    );
    expect(menuPage.querySelector('link[rel="alternate"]')).toBeNull();
    expect(menuPage.querySelector('link[rel="stylesheet"]')).not.toBeNull();
    expect(menu.diagnostics).toMatchObject({
      errors: [],
      warnings: [expect.stringMatching(/^Island is \d+ bytes \(warnIslandBytes: 1000\)$/)],
      requests: [
        { method: "GET", url: `${ORIGIN}/site.css`, status: 200 },
        { method: "GET", url: `${ORIGIN}/views/menu.html`, status: 200 },
        { method: "GET", url: `${ORIGIN}/data/menu.json`, status: 200 },
      ],
      // the `dangerous-html()` note's script
      neutralizedScripts: 1,
    });
    expect(menu.diagnostics.islandBytes).toBeGreaterThan(1000);

    // the second page holds nothing of the first
    const homePage = parse(home.html);
    expect(homePage.querySelector("spa-route[is-active] > h1")!.textContent).toBe(
      "Welcome to Wren Café"
    );
    expect(homePage.title).toBe("Wren Café");
    expect(home.html).not.toContain("Rhubarb");
    expect(home.html).not.toContain("<h2>");
    const homeIsland = islandOf(home.html);
    expect(homeIsland.responses).toEqual([]);
    expect(Object.values(homeIsland.provisions)).toEqual([
      expect.objectContaining({ routeHref: "/" }),
    ]);
    expect(home.diagnostics).toMatchObject({ errors: [], warnings: [], heldTimers: [] });
  });

  it("records every response again on the next page that uses it", async () => {
    await renderer.render("/menu");
    const { html } = await renderer.render("/specials");
    expect(parse(html).querySelector("[bind-special]")!.textContent).toBe("Rhubarb crumble");
    expect(requested(islandOf(html))).toEqual(["GET /views/menu.html", "GET /data/menu.json"]);
  });

  it("makes the scripts of a template-ref view inert: they never ran on a cold load", async () => {
    const { html } = await renderer.render("/scripts");
    const scripts = parse(html).querySelectorAll('spa-route[route-href="/scripts"] script');
    expect(Array.from(scripts, (script) => script.getAttribute("type"))).toEqual([
      "text/plain",
      "text/plain",
    ]);
  });

  it("makes the executable scripts html paints inserted inert, and keeps data blocks and the page's own", async () => {
    const { html, diagnostics } = await renderer.render("/paint");
    const types = Array.from(parse(html).querySelectorAll("script"), (script) =>
      script.getAttribute("type")
    );
    expect(types).toEqual([
      "module",
      "text/plain",
      "text/plain",
      "application/ld+json",
      "application/json",
    ]);
    expect(diagnostics.neutralizedScripts).toBe(2);
  });

  it("makes declarative shadow roots the render inserted inert, and keeps the shell's", async () => {
    const { html, diagnostics } = await renderer.render("/dsd");
    const document = parse(html);
    expect(document.querySelector("#own > template")!.getAttribute("shadowrootmode")).toBe(
      "open"
    );
    expect(document.querySelector("x-shadow template")!.hasAttribute("shadowrootmode")).toBe(
      false
    );
    expect(diagnostics.neutralizedShadowRoots).toBe(1);
  });

  it("drops head nodes the render added, unless a title, meta or canonical link", async () => {
    const { html } = await renderer.render("/head");
    const head = parse(html).head;
    expect(Array.from(head.children, (node) => node.outerHTML)).toEqual([
      '<meta charset="utf-8">',
      "<title>Head</title>",
      '<link rel="stylesheet" href="/site.css">',
      `<meta name="description" content="Today's menu">`,
      `<link rel="canonical" href="${ORIGIN}/head">`,
    ]);
    expect(html).not.toContain("modulepreload");
  });

  it("writes an island no provision or response can break out of", async () => {
    const { html } = await renderer.render("/notes");
    expect(html.match(/id="nucleus-hydration"/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain("<!--");
    expect(html).not.toMatch(new RegExp(`[${SEPARATORS}]`));
    const document = parse(html);
    expect(document.querySelectorAll("script")).toHaveLength(1);
    const island = islandOf(html);
    const id = document.querySelector("provider-fetch")!.getAttribute("n-ssr")!;
    expect(island.provisions[id].body).toEqual({ note: NOTE });
    expect(island.responses[0].record.body).toBe(JSON.stringify({ note: NOTE }));
  });

  it("fails a page with markup that would read differently once parsed from the file", async () => {
    await expect(renderer.render("/breakout")).rejects.toMatchObject({
      diagnostics: {
        errors: [
          'Element name "img src=x onerror=alert(1)" is not valid HTML: written to the file, it is other markup',
          expect.stringMatching(/^<script type="application\/ld\+json"> holds "<\/script"/),
          expect.stringMatching(/^<style> holds "<\/script", "<\/style" or "<!--"/),
          expect.stringMatching(/^Comment " note --> <img src=x onerror=alert\(1\)>" would end early/),
          // the script's text ends early: its <img> is an element to a browser
          expect.stringMatching(
            /^The page parses differently in a browser: in html > body > x-breakout, the renderer has <style> where a browser has <img>, at `<img src=x onerror=alert\(1\)>[^`]*`\./
          ),
        ],
      },
    });
  });

  it("fails a page holding file: URLs or paths of the build machine", async () => {
    await expect(renderer.render("/leak")).rejects.toMatchObject({
      diagnostics: {
        errors: [
          '<img src="file:///build/site/logo.png"> holds a file: URL from the build machine',
          "The page holds a path of the build machine (root or the working directory)",
        ],
      },
    });
  });

  it("removes n-ssr ids the page brought with it, in templates too", async () => {
    const { html } = await renderer.render("/stale");
    const document = parse(html);
    expect(document.querySelector("provider-fetch")!.hasAttribute("n-ssr")).toBe(false);
    expect(document.querySelector("template")!.innerHTML).toBe("<i></i>");
  });

  it("fails a page built from a response that varies per person", async () => {
    await expect(renderer.render("/account")).rejects.toMatchObject({
      diagnostics: {
        errors: [
          PRIVATE("/api/me", "Set-Cookie"),
          PRIVATE("/api/feed", "Cache-Control: private, max-age=60"),
          PRIVATE("/api/lang", "Vary: Accept-Language"),
        ],
      },
    });
  });

  it("inlines no provision whose data the island does not carry", async () => {
    const { html, diagnostics } = await renderer.render("/sandbox");
    const fetchers = Array.from(parse(html).querySelectorAll("provider-fetch"));
    expect(fetchers.map((fetcher) => fetcher.hasAttribute("n-ssr"))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(requested(islandOf(html)).sort()).toEqual(["GET /api/menu", "GET /api/shell"]);
    expect(diagnostics.skippedProvisions).toEqual([
      expect.stringMatching(
        /^<provider-fetch api-url="\/api\/sandbox".*>: its data \(\/api\/sandbox\) is not in the island: excluded, or not recordable$/
      ),
      expect.stringMatching(
        /^<provider-fetch api-url="\/data\/menu\.json\?fresh".*>: its data \(\/data\/menu\.json\?fresh=?\) is not in the island/
      ),
    ]);
    expect(diagnostics.errors).toEqual([]);
  });

  it("skips other origins' resources, which neither reach the network nor fail the page", async () => {
    const network = offline();
    try {
      const { html, diagnostics } = await renderer.render("/foreign");
      expect(diagnostics.errors).toEqual([]);
      expect(diagnostics.warnings).toEqual([
        "Skipped GET https://fonts.example/css2: a render loads no resource from another origin",
        "Skipped GET https://cdn.example/menu.json: a render loads no resource from another origin",
        "Skipped https://video.example/embed/1: a render loads no page into an iframe",
      ]);
      // nor did the shell's inert parse, nor this one
      const document = parse(html);
      await sleep(10);
      expect(network.calls()).toEqual([]);
      expect(diagnostics.requests).toEqual([
        { method: "GET", url: `${ORIGIN}/site.css`, status: 200 },
        { method: "GET", url: `${ORIGIN}/data/menu.json`, status: 200 },
      ]);
      expect(document.querySelector("iframe")!.getAttribute("src")).toBe(
        "https://video.example/embed/1"
      );
    } finally {
      network.restore();
    }
  });

  it("fails a page whose element opens a WebSocket, which never connects", async () => {
    const network = offline();
    try {
      await expect(renderer.render("/socket")).rejects.toMatchObject({
        diagnostics: {
          errors: ["Refused WebSocket wss://live.example/feed: a render opens no socket"],
        },
      });
      expect(network.calls()).toEqual([]);
    } finally {
      network.restore();
    }
  });

  it("refuses requests of other schemes before they are performed: no local file is read", async () => {
    const reads = [
      vi.spyOn(fs, "readFileSync"),
      vi.spyOn(fs, "readFile"),
      vi.spyOn(fs, "statSync"),
      vi.spyOn(fs, "openSync"),
      vi.spyOn(fs, "createReadStream"),
      vi.spyOn(fs.promises, "readFile"),
      vi.spyOn(fs.promises, "stat"),
      vi.spyOn(fs.promises, "open"),
    ];
    try {
      const { diagnostics } = await renderer.render("/local").then(
        () => expect.fail("the page rendered"),
        (error: { diagnostics: { errors: string[] } }) => error
      );
      expect(diagnostics.errors).toEqual(
        expect.arrayContaining(
          [
            LOCAL("secret.css"),
            // a whole resource: named by its start
            `${DATA_CSS.slice(0, 120)}…`,
            LOCAL("secret.json"),
            LOCAL("secret.txt"),
          ].map((url) => `Refused GET ${url}: a render loads http(s) URLs only`)
        )
      );
      // the markup still names them: once per element
      expect(
        diagnostics.errors.filter((error) => error.startsWith("<x-local "))
      ).toEqual([expect.stringMatching(/holds a file: URL from the build machine$/)]);
      const touched = reads
        .flatMap(({ mock }) => mock.calls)
        .filter(([path]) => String(path).includes(SENTINELS));
      expect(touched).toEqual([]);
      // nor did its content reach the page or the island
      expect(settled.get("/local")).toContain("provider-fetch");
      expect(settled.get("/local")).not.toContain(SECRET);
    } finally {
      reads.forEach((spy) => spy.mockRestore());
    }
  });

  it("lets a page use data: and blob: URLs nothing fetches, as image sources", async () => {
    const { html, diagnostics } = await renderer.render("/inline");
    expect(diagnostics.errors).toEqual([]);
    const document = parse(html);
    const sources = Array.from(document.querySelectorAll("img"), (image) =>
      image.getAttribute("src")
    );
    expect(sources).toEqual([
      "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      expect.stringMatching(/^blob:/),
    ]);
    // http(s) requests, async and sync, pass as before
    const local = document.querySelector("x-local") as HTMLElement;
    expect(JSON.parse(local.dataset.sync!)).toEqual(JSON.parse(local.textContent!));
  });

  it("fails a page with elements still loading or delaying ready once settled", async () => {
    await expect(renderer.render("/stuck")).rejects.toMatchObject({
      diagnostics: {
        errors: [
          `Not ready once settled: spa-route[route-href="/stuck"] (delaying-ready), x-stuck#feed (is-loading), x-stuck (is-loading), x-stuck[data-source="${"/data/".padEnd(60, "x")}…"] (is-loading)`,
        ],
      },
    });
  });

  it("fails a page whose element fetches its data from another origin", async () => {
    await expect(renderer.render("/foreign-fetch")).rejects.toMatchObject({
      diagnostics: {
        errors: expect.arrayContaining([
          expect.stringMatching(/^provider-fetch-error on <provider-fetch api-url="https:\/\/api\.example\/data"/),
        ]),
      },
    });
  });

  it("keeps the shell's doctype, or its lack of one", async () => {
    const [quirks, legacy] = await Promise.all([
      renderer.render("/quirks"),
      renderer.render("/legacy"),
    ]);
    expect(quirks.html.startsWith('<html n-ssr="">')).toBe(true);
    expect(
      legacy.html.startsWith(
        '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd"><html n-ssr="">'
      )
    ).toBe(true);
  });

  it("fails a page that writes: a render is read-only", async () => {
    await expect(renderer.render("/order")).rejects.toMatchObject({
      message: expect.stringContaining("nucleus-ssr: /order failed: "),
      diagnostics: {
        errors: expect.arrayContaining([
          `Refused POST ${ORIGIN}/api/orders: a render is read-only`,
        ]),
      },
    });
  });

  it("fails a page when an element announces an error", async () => {
    await expect(renderer.render("/missing")).rejects.toMatchObject({
      diagnostics: {
        errors: [
          expect.stringMatching(
            /^provider-fetch-error on <provider-fetch api-url="\/data\/missing\.json".*>: .*status: 404/
          ),
        ],
      },
    });
  });

  it("lets a page handle an -error event, and sees one that leaves a shadow root", async () => {
    await expect(renderer.render("/handled")).rejects.toMatchObject({
      diagnostics: { errors: ["x-shadow-error on <x-handled>"] },
    });
  });

  it("charges the previous page's teardown to no page", async () => {
    await renderer.render("/teardown");
    expect((await renderer.render("/")).diagnostics.errors).toEqual([]);
  });

  it("reports console and happy-dom warnings without failing the page", async () => {
    const { diagnostics } = await renderer.render("/warn");
    expect(diagnostics.errors).toEqual([]);
    expect(diagnostics.warnings).toEqual(["careful { n: 1 }", "virtual warning"]);
  });

  it("fails a page on console errors, happy-dom errors and -error events", async () => {
    await expect(renderer.render("/fail")).rejects.toMatchObject({
      diagnostics: {
        errors: [
          "broken <x-fail>",
          "x-fail-error on <x-fail>",
          "app-error on #document: Error: offline (no network)",
          "Error: virtual",
        ],
      },
    });
  });

  it("fails a page on an unhandled rejection", async () => {
    // Vitest fails the run on any unhandled rejection: step aside meanwhile
    const listeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    try {
      await expect(renderer.render("/reject")).rejects.toMatchObject({
        diagnostics: { errors: ["Unhandled rejection: Error: lost"] },
      });
    } finally {
      listeners.forEach((listener) => process.on("unhandledRejection", listener));
    }
  });
});

describe("renderer options", () => {
  it("resolves to the untouched shell for a failed page with onError: shell", async () => {
    const renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      onError: "shell",
      entry: loadKit,
    });
    try {
      const { html, diagnostics } = await renderer.render("/broken");
      expect(html).toBe(SITE_SHELL);
      expect(diagnostics.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("spa-route-error on <spa-route")])
      );
    } finally {
      await renderer.close();
    }
  });

  it("falls back to the shell per route, failing the others", async () => {
    const renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      shell: (url) => (url === "/missing" ? SHELLS["/missing"] : SITE_SHELL),
      onError: (url) => (url === "/broken" ? "shell" : "fail"),
      entry: loadKit,
    });
    try {
      expect((await renderer.render("/broken")).html).toBe(SITE_SHELL);
      await expect(renderer.render("/missing")).rejects.toMatchObject({
        diagnostics: { errors: [expect.stringContaining("provider-fetch-error")] },
      });
    } finally {
      await renderer.close();
    }
  });

  it("fails a page a browser parses into other elements, as onError says", async () => {
    const shell = "<p><x-block></x-block></p>";
    const renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      shell,
      onError: (url) => (url === "/client" ? "shell" : "fail"),
      // block content in a <p>: a browser's parser ends the <p> at <section>
      entry: async () => {
        customElements.define(
          "x-block",
          class extends HTMLElement {
            connectedCallback() {
              this.innerHTML = `<section>
                Today's menu: rhubarb crumble with custard, and soup of the day
              </section>`;
            }
          }
        );
      },
    });
    // the page is never written: what to search for, not a line in it
    const errors = [
      `The page parses differently in a browser: in html > body > p > x-block, the renderer has <section> where a browser has nothing, at \`<section> Today's menu: rhubarb crumble with custard, and so\`. ${CAUSES}`,
    ];
    try {
      await expect(renderer.render("/menu")).rejects.toMatchObject({
        diagnostics: { errors },
      });
      expect(await renderer.render("/client")).toMatchObject({
        html: shell,
        diagnostics: { errors },
      });
    } finally {
      await renderer.close();
    }
  });

  // trees only script builds: no markup gives a browser one
  it.each([
    [
      "a <div> appended to a <p>",
      (element: HTMLElement) => {
        const paragraph = document.createElement("p");
        paragraph.append(document.createElement("div"));
        element.append(paragraph);
      },
      "html > body > x-built > p",
      "<div>",
      `<div></div></p></x-built><script type="application/json" id="nucleus-hydration">`,
    ],
    [
      "an <a> nested in an <a>",
      (element: HTMLElement) => {
        const link = Object.assign(document.createElement("a"), { href: "/menu" });
        link.append(
          Object.assign(document.createElement("a"), { href: "/specials", textContent: "Specials" })
        );
        element.append(link);
      },
      "html > body > x-built > a",
      "<a>",
      `<a href="/specials">Specials</a></a></x-built>`,
    ],
  ])("fails a page whose script builds %s", async (_, build, path, here, excerpt) => {
    const renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      shell: "<x-built></x-built>",
      entry: async () => {
        customElements.define(
          "x-built",
          class extends HTMLElement {
            connectedCallback() {
              build(this);
            }
          }
        );
      },
    });
    try {
      await expect(renderer.render("/")).rejects.toMatchObject({
        diagnostics: {
          errors: [
            `The page parses differently in a browser: in ${path}, the renderer has ${here} where a browser has nothing, at \`${excerpt}\`. ${CAUSES}`,
          ],
        },
      });
    } finally {
      await renderer.close();
    }
  });

  it("fails a page whose shell function throws, even with the shell policy", async () => {
    const renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      onError: "shell",
      shell: (url) => {
        if (url === "/lost") throw new Error("no shell for /lost");
        return "<p>found</p>";
      },
      entry: ownEntry(),
    });
    try {
      await expect(renderer.render("/lost")).rejects.toMatchObject({
        diagnostics: { errors: ["shell: Error: no shell for /lost"] },
      });
      expect((await renderer.render("/found")).html).toContain("<p>found</p>");
    } finally {
      await renderer.close();
    }
  });

  it("refuses an entry that defines an excluded element, restoring the globals", async () => {
    const { document: before } = globalThis;
    await expect(
      createRenderer({
        root: SITE,
        origin: ORIGIN,
        excludedTags: ["provider-geolocation", "provider-fetch"],
        entry: loadKit,
      })
    ).rejects.toThrow("nucleus-ssr: excluded elements are defined: provider-fetch");
    expect(globalThis.document).toBe(before);
    expect(customElements.get("provider-fetch")).toBeUndefined();
  });

  it("adds the SERVER_EXCLUDED_TAGS the entry's module exports", async () => {
    await expect(
      createRenderer({
        root: SITE,
        origin: ORIGIN,
        excludedTags: ["quark-sheet"],
        // as `export * from "@excom/nucleus-kit/server"` would
        entry: async () => ({
          ...(await loadKit()),
          SERVER_EXCLUDED_TAGS: ["provider-storage", "provider-fetch"],
        }),
      })
    ).rejects.toThrow(
      "nucleus-ssr: excluded elements are defined: quark-sheet, provider-fetch"
    );
  });

  it("refuses an entry that defines no element: one already evaluated in this process", async () => {
    await (
      await createRenderer({ root: SITE, origin: ORIGIN, entry: loadKit })
    ).close();
    await expect(
      createRenderer({
        root: SITE,
        origin: ORIGIN,
        // evaluated for the first renderer: its `define()` calls do not run again
        entry: () => import("@excom/provider-fetch"),
      })
    ).rejects.toThrow("nucleus-ssr: entry defined no custom element in this window");
  });

  it("fails a page that does not settle within budgetMs, naming what is pending", async () => {
    const renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      budgetMs: 200,
      shell: "<x-wait></x-wait>",
      api: () => new Promise<null>(() => {}),
      entry: async () => {
        customElements.define(
          "x-wait",
          class extends HTMLElement {
            async connectedCallback() {
              try {
                await fetch("/api/never");
              } catch {
                // aborted once the renderer closes
              }
            }
          }
        );
      },
    });
    try {
      await expect(renderer.render("/wait")).rejects.toMatchObject({
        diagnostics: {
          errors: [
            expect.stringMatching(
              /^Not settled within budgetMs \(200 ms\): whenIdle: busy after \d+ ms \(requests: GET https:\/\/wren\.test\/api\/never\)$/
            ),
          ],
          pending: { requests: [`GET ${ORIGIN}/api/never`] },
        },
      });
    } finally {
      await renderer.close();
    }
  });

  it("fails a page whose settle hook does not resolve within budgetMs", async () => {
    const renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      budgetMs: 200,
      shell: "<p>static</p>",
      entry: ownEntry({ settle: () => new Promise(() => {}) }),
    });
    try {
      await expect(renderer.render("/")).rejects.toMatchObject({
        diagnostics: {
          errors: ["Not settled within budgetMs (200 ms): settle hook pending"],
          pending: { requests: [], timers: [], frames: 0 },
        },
      });
    } finally {
      await renderer.close();
    }
  });

  it("settles once the window and the settle hook are quiet in the same pass", async () => {
    let passes = 0;
    const renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      shell: "<p>static</p>",
      api: async () => {
        await sleep(50);
        return json({ late: true });
      },
      entry: ownEntry({
        // the first pass starts work the window then waits for
        settle: async () => {
          if (passes++ === 0) void fetch("/api/late");
        },
      }),
    });
    try {
      const { diagnostics } = await renderer.render("/");
      expect(passes).toBe(2);
      expect(diagnostics.requests).toEqual([
        { method: "GET", url: `${ORIGIN}/api/late`, status: 200 },
      ]);
    } finally {
      await renderer.close();
    }
  });

  it("fails a page whose hook throws, and uses only hooks that are functions", async () => {
    const renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      shell: "<p>static</p>",
      entry: ownEntry({
        beforeRender: ({ url }: RenderPage) => {
          if (url === "/boom") throw new Error("boom");
        },
        settle: "not a hook",
      }),
    });
    try {
      await expect(renderer.render("/boom")).rejects.toMatchObject({
        diagnostics: { errors: ["Error: boom"] },
      });
      expect((await renderer.render("/fine")).diagnostics.errors).toEqual([]);
    } finally {
      await renderer.close();
    }
  });
});

describe("a renderer's lifecycle", () => {
  it("renders pages in call order and leaves globalThis as it was once closed", async () => {
    const keys = new Set(Reflect.ownKeys(globalThis));
    const { document: before, customElements: registry } = globalThis;
    const order: string[] = [];
    // per disconnect: did its teardown see its own window's document?
    const teardowns: boolean[] = [];
    const renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      shell: async (url) => {
        await sleep(url === "/slow" ? 30 : 0);
        return `<p>${url}</p><x-bye></x-bye>`;
      },
      entry: async () => {
        (globalThis as Record<string, unknown>).__appState = true;
        customElements.define(
          "x-bye",
          class extends HTMLElement {
            disconnectedCallback() {
              const own = this.ownerDocument;
              queueMicrotask(() => teardowns.push(document === own));
            }
          }
        );
        return { beforeRender: ({ url }: RenderPage) => order.push(url) };
      },
    });
    try {
      expect(globalThis.document).toBe(renderer.window.document);
      const [slow, fast] = await Promise.all([
        renderer.render("/slow"),
        renderer.render(`${ORIGIN}/fast?x=1#top`),
      ]);
      expect(order).toEqual(["/slow", "/fast?x=1#top"]);
      // no doctype in the shell: none in the page
      expect(slow.html).toBe(
        '<html n-ssr=""><head></head><body><p>/slow</p><x-bye></x-bye><script type="application/json" id="nucleus-hydration">{"v":1,"provisions":{},"responses":[]}</script></body></html>'
      );
      expect(parse(fast.html).body.firstElementChild!.textContent).toBe("/fast?x=1#top");
      await expect(renderer.render("https://elsewhere.test/")).rejects.toThrow(
        "nucleus-ssr: https://elsewhere.test/ is not on https://wren.test"
      );
    } finally {
      await renderer.close();
    }
    await renderer.close();
    // the last page too: unloaded before the globals are restored
    expect(teardowns).toEqual([true, true]);
    expect(globalThis.document).toBe(before);
    expect(globalThis.customElements).toBe(registry);
    expect(new Set(Reflect.ownKeys(globalThis))).toEqual(keys);
    await expect(renderer.render("/")).rejects.toThrow("nucleus-ssr: the renderer is closed");
  });

  const STALE =
    "nucleus-ssr: the shell was written by an earlier prerender (<html n-ssr>): rebuild the site, then prerender from its built shell";
  /** The run's error for the misparsed shell below, naming which shell it is when there is a choice. */
  const misparsed = (source = "") =>
    `nucleus-ssr: the shell parses differently in a browser${source}: in html > body, the renderer has <main> where a browser has nothing: it reads everything after <title> on line 1, column 53 into it. ${CAUSES}`;

  it.each([
    [
      "an earlier prerender wrote",
      `<html n-ssr=""><body><p>stale</p><script type="application/json" id="nucleus-hydration">{}</script></body></html>`,
      STALE,
      STALE,
    ],
    [
      // the rest of the page is the <title>'s text to a browser
      "a browser parses into other elements",
      `<!doctype html><html><body><quark-sheet>/* sets the <title> */</quark-sheet><main><p>Menu</p></main></body></html>`,
      misparsed(),
      misparsed(" (route /bad)"),
    ],
  ])("refuses a shell %s, whatever the policy", async (_, bad, fixed, perRoute) => {
    const options = { root: SITE, origin: ORIGIN, entry: ownEntry() };
    for (const onError of ["fail", "shell"] as const) {
      // a fixed shell: no renderer
      await expect(
        createRenderer({ ...options, onError, shell: bad })
      ).rejects.toThrow(fixed);
      // one a function gives: that render, without diagnostics or a shell
      const renderer = await createRenderer({
        ...options,
        onError,
        shell: (url) => (url === "/bad" ? bad : "<p>fresh</p>"),
      });
      try {
        const error = await renderer.render("/bad").catch((error) => error);
        expect(error).toMatchObject({ message: perRoute });
        expect(error).not.toHaveProperty("diagnostics");
        expect((await renderer.render("/")).html).toContain("<p>fresh</p>");
      } finally {
        await renderer.close();
      }
    }
  });

  it("refuses a site whose index.html or fallback a browser parses differently", async () => {
    const options = { root: MISPARSED_SITE, origin: ORIGIN, entry: ownEntry() };
    const difference = `in html > body > main > p > x-host, the renderer has <section> where a browser has nothing, on line 9, column 18. ${CAUSES}`;
    await expect(createRenderer(options)).rejects.toThrow(
      `nucleus-ssr: the shell parses differently in a browser: ${difference}`
    );
    await expect(
      createRenderer({ ...options, shell: "<p>fine</p>", fallback: "index.html" })
    ).rejects.toThrow(
      `nucleus-ssr: the shell parses differently in a browser (fallback index.html): ${difference}`
    );
    // a fallback with no file: no page a browser gets
    await (
      await createRenderer({ ...options, shell: "<p>fine</p>", fallback: "none.html" })
    ).close();
  });

  // a browser reads CR LF as LF before it parses: a CR LF checkout is no difference
  it("renders from a shell written with CR LF, a multi-line attribute too", async () => {
    const shell = [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta name="description"',
      '    content="Rhubarb crumble,',
      '      every day">',
      "</head>",
      '<body><p title="Today\'s',
      '  special">Menu</p></body>',
      "</html>",
      "",
    ].join("\r\n");
    const renderer = await createRenderer({ root: SITE, origin: ORIGIN, shell, entry: ownEntry() });
    try {
      expect((await renderer.render("/")).diagnostics.errors).toEqual([]);
    } finally {
      await renderer.close();
    }
  });

  it("opens one renderer at a time", async () => {
    const options = {
      root: SITE,
      origin: ORIGIN,
      shell: "",
      entry: ownEntry(),
    };
    const first = await createRenderer(options);
    await expect(createRenderer(options)).rejects.toThrow(
      "nucleus-ssr: another renderer is open; close it first"
    );
    await first.close();
    await (await createRenderer(options)).close();
  });
});
