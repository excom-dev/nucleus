/**
 * Round trips: each route rendered by the renderer, then loaded in the same
 * window as a browser loads the prerendered page (`hydrate()`), with the
 * real Nucleus Kit server entry. Hydration must change nothing.
 */
import { createRenderer, type Renderer, type RenderPage } from "../../index";
import { hydrate, type HydrationReport } from "../../testing";
import { loadKit, ORIGIN, parse, SITE } from "./helpers";
import { createDom, installGlobals, serve, whenIdle } from "@excom/nucleus-dom";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "@excom/nucleus-test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// pages whose elements all load from the island
const ISLAND_SITE = join(SITE, "../island");

type App = {
  kit: typeof import("@excom/nucleus-kit/server");
  testing: typeof import("@excom/spa-route/testing");
  router: typeof import("@excom/kit-router");
};
let app: App;

/**
 * A prerender entry: the server kit (its `SERVER_EXCLUDED_TAGS` checked),
 * and spa-route's test helpers from the same module graph.
 */
const entry = async () => {
  vi.resetModules();
  app = {
    kit: await import("@excom/nucleus-kit/server"),
    testing: await import("@excom/spa-route/testing"),
    router: await import("@excom/kit-router"),
  };
  return {
    ...app.kit,
    settle: () => app.kit.Quark.whenSettled(),
    beforeRender: ({ url }: RenderPage) => app.testing.resetRouter(url),
  };
};

const NO_CHANGE = {
  removed: [],
  added: [],
  attributes: [],
  texts: [],
  flashes: [],
};
const ROUTE = "body > spa-manager > spa-route:nth-of-type(2)";

const islandOf = (html: string) =>
  JSON.parse(parse(html).getElementById("nucleus-hydration")!.textContent!);

/** Events of `types` reaching `document`, as `"<type> <tag>"`, until stopped. */
const listen = (document: Document, types: string[]) => {
  const seen: string[] = [];
  const record = ({ type, target }: Event) =>
    seen.push(`${type} ${(target as Element).localName}`);
  types.forEach((type) => document.addEventListener(type, record, true));
  return {
    seen,
    stop: () =>
      types.forEach((type) => document.removeEventListener(type, record, true)),
  };
};

const fetched = (spy: MockInstance) =>
  spy.mock.calls.map(([input]) => String(input));

/** A page as the renderer writes one: `<html n-ssr>`, the island last. */
const prerendered = (body: string) =>
  `<!DOCTYPE html><html n-ssr=""><head><link rel="stylesheet" href="/site.css"></head><body>${body}<script type="application/json" id="nucleus-hydration">{"v":1,"provisions":{},"responses":[]}</script></body></html>`;

describe("a prerendered page hydrated in the renderer's window", () => {
  let renderer: Renderer;

  beforeAll(async () => {
    renderer = await createRenderer({ root: SITE, origin: ORIGIN, entry });
  });

  afterAll(() => renderer.close());

  /** Once a navigation's own fetches and paints are done. */
  const settled = async () => {
    await whenIdle(renderer.window);
    await app.kit.Quark.whenSettled();
  };

  /** Renders `url`, then loads its HTML as a browser would. */
  const roundTrip = async (url: string) => {
    const { html } = await renderer.render(url);
    const report = await hydrate(renderer.window, html, {
      beforeParse: () => app.testing.resetRouter(url),
    });
    return { html, report };
  };

  it.each(["/", "/menu", "/specials"])(
    "hydrates %s without a change or a request for what the island carries",
    async (url) => {
      const { report } = await roundTrip(url);
      expect(report).toMatchObject(NO_CHANGE);
      // the page's own stylesheet only: views and JSON come from the island
      expect(report.requests).toEqual([
        { method: "GET", url: `${ORIGIN}/site.css`, status: 200 },
      ]);
      expect(report.windowMs).toBeGreaterThan(0);
    }
  );

  it("keeps a template-ref view's scripts inert through hydration: they never run", async () => {
    const { report } = await roundTrip("/scripts");
    expect(report).toMatchObject(NO_CHANGE);
    const { document } = renderer.window;
    const scripts = document.querySelectorAll('spa-route[route-href="/scripts"] script');
    expect(Array.from(scripts, (script) => script.getAttribute("type"))).toEqual([
      "text/plain",
      "text/plain",
    ]);
    expect((renderer.window as unknown as { viewRan?: true }).viewRan).toBeUndefined();
  });

  it("shows a route its mount renders again: its stamp names another view", async () => {
    const { html } = await renderer.render("/menu");
    const stamp = /n-tpl="\/views\/menu\.html#[^"]+"/.exec(html)![0];
    const report = await hydrate(
      renderer.window,
      html.replace(stamp, 'n-tpl="/views/menu.html#stale"'),
      { beforeParse: () => app.testing.resetRouter("/menu") }
    );
    expect(report.removed).toContain(`${ROUTE} > section`);
    expect(report.added).toContain(`${ROUTE} > section`);
    expect(report.attributes).toContainEqual({
      element: ROUTE,
      name: "n-tpl",
      server: "/views/menu.html#stale",
      final: null,
    });
  });

  it("keeps the menu as served, then navigates as any page once the window closed", async () => {
    const { html } = await renderer.render("/menu");
    const { document } = renderer.window;
    const events = listen(document, [
      "spa-route-did-render",
      "include-content-did-render",
      "provider-fetch-success",
    ]);
    const report = await hydrate(renderer.window, html, {
      beforeParse: () => app.testing.resetRouter("/menu"),
    });
    events.stop();

    expect(report).toMatchObject(NO_CHANGE);
    // adopted renders announce themselves once; the provider re-announces
    expect(events.seen.sort()).toEqual([
      "include-content-did-render include-content",
      "provider-fetch-success provider-fetch",
      "spa-route-did-render spa-route",
    ]);
    // never hidden to wait for ready-on: the server already waited
    expect(
      [...report.attributes, ...report.rewrites].map(({ name }) => name)
    ).not.toContain("delaying-ready");
    const fetcher = document.querySelector("provider-fetch") as Element & {
      provision: unknown;
    };
    // the `@on provider-fetch-success` block's write, kept
    expect(fetcher.getAttribute("data-loaded")).toBe("");
    const id = parse(html).querySelector("provider-fetch")!.getAttribute("n-ssr")!;
    expect(fetcher.provision).toEqual(islandOf(html).provisions[id]);
    // the dangerous-html() paint's script stays inert, and never ran
    expect(document.querySelector("[bind-note] script")!.getAttribute("type")).toBe(
      "text/plain"
    );
    expect((renderer.window as unknown as { noteRan?: true }).noteRan).toBeUndefined();
    // the 3 s @delay neither fired nor held the window
    expect(document.querySelector("[bind-special]")!.textContent).toBe(
      "Rhubarb crumble"
    );

    const served = document.querySelector('spa-route[route-href="/menu"] > section');
    const manager = document.querySelector("spa-manager")!;
    const fetches = vi.spyOn(renderer.window, "fetch");
    try {
      await app.testing.navigate(manager, () =>
        app.router.kitRouter.pushState({ url: "/specials" })
      );
      await settled();
      expect(
        document.querySelector('spa-route[route-href="/specials"] [bind-special]')!
          .textContent
      ).toBe("Rhubarb crumble");
      // the view is in the page's cache since hydration; its data is not
      expect(fetched(fetches)).toEqual([`${ORIGIN}/data/menu.json`]);
      fetches.mockClear();

      await app.testing.navigate(manager, () =>
        app.router.kitRouter.pushState({ url: "/menu" })
      );
      await settled();
      const menu = document.querySelector('spa-route[route-href="/menu"]')!;
      expect(menu.querySelector("section")).not.toBe(served);
      expect(menu.hasAttribute("n-tpl")).toBe(false);
      expect(menu.querySelector("[bind-special]")!.textContent).toBe(
        "Rhubarb crumble"
      );
      expect(fetched(fetches)).toEqual([`${ORIGIN}/data/menu.json`]);
    } finally {
      fetches.mockRestore();
    }
  });
});

describe("a page whose view changed on disk since its render", () => {
  let renderer: Renderer;
  let site: string;
  let report: HydrationReport;

  beforeAll(async () => {
    site = mkdtempSync(join(tmpdir(), "nucleus-ssr-hydrate-"));
    cpSync(SITE, site, { recursive: true });
    renderer = await createRenderer({
      root: site,
      origin: ORIGIN,
      entry,
      // the island does not carry the view: the browser fetches the file
      exclude: (url) => url === `${ORIGIN}/views/menu.html`,
    });
    const { html } = await renderer.render("/menu");
    expect(islandOf(html).responses.map(({ url }: { url: string }) => url)).toEqual([
      "/data/menu.json",
    ]);
    const view = join(site, "views/menu.html");
    writeFileSync(
      view,
      readFileSync(view, "utf8").replace("<h2>Menu</h2>", "<h2>Today's menu</h2>")
    );
    report = await hydrate(renderer.window, html, {
      beforeParse: () => app.testing.resetRouter("/menu"),
    });
  });

  afterAll(async () => {
    await renderer.close();
    rmSync(site, { recursive: true, force: true });
  });

  it("replaces the route with the changed view, fetched from the files", () => {
    expect(report.requests).toContainEqual({
      method: "GET",
      url: `${ORIGIN}/views/menu.html`,
      status: 200,
    });
    expect(report.removed).toContain(`${ROUTE} > section`);
    expect(report.added).toContain(`${ROUTE} > section`);
    expect(report.attributes).toContainEqual({
      element: ROUTE,
      name: "n-tpl",
      server: expect.stringMatching(/^\/views\/menu\.html#/),
      final: null,
    });
    expect(
      renderer.window.document.querySelector('spa-route[route-href="/menu"] h2')!
        .textContent
    ).toBe("Today's menu");
  });

  // the server content announces ready-on before the changed view arrives
  it("hides the replaced route until ready-on, as on a cold load", () => {
    expect(report.rewrites).toContainEqual(
      expect.objectContaining({ element: ROUTE, name: "delaying-ready", value: null })
    );
  });
});

describe("a provider whose data stays out of the island", () => {
  const TODOS = [
    { id: 1, title: "Buy milk" },
    { id: 2, title: "Walk the dog" },
  ];
  // the service worker's data in the browser: excluded, answered by `api`
  const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Todos</title></head><body>
    <provider-fetch id="todos" api-url="/api/todos"></provider-fetch>
    <ul id="todo-list"><template><li></li></template></ul>
    <provider-fetch id="menu" api-url="/data/menu.json"></provider-fetch>
    <p id="special"></p>
    <quark-sheet>
      provider-fetch[is-success] + ul {
        content: iterate(element.previousElementSibling.provision.body, ":scope > template", "id");
        li { content: item.title; }
      }
      provider-fetch[is-success] + p {
        content: element.previousElementSibling.provision.body.special;
      }
    </quark-sheet>
  </body></html>`;
  let renderer: Renderer;
  let html: string;
  let skippedProvisions: string[];

  beforeAll(async () => {
    renderer = await createRenderer({
      root: SITE,
      origin: ORIGIN,
      entry,
      shell: PAGE,
      exclude: (absoluteUrl) => new URL(absoluteUrl).pathname === "/api/todos",
      api: (request) =>
        new URL(request.url).pathname === "/api/todos"
          ? new Response(JSON.stringify(TODOS), {
              headers: { "content-type": "application/json" },
            })
          : null,
    });
    ({
      html,
      diagnostics: { skippedProvisions },
    } = await renderer.render("/todos"));
  });

  afterAll(() => renderer.close());

  const rowsOf = (document: Document) =>
    Array.from(document.querySelectorAll("#todo-list li"), (li) => li.textContent);

  it("is written not loaded, its rows in place, its data left to the browser", () => {
    const document = parse(html);
    const todos = document.getElementById("todos")!;
    expect(["is-success", "did-load", "n-ssr"].filter((name) => todos.hasAttribute(name))).toEqual([]);
    expect(rowsOf(document)).toEqual(["Buy milk", "Walk the dog"]);
    expect(skippedProvisions).toEqual([
      expect.stringMatching(
        /^<provider-fetch id="todos" .*>: its data \(\/api\/todos\) is not in the island: excluded, or not recordable$/
      ),
    ]);
    // the recorded one is loaded, with its data in the island
    const menu = document.getElementById("menu")!;
    expect(["is-success", "did-load", "n-ssr"].filter((name) => menu.hasAttribute(name))).toEqual([
      "is-success",
      "did-load",
      "n-ssr",
    ]);
    expect(islandOf(html).responses.map(({ url }: { url: string }) => url)).toEqual([
      "/data/menu.json",
    ]);
  });

  it("fetches in the browser as on a cold load: no row goes before its data comes", async () => {
    const { document } = renderer.window;
    // rows removed from the list, as they happen
    const removed: string[] = [];
    const take = (records: MutationRecord[]) =>
      records
        .filter(({ target }) => (target as Element).id === "todo-list")
        .forEach(({ removedNodes }) =>
          removedNodes.forEach((node) => node.nodeName === "LI" && removed.push(node.textContent!))
        );
    const rows = new renderer.window.MutationObserver(take);
    rows.observe(document.documentElement, { childList: true, subtree: true });
    let beforeData: string[] | undefined;
    const success = (event: Event) => {
      if ((event.target as Element).id !== "todos") return;
      take(rows.takeRecords());
      beforeData ??= [...removed];
    };
    let shownLoading = false;
    const loading = ({ target }: Event) => {
      if ((target as Element).id === "todos")
        shownLoading = (target as Element).hasAttribute("is-loading");
    };
    document.addEventListener("provider-fetch-success", success, true);
    document.addEventListener("provider-fetch-loading", loading, true);
    try {
      const report = await hydrate(renderer.window, html);
      expect(beforeData).toEqual([]);
      // loading for real, with nothing the server wrote missing meanwhile
      expect(shownLoading).toBe(true);
      expect(report.flashes).toEqual([]);
      expect(report.requests.filter(({ url }) => url === `${ORIGIN}/api/todos`)).toEqual([
        { method: "GET", url: `${ORIGIN}/api/todos`, status: 200 },
      ]);
      // the recorded provider hydrates from the island
      expect(report.requests.map(({ url }) => url)).not.toContain(`${ORIGIN}/data/menu.json`);
      const todos = document.getElementById("todos") as Element & { provision: { body: unknown } };
      expect(todos.hasAttribute("is-success")).toBe(true);
      expect(todos.provision.body).toEqual(TODOS);
      expect(rowsOf(document)).toEqual(["Buy milk", "Walk the dog"]);
      expect(document.getElementById("special")!.textContent).toBe("Rhubarb crumble");
    } finally {
      document.removeEventListener("provider-fetch-success", success, true);
      document.removeEventListener("provider-fetch-loading", loading, true);
      rows.disconnect();
    }
  });
});

describe("a page whose elements load from the island", () => {
  const SHEET = `<quark-sheet>
      provider-fetch[is-success] {
        $data: prop("provision").body;
        [bind-special] { content: $data.special; }
      }
    </quark-sheet>`;
  const page = (body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Café</title></head><body>${body}</body></html>`;
  const PAGES: Record<string, string> = {
    // each kind that writes its loaded state
    "/kinds": page(`
      <include-content id="local" is-active template-ref="#local-view"></include-content>
      <template id="local-view"><p>Local view</p></template>
      <include-content id="default" is-active><template><p>Default view</p></template></include-content>
      <include-content id="fetched" is-active template-ref="/views/note.html"></include-content>
      <provider-fetch id="special" api-url="/data/special.json"><p bind-special></p></provider-fetch>
      ${SHEET}
      <section id="remote">
        <quark-sheet src-url="/views/note.quark"></quark-sheet>
        <p bind-note></p>
      </section>`),
    // one URL, requested twice
    "/twice": page(`
      <provider-fetch id="first" api-url="/data/special.json"><p bind-special></p></provider-fetch>
      <provider-fetch id="second" api-url="/data/special.json"><p bind-special></p></provider-fetch>
      ${SHEET}`),
    // fetched by hand, twice at once: the first request is cancelled
    "/refetch": page(`
      <provider-fetch id="special" api-url="/data/special.json" is-paused><p bind-special></p></provider-fetch>
      <x-refetch></x-refetch>
      ${SHEET}`),
  };
  let renderer: Renderer;

  beforeAll(async () => {
    renderer = await createRenderer({
      root: ISLAND_SITE,
      origin: ORIGIN,
      entry,
      shell: (url) => PAGES[url],
    });
  });

  afterAll(() => renderer.close());

  it("keeps each loaded state on at every task boundary: templates, a provider, sheets", async () => {
    const { html } = await renderer.render("/kinds");
    const report = await hydrate(renderer.window, html);
    expect(report).toMatchObject(NO_CHANGE);
    expect(report.requests).toEqual([]);
    // dropped and written back as each starts, within one task: never painted
    expect(
      report.rewrites
        .filter(({ name }) => ["did-load", "is-success"].includes(name))
        .map(({ element, name }) => `${element} [${name}]`)
    ).toEqual([
      "body > include-content#local [did-load]",
      "body > include-content#fetched [did-load]",
      "body > provider-fetch#special [is-success]",
      "body > section#remote > quark-sheet [is-success]",
    ]);
  });

  it("answers both requests for one URL from the island: no flash, no request", async () => {
    const { html } = await renderer.render("/twice");
    expect(islandOf(html).responses).toEqual([
      {
        method: "GET",
        url: "/data/special.json",
        record: expect.objectContaining({ status: 200 }),
        count: 2,
      },
    ]);
    const report = await hydrate(renderer.window, html);
    expect(report).toMatchObject(NO_CHANGE);
    expect(report.requests).toEqual([]);
  });

  it("answers a request made again at once, as `doFetch` cancels to fetch again", async () => {
    customElements.define(
      "x-refetch",
      class extends HTMLElement {
        connectedCallback() {
          setTimeout(() => {
            const provider = document.querySelector("provider-fetch") as Element & {
              doFetch(args: unknown): void;
              getFetchArgs(): unknown;
            };
            provider.doFetch(provider.getFetchArgs());
            provider.doFetch(provider.getFetchArgs());
          }, 0);
        }
      }
    );
    const { html } = await renderer.render("/refetch");
    // the cancelled one is no answer, on the server either
    expect(islandOf(html).responses).toEqual([
      {
        method: "GET",
        url: "/data/special.json",
        record: expect.objectContaining({ status: 200 }),
      },
    ]);
    const report = await hydrate(renderer.window, html);
    expect(report).toMatchObject(NO_CHANGE);
    expect(report.requests).toEqual([]);
  });
});

describe("hydrate()", () => {
  /** A window serving the fixture site, its globals installed. */
  const openWindow = (url = `${ORIGIN}/`) => {
    const dom = createDom({ url, holdTimersAbove: 100, intersectAll: true });
    serve(dom.window, SITE);
    const restore = installGlobals(dom.window);
    return {
      window: dom.window,
      close: async () => {
        restore();
        await dom.dispose();
      },
    };
  };

  it("works in any window with the app's elements defined", async () => {
    const renderer = await createRenderer({ root: SITE, origin: ORIGIN, entry });
    const { html } = await renderer.render("/menu");
    await renderer.close();
    const page = openWindow(`${ORIGIN}/menu`);
    try {
      const kit = await loadKit();
      const report = await hydrate(page.window, html, {
        beforeParse: () => kit.beforeRender({ url: "/menu", window: page.window }),
      });
      expect(report).toMatchObject(NO_CHANGE);
      expect(report.requests.map(({ url }) => url)).toEqual([`${ORIGIN}/site.css`]);
    } finally {
      await page.close();
    }
  });

  it("reports nodes, attributes and texts hydration changed, and its requests", async () => {
    const page = openWindow();
    try {
      customElements.define(
        "x-churn",
        class extends HTMLElement {
          connectedCallback() {
            document.addEventListener(
              "DOMContentLoaded",
              () => {
                const text = this.firstChild as Text;
                text.data = "draft";
                text.data = "client";
                this.querySelector("i")!.replaceWith(document.createElement("b"));
                this.querySelector("span")!.append(document.createElement("em"));
                this.append(document.createComment("added"));
                this.setAttribute("data-state", "client");
                this.removeAttribute("data-flip");
                this.setAttribute("data-flip", "");
                this.setAttribute("data-same", "1");
                this.setAttribute("q-scope", "7");
                void fetch("/missing.json");
              },
              { once: true }
            );
          }
        }
      );
      const report = await hydrate(
        page.window,
        prerendered(
          `<x-churn id="c" data-state="server" data-flip="" data-same="1" n-ssr="0">server<i>gone</i><span><a></a></span></x-churn>`
        )
      );
      expect(report).toEqual({
        removed: ["body > x-churn#c > i"],
        added: [
          "body > x-churn#c > b",
          "body > x-churn#c > span > em",
          "body > x-churn#c > #comment",
        ],
        attributes: [
          {
            element: "body > x-churn#c",
            name: "data-state",
            server: "server",
            final: "client",
          },
        ],
        // in the element's final attribute order: re-added, `data-flip` is last
        rewrites: [
          { element: "body > x-churn#c", name: "data-same", value: "1", writes: 1 },
          { element: "body > x-churn#c", name: "data-flip", value: "", writes: 2 },
        ],
        texts: [
          { node: 'body > x-churn#c > "client"', server: "server", final: "client" },
        ],
        // all in one task: `data-flip` came back before a paint could show it
        flashes: [],
        keptOut: [],
        requests: [
          { method: "GET", url: `${ORIGIN}/site.css`, status: 200 },
          { method: "GET", url: `${ORIGIN}/missing.json`, status: 404 },
        ],
        windowMs: expect.any(Number),
      });
    } finally {
      await page.close();
    }
  });

  it("records from the parse on: a mount in a microtask the parse queued", async () => {
    const page = openWindow();
    try {
      customElements.define(
        "x-early",
        class extends HTMLElement {
          connectedCallback() {
            queueMicrotask(() => this.replaceChildren(document.createElement("b")));
          }
        }
      );
      const report = await hydrate(
        page.window,
        prerendered(`<x-early id="e"><i></i></x-early>`)
      );
      expect(report).toMatchObject({
        removed: ["body > x-early#e > i"],
        added: ["body > x-early#e > b"],
      });
    } finally {
      await page.close();
    }
  });

  it("lists server markup gone at a task boundary and back by the end", async () => {
    const page = openWindow();
    try {
      customElements.define(
        "x-blink",
        class extends HTMLElement {
          connectedCallback() {
            document.addEventListener(
              "DOMContentLoaded",
              () => {
                const root = document.documentElement;
                const child = this.querySelector("i")!;
                // back within the task: never painted
                this.removeAttribute("data-same");
                this.setAttribute("data-same", "");
                // gone for good: a change the other lists report
                this.removeAttribute("data-gone");
                this.querySelector("b")!.remove();
                // back a task later
                root.removeAttribute("data-theme");
                this.removeAttribute("data-state");
                child.remove();
                setTimeout(() => {
                  root.setAttribute("data-theme", "dark");
                  this.setAttribute("data-state", "server");
                  this.append(child);
                }, 0);
              },
              { once: true }
            );
          }
        }
      );
      const report = await hydrate(
        page.window,
        prerendered(
          `<x-blink id="x" data-same="" data-gone="" data-state="server"><i></i><b></b></x-blink>`
        ).replace(`<html n-ssr="">`, `<html n-ssr="" data-theme="dark">`)
      );
      expect(report.flashes).toEqual([
        "body > x-blink#x without [data-state]",
        "html without [data-theme]",
        "body > x-blink#x without i",
      ]);
      expect(report.removed).toContain("body > x-blink#x > b");
      expect(report.attributes).toContainEqual({
        element: "body > x-blink#x",
        name: "data-gone",
        server: "",
        final: null,
      });
    } finally {
      await page.close();
    }
  });

  it("starts from the markup: an upgrade that removes, restored a task later, is a flash", async () => {
    const page = openWindow();
    try {
      customElements.define(
        "x-upgrade-blink",
        class extends HTMLElement {
          connectedCallback() {
            const child = this.querySelector("i")!;
            this.removeAttribute("did-load");
            child.remove();
            setTimeout(() => {
              this.setAttribute("did-load", "");
              this.append(child);
            }, 0);
          }
        }
      );
      const report = await hydrate(
        page.window,
        prerendered(`<x-upgrade-blink did-load=""><i></i></x-upgrade-blink>`)
      );
      expect(report).toMatchObject({
        flashes: [
          "body > x-upgrade-blink without [did-load]",
          "body > x-upgrade-blink without i",
        ],
        removed: ["body > x-upgrade-blink > i"],
        added: ["body > x-upgrade-blink > i"],
        attributes: [],
      });
    } finally {
      await page.close();
    }
  });

  it("paints after a task's frame callbacks: a restore in the next frame is none, one a frame later is", async () => {
    const page = openWindow();
    try {
      customElements.define(
        "x-frame",
        class extends HTMLElement {
          connectedCallback() {
            document.addEventListener(
              "DOMContentLoaded",
              () => {
                const restore = () => this.setAttribute("data-state", "");
                this.removeAttribute("data-state");
                if (this.id === "next") requestAnimationFrame(restore);
                else requestAnimationFrame(() => requestAnimationFrame(restore));
                // a cancelled frame never comes, nor holds a paint back
                cancelAnimationFrame(requestAnimationFrame(() => {}));
              },
              { once: true }
            );
          }
        }
      );
      const report = await hydrate(
        page.window,
        prerendered(
          `<x-frame id="next" data-state=""></x-frame><x-frame id="later" data-state=""></x-frame>`
        )
      );
      expect(report.flashes).toEqual(["body > x-frame#later without [data-state]"]);
    } finally {
      await page.close();
    }
  });

  it("lists a node gone with its parent once, as the parent", async () => {
    const page = openWindow();
    try {
      customElements.define(
        "x-nest",
        class extends HTMLElement {
          connectedCallback() {
            document.addEventListener(
              "DOMContentLoaded",
              () => {
                const list = this.querySelector("ul")!;
                const item = list.querySelector("li")!;
                item.remove();
                list.remove();
                setTimeout(() => {
                  list.append(item);
                  this.append(list);
                }, 0);
              },
              { once: true }
            );
          }
        }
      );
      const report = await hydrate(
        page.window,
        prerendered(`<x-nest id="n"><ul><li></li></ul></x-nest>`)
      );
      expect(report.flashes).toEqual(["body > x-nest#n without ul"]);
    } finally {
      await page.close();
    }
  });

  it("leaves out what a no-ssr region changes, and an ssr: false element's own attributes only, naming both", async () => {
    const page = openWindow();
    try {
      class Demo extends HTMLElement {
        connectedCallback() {
          document.addEventListener(
            "DOMContentLoaded",
            () => {
              (this.firstChild as Text).data = "client";
              this.setAttribute("data-state", "client");
              this.querySelector("i")!.replaceWith(document.createElement("b"));
              // back a task later
              this.removeAttribute("data-blink");
              setTimeout(() => this.setAttribute("data-blink", ""), 0);
            },
            { once: true }
          );
        }
      }
      customElements.define("x-demo", Demo);
      // a Neutron tag with `ssr: false`, as its `getConfig()` gives it
      customElements.define(
        "x-self",
        class extends Demo {
          static getConfig() {
            return { ssr: false };
          }
        }
      );
      const demo = (id: string, tag = "x-demo", inner = "") =>
        `<${tag} id="${id}" data-state="server" data-blink="">server<i></i>${inner}</${tag}>`;
      const report = await hydrate(
        page.window,
        prerendered(
          `<section id="demos" no-ssr>${demo("in")}<p no-ssr></p>${demo("in-self", "x-self")}</section>${demo("out")}${demo("self", "x-self", demo("child"))}`
        )
      );
      const SELF = "body > x-self#self";
      const CHILD = `${SELF} > x-demo#child`;
      expect(report).toMatchObject({
        keptOut: ["body > section#demos", SELF],
        // nothing of the region; of the ssr: false element, its nodes and text
        removed: ["body > x-demo#out > i", `${CHILD} > i`, `${SELF} > i`],
        added: ["body > x-demo#out > b", `${CHILD} > b`, `${SELF} > b`],
        attributes: [
          {
            element: "body > x-demo#out",
            name: "data-state",
            server: "server",
            final: "client",
          },
          { element: CHILD, name: "data-state", server: "server", final: "client" },
        ],
        rewrites: [
          { element: "body > x-demo#out", name: "data-blink", value: "", writes: 2 },
          { element: CHILD, name: "data-blink", value: "", writes: 2 },
        ],
        texts: [
          { node: 'body > x-demo#out > "client"', server: "server", final: "client" },
          { node: `${CHILD} > "client"`, server: "server", final: "client" },
          { node: `${SELF} > "client"`, server: "server", final: "client" },
        ],
        flashes: [
          "body > x-demo#out without [data-blink]",
          `${CHILD} without [data-blink]`,
        ],
      });
    } finally {
      await page.close();
    }
  });

  it("reports what happens outside a no-ssr region: its root removed or replaced, a node moved out of it", async () => {
    const page = openWindow();
    try {
      customElements.define(
        "x-portal",
        class extends HTMLElement {
          connectedCallback() {
            document.addEventListener(
              "DOMContentLoaded",
              () => {
                document.getElementById("gone")!.remove();
                document.getElementById("swapped")!.replaceWith(document.createElement("aside"));
                // the region's own: changed, then detached within the task
                const scratch = document.querySelector("#portal > span")!;
                scratch.append(document.createElement("i"));
                scratch.remove();
                // moved out of the region, then changed
                const moved = document.getElementById("moved")!;
                document.body.append(moved);
                moved.append(document.createElement("b"));
              },
              { once: true }
            );
          }
        }
      );
      const report = await hydrate(
        page.window,
        prerendered(
          `<section id="gone" no-ssr><p></p></section><section id="swapped" no-ssr><p></p></section><section id="portal" no-ssr><p id="moved"></p><span></span></section><x-portal></x-portal>`
        )
      );
      expect(report).toMatchObject({
        keptOut: ["body > section#gone", "body > section#swapped", "body > section#portal"],
        removed: ["body > section#gone", "body > section#swapped"],
        added: ["body > aside", "body > p#moved", "body > p#moved > b"],
      });
    } finally {
      await page.close();
    }
  });

  it("runs each 0 ms timeout in its own task, as browsers do; splitTimeouts: false runs happy-dom's way", async () => {
    const page = openWindow();
    // as Vitest does around each RPC (a module fetch, a task update): an
    // assignment to the global must neither hide the patch nor keep it
    const saveAndRestore = () => {
      const saved = globalThis.setTimeout;
      globalThis.setTimeout = saved;
    };
    try {
      customElements.define(
        "x-tick",
        class extends HTMLElement {
          connectedCallback() {
            document.addEventListener(
              "DOMContentLoaded",
              () => {
                saveAndRestore();
                setTimeout(() => this.removeAttribute("data-state"), 0);
                setTimeout(() => this.setAttribute("data-state", ""), 0);
              },
              { once: true }
            );
          }
        }
      );
      const html = prerendered(`<x-tick id="t" data-state=""></x-tick>`);
      const ownTimeout = page.window.setTimeout;
      saveAndRestore();
      expect((await hydrate(page.window, html)).flashes).toEqual([
        "body > x-tick#t without [data-state]",
      ]);
      // both in one task: back before the next
      expect(
        (await hydrate(page.window, html, { splitTimeouts: false })).flashes
      ).toEqual([]);
      expect(page.window.setTimeout).toBe(ownTimeout);
    } finally {
      await page.close();
    }
  });

  it("rejects with what reading the page between two tasks threw", async () => {
    const page = openWindow();
    try {
      customElements.define(
        "x-unreadable",
        class extends HTMLElement {
          connectedCallback() {
            document.addEventListener(
              "DOMContentLoaded",
              () => {
                this.removeAttribute("data-state");
                this.hasAttribute = () => {
                  throw new Error("unreadable");
                };
              },
              { once: true }
            );
          }
        }
      );
      await expect(
        hydrate(page.window, prerendered(`<x-unreadable data-state=""></x-unreadable>`))
      ).rejects.toThrow("unreadable");
    } finally {
      await page.close();
    }
  });

  it("passes on a response whose request began before it logged, with no status to set", async () => {
    const page = openWindow();
    try {
      let passed: Promise<unknown> | undefined;
      customElements.define(
        "x-late",
        class extends HTMLElement {
          connectedCallback() {
            document.addEventListener(
              "DOMContentLoaded",
              () => {
                // happy-dom keeps a request's interceptor: a test calls the logging one
                const { interceptor } = (
                  window as unknown as {
                    happyDOM: {
                      settings: {
                        fetch: {
                          interceptor: {
                            afterAsyncResponse(context: object): Promise<unknown>;
                          };
                        };
                      };
                    };
                  }
                ).happyDOM.settings.fetch;
                passed = interceptor.afterAsyncResponse({
                  request: new Request(`${ORIGIN}/early.json`),
                  response: new Response("{}"),
                  window,
                });
              },
              { once: true }
            );
          }
        }
      );
      const report = await hydrate(page.window, prerendered("<x-late></x-late>"));
      await expect(passed).resolves.toBeUndefined();
      expect(report.requests.map(({ url }) => url)).toEqual([`${ORIGIN}/site.css`]);
    } finally {
      await page.close();
    }
  });

  it("opens no window for a page without an island", async () => {
    const page = openWindow();
    try {
      const report = await hydrate(page.window, "<p>static</p>");
      expect(report).toMatchObject({ ...NO_CHANGE, windowMs: 0 });
    } finally {
      await page.close();
    }
  });

  it("gives up on a hydration window that never closes", async () => {
    const page = openWindow();
    try {
      const { holdHydration } = await import("@excom/kit-utils");
      customElements.define(
        "x-hold",
        class extends HTMLElement {
          connectedCallback() {
            document.addEventListener(
              "DOMContentLoaded",
              () => queueMicrotask(() => void holdHydration(new Promise(() => {}))),
              { once: true }
            );
          }
        }
      );
      await expect(
        hydrate(page.window, prerendered("<x-hold></x-hold>"), { timeout: 100 })
      ).rejects.toThrow("nucleus-ssr: the hydration window stayed open past 100 ms");
    } finally {
      await page.close();
    }
  });

  it("needs the window's globals", async () => {
    const { window, dispose } = createDom();
    await expect(hydrate(window, "<p>x</p>")).rejects.toThrow(
      "nucleus-ssr: hydrate needs the window's globals (installGlobals(window))"
    );
    await dispose();
  });
});
