import { RenderableElement } from "../../index";
import { KitLogger } from "@excom/kit-logger";
import {
  clearFetchCaches,
  holdHydration,
  HYDRATION_ISLAND_ID,
  type HydrationIsland,
  resetHydration,
  type ServerRender,
  SSR_ATTR,
  STAMP_ATTR,
} from "@excom/kit-utils";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  wait,
  waitForEvent,
} from "@excom/nucleus-test";
import { invokeCommand } from "@excom/neutron";

const TAG = "renderable-hydration-test";
if (!customElements.get(TAG)) {
  RenderableElement.define(TAG);
}

// Lifecycle events use the base's config tag (`noop-tag`)
const EVT = (name: string) => `noop-tag-${name}`;

const ssr = globalThis as { __NUCLEUS_SSR__?: ServerRender };

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
 * Renders `html` as the prerenderer does, `views` answering its fetches:
 * the markup, the recorded responses and the server's fetch count.
 */
const prerender = async (
  html: string,
  {
    views = {},
    settle = () => wait(10),
  }: {
    views?: Record<string, string>;
    settle?: (root: HTMLElement) => unknown;
  } = {}
) => {
  const server: ServerRender = { responses: [] };
  ssr.__NUCLEUS_SSR__ = server;
  const fetchSpy = serveViews(views);
  try {
    const root = document.createElement("div");
    document.body.append(root);
    root.innerHTML = html;
    await settle(root);
    return {
      markup: root.innerHTML,
      responses: server.responses,
      fetches: fetchSpy.mock.calls.length,
    };
  } finally {
    document.body.innerHTML = "";
    delete ssr.__NUCLEUS_SSR__;
    clearFetchCaches();
    fetchSpy.mockRestore();
  }
};

/** A view announcing readiness once rendered, as the server waits for it. */
const readyOnRender = async (root: HTMLElement) => {
  const el = root.querySelector(TAG)!;
  await waitForEvent(el, EVT("did-render"));
  el.dispatchEvent(new Event("x-ready"));
  await wait(0);
};

/**
 * Loads `markup` as a browser loads a prerendered page: parsed whole with
 * the island last, mounted in tree order once the document is parsed.
 * Records every mutation from the first mount on.
 */
const hydrate = (markup: string, responses: HydrationIsland["responses"]) => {
  resetHydration();
  document.documentElement.setAttribute(SSR_ATTR, "");
  const readyState = vi
    .spyOn(document, "readyState", "get")
    .mockReturnValue("loading");
  const root = document.createElement("div");
  document.body.append(root);
  const island = JSON.stringify({ v: 1, provisions: {}, responses }).replace(
    /</g,
    "\\u003c"
  );
  root.innerHTML = `${markup}<script type="application/json" id="${HYDRATION_ISLAND_ID}">${island}</script>`;
  const records: MutationRecord[] = [];
  new MutationObserver((list) => records.push(...list)).observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
  });
  readyState.mockRestore();
  document.dispatchEvent(new Event("DOMContentLoaded"));
  return { root, records };
};

/** Child insertions / removals at or below `host`. */
const childMutations = (records: MutationRecord[], host: Node) =>
  records.filter(
    ({ type, target }) => type === "childList" && host.contains(target)
  );

const attributeMutations = (records: MutationRecord[], name: string) =>
  records.filter(({ attributeName }) => attributeName === name);

const countEvents = (target: EventTarget, type: string) => {
  const seen: Event[] = [];
  target.addEventListener(type, (e) => seen.push(e));
  return seen;
};

const settled = async () => {
  await wait(20);
};

describe("RenderableElement hydration", () => {
  afterEach(() => {
    resetHydration();
    document.documentElement.removeAttribute(SSR_ATTR);
    document.body.innerHTML = "";
    delete ssr.__NUCLEUS_SSR__;
    clearFetchCaches();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    KitLogger.unsuppress();
  });

  it("keeps the prerendered content of an inline template", async () => {
    const { markup, responses } = await prerender(
      `<${TAG} is-active><template><p class="inline">inline</p></template></${TAG}>`
    );
    expect(markup).toContain(`${STAMP_ATTR}="#`);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { root, records } = hydrate(markup, responses);
    const el = root.querySelector(TAG) as any;
    const server = el.querySelector(".inline");
    const renders = countEvents(el, EVT("did-render"));
    await settled();

    expect(el.querySelector(".inline")).toBe(server);
    expect(childMutations(records, el)).toEqual([]);
    expect(renders).toHaveLength(1);
    expect(el.readyPromiseObject).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves a URL template from the island; both boot renders keep the content", async () => {
    const { markup, responses } = await prerender(
      `<${TAG} is-active template-ref="/views/kept.html"></${TAG}>`,
      { views: { "/views/kept.html": `<section class="kept">kept</section>` } }
    );
    expect(responses).toHaveLength(1);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { root, records } = hydrate(markup, responses);
    const el = root.querySelector(TAG) as any;
    const server = el.querySelector(".kept");
    const renders = countEvents(el, EVT("did-render"));
    const renderChildren = vi.spyOn(el, "renderChildren");
    await settled();

    // the first-mount load, then the render event's own
    expect(renderChildren).toHaveBeenCalledTimes(2);
    expect(el.querySelector(".kept")).toBe(server);
    expect(childMutations(records, el)).toEqual([]);
    expect(renders).toHaveLength(1);
    expect(el.didLoad).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never hides prerendered content to wait for ready-on", async () => {
    const { markup, responses } = await prerender(
      `<${TAG} is-active ready-on="x-ready" template-ref="/views/ready.html"></${TAG}>`,
      {
        views: { "/views/ready.html": `<p class="ready">ready</p>` },
        settle: readyOnRender,
      }
    );
    expect(markup).not.toContain("delaying-ready");
    const { root, records } = hydrate(markup, responses);
    const el = root.querySelector(TAG) as any;
    await settled();

    expect(attributeMutations(records, "delaying-ready")).toEqual([]);
    expect(childMutations(records, el)).toEqual([]);
    // ready without the event: the server already waited for it
    expect(el.readyPromiseObject).toBeNull();
    expect(el.delayingReady).toBe(false);
  });

  it("hides a replaced render until ready-on, as on a cold load", async () => {
    const { markup, responses } = await prerender(
      `<${TAG} is-active ready-on="x-ready" template-ref="/views/changed.html"></${TAG}>`,
      {
        views: { "/views/changed.html": `<p class="old">old</p>` },
        settle: readyOnRender,
      }
    );
    // the view changed since the page was rendered
    responses[0].record.body = `<p class="new">new</p>`;
    const { root, records } = hydrate(markup, responses);
    const el = root.querySelector(TAG) as any;
    await settled();

    expect(el.querySelector(".old")).toBeNull();
    expect(el.querySelector(".new")).not.toBeNull();
    expect(el.hasAttribute(STAMP_ATTR)).toBe(false);
    expect(childMutations(records, el)).not.toEqual([]);
    expect(el.delayingReady).toBe(true);
    const ready = el.readyPromiseObject.promise;
    el.dispatchEvent(new Event("x-ready"));
    await ready;
    await wait(0);
    expect(el.delayingReady).toBe(false);
  });

  it("ignores ready-on from stale content until what replaces it is ready", async () => {
    const { markup } = await prerender(
      `<${TAG} is-active ready-on="x-ready" template-ref="/views/stale.html"></${TAG}>`,
      {
        views: { "/views/stale.html": `<p class="stale">stale</p>` },
        settle: readyOnRender,
      }
    );
    // the view changed since the build and is not in the island
    let respond!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise((resolve) => (respond = resolve))
    );
    const { root, records } = hydrate(markup, []);
    const el = root.querySelector(TAG) as any;
    await wait(10);
    // the stale content's own data lands first, and announces it
    el.querySelector(".stale").dispatchEvent(
      new Event("x-ready", { bubbles: true })
    );
    expect(el.readyPromiseObject).not.toBeNull();

    await waitForEvent(el, EVT("did-render"), () =>
      respond(
        new Response(`<p class="fresh">fresh</p>`, {
          headers: { "content-type": "text/html" },
        })
      )
    );
    expect(el.querySelector(".fresh")).not.toBeNull();
    expect(el.delayingReady).toBe(true);
    const ready = el.readyPromiseObject.promise;
    el.dispatchEvent(new Event("x-ready"));
    await ready;
    await wait(0);
    expect(el.delayingReady).toBe(false);
    expect(attributeMutations(records, "delaying-ready")).toHaveLength(2);
  });

  it("checks a portal target for prerendered content, and keeps it", async () => {
    const html = `
      <div id="hydration-portal"></div>
      <${TAG} is-active ready-on="x-ready" host-ref="#hydration-portal">
        <template><p class="portaled">portaled</p></template>
      </${TAG}>`;
    const { markup, responses } = await prerender(html, {
      settle: readyOnRender,
    });
    const { root, records } = hydrate(markup, responses);
    const target = root.querySelector("#hydration-portal")!;
    const server = target.querySelector(".portaled");
    const el = root.querySelector(TAG) as any;
    const unrenders = countEvents(el, EVT("did-unrender"));
    await settled();

    expect(target.querySelector(".portaled")).toBe(server);
    expect(childMutations(records, target)).toEqual([]);
    expect(attributeMutations(records, "delaying-ready")).toEqual([]);
    expect(unrenders).toEqual([]);
  });

  it("announces each element keeping content in a shared portal", async () => {
    const html = `
      <template id="hydration-shared"><p class="shared">shared</p></template>
      <div id="hydration-shared-portal"></div>
      <${TAG} is-active template-ref="#hydration-shared" host-ref="#hydration-shared-portal"></${TAG}>
      <${TAG} is-active template-ref="#hydration-shared" host-ref="#hydration-shared-portal"></${TAG}>`;
    const { markup, responses } = await prerender(html);
    const { root, records } = hydrate(markup, responses);
    const portal = root.querySelector("#hydration-shared-portal")!;
    const renders = Array.from(root.querySelectorAll(TAG), (el) =>
      countEvents(el, EVT("did-render"))
    );
    await settled();

    expect(renders.map((seen) => seen.length)).toEqual([1, 1]);
    expect(childMutations(records, portal)).toEqual([]);
  });

  it("announces a reload that keeps the content", async () => {
    const views = { "/views/again.html": `<p class="again">again</p>` };
    const { markup, responses } = await prerender(
      `<${TAG} is-active template-ref="/views/again.html"></${TAG}>`,
      { views }
    );
    const { root, records } = hydrate(markup, responses);
    const el = root.querySelector(TAG) as any;
    const renders = countEvents(el, EVT("did-render"));
    // the page still hydrates, e.g. a fetch in flight
    holdHydration(new Promise(() => {}));
    await settled();
    expect(renders).toHaveLength(1);

    const fetchSpy = serveViews(views);
    await waitForEvent(el, EVT("did-render"), () =>
      invokeCommand(el, "--reload")
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(renders).toHaveLength(2);
    expect(childMutations(records, el)).toEqual([]);
  });

  it("removes kept content when deactivated during its first-mount load", async () => {
    const { markup, responses } = await prerender(
      `<${TAG} is-active template-ref="/views/leaving.html"></${TAG}>`,
      { views: { "/views/leaving.html": `<p class="leaving">leaving</p>` } }
    );
    const { root } = hydrate(markup, responses);
    const el = root.querySelector(TAG) as any;
    expect(el.isLoading).toBe(true);
    const aborted = countEvents(el, "aborted");

    await waitForEvent(el, EVT("did-unrender"), () => {
      el.isActive = false;
    });
    expect(aborted).toHaveLength(1);
    expect(el.querySelector(".leaving")).toBeNull();
    expect(el.hasAttribute(STAMP_ATTR)).toBe(false);
  });

  it("toggles persist-content off and on with the prerendered nodes", async () => {
    const { markup, responses } = await prerender(
      `<${TAG} is-active persist-content><template><form><input name="q" /></form></template></${TAG}>`
    );
    const { root } = hydrate(markup, responses);
    const el = root.querySelector(TAG) as any;
    const form = el.querySelector("form");
    await settled();
    expect(el._persistedTree).toBe(form);

    await waitForEvent(el, EVT("did-unrender"), () => {
      el.isActive = false;
    });
    expect(el.querySelector("form")).toBeNull();
    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(el.querySelector("form")).toBe(form);
  });

  it("renders cold without an island", async () => {
    const { markup } = await prerender(
      `<${TAG} is-active><template><p class="cold">cold</p></template></${TAG}>`
    );
    const root = document.createElement("div");
    root.innerHTML = markup;
    const server = root.querySelector(".cold");
    document.body.append(root);
    const el = root.querySelector(TAG) as any;
    await settled();

    expect(el.querySelector(".cold")).not.toBe(server);
    expect(el.hasAttribute(STAMP_ATTR)).toBe(false);
  });

  it("skips the idle pre-fetch during a server render", async () => {
    const idle = vi.fn();
    vi.stubGlobal("requestIdleCallback", idle);
    const { markup, responses, fetches } = await prerender(
      `<${TAG} pre-fetch="idle" template-ref="/views/idle.html"></${TAG}>`,
      { views: { "/views/idle.html": `<p>idle</p>` } }
    );
    expect(idle).not.toHaveBeenCalled();
    expect(fetches).toBe(0);
    expect(responses).toEqual([]);
    expect(markup).not.toContain("did-load");
  });
});
