import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  wait,
  waitForEvent,
} from "@excom/nucleus-test";
import "../../index";
import { installViewTransition, navigate, resetRouter } from "../../testing";
import { kitRouter } from "@excom/kit-router";
import {
  bootHydration,
  clearFetchCaches,
  HYDRATION_ISLAND_ID,
  type HydrationIsland,
  isHydrating,
  resetHydration,
  type ServerRender,
  SSR_ATTR,
  STAMP_ATTR,
} from "@excom/kit-utils";

const router = kitRouter as unknown as { routes: unknown[] } & typeof kitRouter;
const ssr = globalThis as { __NUCLEUS_SSR__?: ServerRender };

const VIEWS = {
  "/views/a.html": `<section class="a"><h1>Alpha</h1></section>`,
};

// Like the docs site: a remote view that announces `page-ready`
const SHELL = `
  <spa-manager>
    <spa-route route-href="/a" template-ref="/views/a.html" ready-on="page-ready" same-route="refresh" document-title="Alpha"></spa-route>
    <spa-route route-href="/b"><template><p class="b">B</p></template></spa-route>
  </spa-manager>
`;

/** `fetch` answering each URL with its view's text. */
const serveViews = (views: Record<string, string>) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const response = new Response(views[url as string], {
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(response, "url", {
      value: new URL(url as string, location.href).href,
    });
    return response;
  });

/**
 * Renders `url` as the prerenderer does, once the update settled: views
 * announce `page-ready` when rendered. The markup and recorded responses.
 */
const prerenderPage = async (
  url: string,
  html: string,
  views: Record<string, string> = VIEWS
) => {
  const server: ServerRender = { responses: [] };
  ssr.__NUCLEUS_SSR__ = server;
  const fetchSpy = serveViews(views);
  const announce = ({ target }: Event) =>
    target!.dispatchEvent(new Event("page-ready"));
  document.addEventListener("spa-route-did-render", announce);
  resetRouter(url);
  try {
    await waitForEvent(document.body, "spa-manager-rendered", () => {
      document.body.innerHTML = html;
    });
    return { markup: document.body.innerHTML, responses: server.responses };
  } finally {
    document.removeEventListener("spa-route-did-render", announce);
    document.body.innerHTML = "";
    // routes unregister a microtask after they disconnect
    await wait(0);
    router.routes = [];
    delete ssr.__NUCLEUS_SSR__;
    clearFetchCaches();
    fetchSpy.mockRestore();
  }
};

const islandOf = (responses: HydrationIsland["responses"]) =>
  `<script type="application/json" id="${HYDRATION_ISLAND_ID}">${JSON.stringify(
    { v: 1, provisions: {}, responses }
  ).replace(/</g, "\\u003c")}</script>`;

/**
 * Parses `markup` as a browser parses a prerendered page, the island last.
 * `mount()` ends the parse: elements mount in tree order, and every
 * mutation from then on is recorded.
 */
const loadPage = (markup: string, responses: HydrationIsland["responses"]) => {
  resetHydration();
  document.documentElement.setAttribute(SSR_ATTR, "");
  const readyState = vi
    .spyOn(document, "readyState", "get")
    .mockReturnValue("loading");
  const root = document.createElement("div");
  document.body.append(root);
  root.innerHTML = markup + islandOf(responses);
  const records: MutationRecord[] = [];
  const mount = () => {
    new MutationObserver((list) => records.push(...list)).observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    readyState.mockRestore();
    document.dispatchEvent(new Event("DOMContentLoaded"));
  };
  return { root, records, mount };
};

/**
 * The same page under a module kit, which runs once the page is parsed and
 * defines `<spa-manager>` before `<spa-route>`: no mount gate, and the
 * manager registers before its routes upgrade.
 */
const loadPageUngated = (
  markup: string,
  responses: HydrationIsland["responses"]
) => {
  resetHydration();
  document.documentElement.setAttribute(SSR_ATTR, "");
  document.body.insertAdjacentHTML("beforeend", islandOf(responses));
  bootHydration();
  const root = document.createElement("div");
  document.body.append(root);
  // attached, so happy-dom mounts the manager before parsing its routes
  root.innerHTML = markup;
  return root;
};

const route = (root: Element, href: string) =>
  root.querySelector<HTMLSpaRouteElement>(`spa-route[route-href="${href}"]`)!;

/** Child insertions / removals at or below `host`. */
const childMutations = (records: MutationRecord[], host: Node) =>
  records.filter(
    ({ type, target }) => type === "childList" && host.contains(target)
  );

const captureEvents = (root: EventTarget, types: string[]) => {
  const seen: string[] = [];
  for (const type of types) {
    root.addEventListener(
      type,
      ({ target }) =>
        seen.push(
          `${type} ${(target as Element).getAttribute("route-href") ?? ""}`.trim()
        ),
      true
    );
  }
  return seen;
};

/** Calls to `el[method]`, each recorded as `read()` at that moment. */
const trace = <T>(el: object, method: string, read: () => T) => {
  const calls: T[] = [];
  const original = el[method];
  vi.spyOn(el as Record<string, () => unknown>, method).mockImplementation(
    (...args: unknown[]) => {
      calls.push(read());
      return original(...args);
    }
  );
  return calls;
};

let vt: ReturnType<typeof installViewTransition> | undefined;

beforeEach(() => {
  resetRouter();
  document.title = "Shell";
});
afterEach(() => {
  vt?.restore();
  vt = undefined;
  resetHydration();
  document.documentElement.removeAttribute(SSR_ATTR);
  document.body.innerHTML = "";
  router.routes = [];
  delete ssr.__NUCLEUS_SSR__;
  clearFetchCaches();
  vi.restoreAllMocks();
  resetRouter();
  document.documentElement.scrollTop = 0;
});

describe("spa-route hydration", () => {
  it("keeps a prerendered route: no replacement, refetch, teardown, hiding or transition", async () => {
    const { markup, responses } = await prerenderPage("/a", SHELL);
    expect(markup).toContain("has-rendered");
    expect(markup).toContain(`${STAMP_ATTR}="/views/a.html#`);
    // a reload: the browser restores no scroll (manual), history has it
    resetRouter("/a", { scrollX: 0, scrollY: 640 });
    vt = installViewTransition();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const page = loadPage(markup, responses);
    const a = route(page.root, "/a");
    const manager =
      page.root.querySelector<HTMLSpaManagerElement>("spa-manager")!;
    const server = a.querySelector(".a");
    const events = captureEvents(page.root, [
      "spa-route-did-render",
      "spa-route-unrender",
      "spa-route-did-unrender",
      "aborted",
      "spa-manager-rendered",
    ]);
    // the first-mount load, then the one spa-manager's render thunk starts
    const loads = trace(a, "attemptLoad", () => manager._updating);
    const renders = trace(a, "renderChildren", isHydrating);
    const rendered = waitForEvent(manager, "spa-manager-rendered");
    page.mount();
    await null;
    // restored as the manager mounts, before its first update
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 640,
      behavior: "instant",
    });
    expect(loads).toEqual([false]);
    await rendered;

    expect(loads).toEqual([false, true]);
    expect(renders).toEqual([true, true]);
    expect(a.querySelector(".a")).toBe(server);
    expect(childMutations(page.records, a)).toEqual([]);
    expect(
      page.records.filter(
        ({ attributeName }) => attributeName === "delaying-ready"
      )
    ).toEqual([]);
    expect(events).toEqual(["spa-route-did-render /a", "spa-manager-rendered"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vt!.calls).toHaveLength(0);
    // the first update wrote none
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(manager.hasRendered).toBe(true);

    // later updates as on any page
    await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
    expect(vt!.calls).toHaveLength(1);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: 0,
      top: 0,
      behavior: "instant",
    });
    expect(a.querySelector(".a")).toBeNull();
    expect(page.root.querySelector(".b")).not.toBeNull();
  });

  it("leaves a fresh visit's scroll to the browser, #fragment included", async () => {
    const { markup, responses } = await prerenderPage("/a", SHELL, {
      "/views/a.html": `<section class="a"><h1 id="part">Alpha</h1></section>`,
    });
    resetRouter("/a#part");
    const scrollTo = vi.spyOn(window, "scrollTo");
    const intoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const page = loadPage(markup, responses);
    const manager =
      page.root.querySelector<HTMLSpaManagerElement>("spa-manager")!;
    const rendered = waitForEvent(manager, "spa-manager-rendered");
    page.mount();
    await rendered;

    expect(scrollTo).not.toHaveBeenCalled();
    expect(intoView).not.toHaveBeenCalled();
  });

  it.each([
    ["mounted once parsed", true],
    ["under a module kit", false],
  ])(
    "respects scroll-set-disabled restoring a prerendered reload (%s)",
    async (_, gated) => {
      const { markup, responses } = await prerenderPage(
        "/a",
        SHELL.replace(`route-href="/a"`, `route-href="/a" scroll-set-disabled`)
      );
      resetRouter("/a", { scrollX: 0, scrollY: 640 });
      const scrollTo = vi.spyOn(window, "scrollTo");
      if (gated) loadPage(markup, responses).mount();
      else loadPageUngated(markup, responses);
      await wait(20);

      expect(scrollTo).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["no #fragment: the person scrolled", "/a", false],
    ["a #fragment moved the page", "/a#part", true],
  ])(
    "restores a reload the page moved before mounting only if %s",
    async (_, url, restores) => {
      const { markup, responses } = await prerenderPage("/a", SHELL, {
        "/views/a.html": `<section class="a"><h1 id="part">Alpha</h1></section>`,
      });
      resetRouter(url, { scrollX: 0, scrollY: 640 });
      // the page was on screen before the kit mounted
      document.documentElement.scrollTop = 120;
      const scrollTo = vi.spyOn(window, "scrollTo");
      loadPage(markup, responses).mount();
      await wait(20);

      expect(scrollTo).toHaveBeenCalledTimes(restores ? 1 : 0);
    }
  );

  it.each([
    ["a page prerendered for /a, loaded at /b", "/a", "/b", SHELL],
    [
      "the prerendered fallback, loaded at a URL another route matches",
      "/nowhere",
      "/b",
      SHELL.replace(
        "</spa-manager>",
        `<spa-route route-regex=".*" is-fallback template-ref="/views/missing.html"></spa-route></spa-manager>`
      ),
    ],
  ])(
    "removes the content of a route the URL leaves mid-load: %s",
    async (_, from, to, shell) => {
      const { markup, responses } = await prerenderPage(from, shell, {
        ...VIEWS,
        "/views/missing.html": `<p class="missing">Not found</p>`,
      });
      const leaving = from === "/a" ? ".a" : ".missing";
      resetRouter(to);
      const page = loadPage(markup, responses);
      const manager =
        page.root.querySelector<HTMLSpaManagerElement>("spa-manager")!;
      const host = page.root.querySelector(leaving)!.parentElement!;
      const rendered = waitForEvent(manager, "spa-manager-rendered");
      page.mount();
      await rendered;

      expect(page.root.querySelector(leaving)).toBeNull();
      expect(host.hasAttribute(STAMP_ATTR)).toBe(false);
      expect(page.root.querySelector(".b")).not.toBeNull();
    }
  );

  it("settles a route whose view changed on the new view's ready-on, not the stale one's", async () => {
    const { markup } = await prerenderPage("/a", SHELL);
    // the view changed since the build and is not in the island
    let respond!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise((resolve) => (respond = resolve))
    );
    resetRouter("/a");
    const page = loadPage(markup, []);
    const a = route(page.root, "/a");
    const manager =
      page.root.querySelector<HTMLSpaManagerElement>("spa-manager")!;
    const events = captureEvents(page.root, ["spa-manager-rendered"]);
    page.mount();
    await wait(10);
    // the stale content's own data lands first, and announces it
    a.querySelector(".a")!.dispatchEvent(
      new Event("page-ready", { bubbles: true })
    );
    await wait(10);
    expect(events).toEqual([]);

    await waitForEvent(a, "spa-route-did-render", () =>
      respond(
        new Response(`<section class="a2"><h1>Alpha 2</h1></section>`, {
          headers: { "content-type": "text/html" },
        })
      )
    );
    expect(a.delayingReady).toBe(true);
    expect(events).toEqual([]);
    await waitForEvent(manager, "spa-manager-rendered", () =>
      a
        .querySelector(".a2")!
        .dispatchEvent(new Event("page-ready", { bubbles: true }))
    );
    expect(a.delayingReady).toBe(false);
  });

  it("hydrates until a first update the app starts late, and keeps the content", async () => {
    const { markup, responses } = await prerenderPage("/a", SHELL);
    resetRouter("/a");
    vt = installViewTransition();
    const page = loadPage(markup, responses);
    const a = route(page.root, "/a");
    const manager =
      page.root.querySelector<HTMLSpaManagerElement>("spa-manager")!;
    const server = a.querySelector(".a");
    // the app holds the first update, e.g. until its fonts load
    manager.addEventListener(
      "spa-manager-will-transition",
      (e) => e.preventDefault(),
      { once: true }
    );
    const renders = trace(a, "renderChildren", isHydrating);
    const events = captureEvents(page.root, ["spa-route-did-render"]);
    page.mount();
    // long past two quiet tasks, which close a window nothing holds
    await wait(50);
    expect(renders).toEqual([true]);

    await navigate(manager, () => manager.updateRoutes(true));
    expect(renders).toEqual([true, true]);
    expect(a.querySelector(".a")).toBe(server);
    expect(childMutations(page.records, a)).toEqual([]);
    expect(events).toEqual(["spa-route-did-render /a"]);
    expect(vt!.calls).toHaveLength(0);
  });

  it("falls back to the shell title the server recorded", async () => {
    const { markup, responses } = await prerenderPage("/a", SHELL);
    expect(markup).toContain(`default-title="Shell"`);
    // the prerendered page's own <title>
    expect(document.title).toBe("Alpha");
    resetRouter("/a");
    const page = loadPage(markup, responses);
    const manager =
      page.root.querySelector<HTMLSpaManagerElement>("spa-manager")!;
    const rendered = waitForEvent(manager, "spa-manager-rendered");
    page.mount();
    await rendered;
    expect(document.title).toBe("Alpha");

    await navigate(manager, () => kitRouter.pushState({ url: "/b" }));
    expect(document.title).toBe("Shell");
    // a view rendered on the client announces itself
    const announce = ({ target }: Event) =>
      target!.dispatchEvent(new Event("page-ready"));
    page.root.addEventListener("spa-route-did-render", announce);
    await navigate(manager, () => kitRouter.pushState({ url: "/a" }));
    expect(document.title).toBe("Alpha");
  });

  it("replaces a route whose view changed, hidden until ready-on as on a cold load", async () => {
    const { markup, responses } = await prerenderPage("/a", SHELL);
    responses[0].record.body = `<section class="a2"><h1>Alpha 2</h1></section>`;
    resetRouter("/a");
    const page = loadPage(markup, responses);
    const a = route(page.root, "/a");
    const manager =
      page.root.querySelector<HTMLSpaManagerElement>("spa-manager")!;
    page.mount();
    await wait(20);

    expect(a.querySelector(".a")).toBeNull();
    expect(a.querySelector(".a2")).not.toBeNull();
    expect(childMutations(page.records, a)).not.toEqual([]);
    expect(a.delayingReady).toBe(true);
    // the update waits for the view
    expect(manager._updating).toBe(true);
    await waitForEvent(manager, "spa-manager-rendered", () =>
      a.dispatchEvent(new Event("page-ready"))
    );
    expect(a.delayingReady).toBe(false);
  });

  it("keeps a layout route and its nested route", async () => {
    const html = `
      <spa-manager>
        <spa-route route-href="/docs" match-nested>
          <template>
            <section class="layout">
              <spa-manager>
                <spa-route route-href="/docs/:name" template-ref="/views/doc.html"></spa-route>
              </spa-manager>
            </section>
          </template>
        </spa-route>
      </spa-manager>
    `;
    const { markup, responses } = await prerenderPage("/docs/intro", html, {
      "/views/doc.html": `<article class="doc">Doc</article>`,
    });
    resetRouter("/docs/intro");
    vt = installViewTransition();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const page = loadPage(markup, responses);
    const layout = route(page.root, "/docs");
    const doc = route(page.root, "/docs/:name");
    const servedLayout = layout.querySelector(".layout");
    const servedDoc = doc.querySelector(".doc");
    const events = captureEvents(page.root, ["spa-route-did-render"]);
    const rendered = waitForEvent(
      page.root.querySelector("spa-manager")!,
      "spa-manager-rendered"
    );
    page.mount();
    await rendered;
    await wait(0);

    expect(layout.querySelector(".layout")).toBe(servedLayout);
    expect(doc.querySelector(".doc")).toBe(servedDoc);
    expect(childMutations(page.records, page.root)).toEqual([]);
    expect(events.sort()).toEqual([
      "spa-route-did-render /docs",
      "spa-route-did-render /docs/:name",
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vt!.calls).toHaveLength(0);
  });
});
