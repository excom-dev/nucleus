import { invokeCommand } from "@excom/neutron";
import { RenderableElement } from "../../index";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  vi,
  wait,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { KitLogger } from "@excom/kit-logger";

const TAG = "renderable-lifecycle-test";
if (!customElements.get(TAG)) {
  RenderableElement.define(TAG);
}

/*
 * Lifecycle events use the base's config tag (`noop-tag`), not the
 * defined tag. `aborted` is not `prefixWithTag`, so it stays bare.
 */
const EVT = (name: string) => `noop-tag-${name}`;

const html = (body: string) => ({
  body,
  headers: new Headers({ "content-type": "text/html" }),
});

const abortError = () =>
  new DOMException("The operation was aborted.", "AbortError");

/** Fetch stub that only settles when its signal aborts (rejects `reason`). */
const spyAbortableFetch = (reason: () => Error = abortError) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(reason()));
      }),
  );

const reload = (el: Element) => invokeCommand(el, "--reload");

/**
 * Iframe-hosted element whose author iframe has no document yet.
 * `contentDocument` stays null until `load()` flips it and fires `load`.
 */
const buildPendingIframeHost = (extraAttrs = "", hostRef = "iframe") => {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<${TAG} host-ref="${hostRef}" ${extraAttrs}>
      <template><p>late</p></template>
      <iframe data-render-host></iframe>
    </${TAG}>`;
  const el = wrap.firstElementChild as any;
  const iframe = el.querySelector("iframe") as HTMLIFrameElement;
  const doc = document.implementation.createHTMLDocument("");
  let ready = false;
  Object.defineProperty(iframe, "contentDocument", {
    configurable: true,
    get: () => (ready ? doc : null),
  });
  document.body.appendChild(wrap);
  return {
    el,
    iframe,
    doc,
    load: () => {
      ready = true;
      iframe.dispatchEvent(new Event("load"));
    },
  };
};

describe("RenderableElement template resolution", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    KitLogger.unsuppress();
  });

  it("resolves template-ref as an in-document selector", async () => {
    document.body.innerHTML = `
      <template id="rl-shared-tpl"><p>shared</p></template>
      <${TAG} template-ref="#rl-shared-tpl"></${TAG}>
    `;
    const el = document.querySelector(TAG) as any;

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });

    expect(el.querySelector("p")?.textContent).toBe("shared");
    expect(document.getElementById("rl-shared-tpl")).not.toBeNull();
    expect(el).dom.to.equalTag(
      `<${TAG} template-ref="#rl-shared-tpl" is-active did-load></${TAG}>`,
    );
  });

  it("fetches template-ref as a URL with the abort signal", async () => {
    const fetchSpy = spyFetch(html("<p>remote</p>"));
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-url-basic.html"></${TAG}>`,
    );

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/rl-url-basic.html");
    expect(init.signal).toBeDefined();
    expect(el.querySelector("p")?.textContent).toBe("remote");
    expect(el.didLoad).toBe(true);
    expect(el.isLoading).toBe(false);
    expect(el.templatePromise).toBeNull();
  });

  it("re-activation reuses the cached URL fragment and emits did-unrender in between", async () => {
    const fetchSpy = spyFetch(html("<p>warm</p>"));
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-url-warm.html"></${TAG}>`,
    );

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    await waitForEvent(el, EVT("did-unrender"), () => {
      el.isActive = false;
    });
    expect(el.querySelector("p")).toBeNull();
    expect(el.didLoad).toBe(true);

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(el.querySelector("p")?.textContent).toBe("warm");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("emits error and sets is-error when the template is missing", async () => {
    KitLogger.suppress();
    const el = fixture<any>(`<${TAG}></${TAG}>`);

    await waitForEvent(el, EVT("error"), () => {
      el.isActive = true;
    });

    expect(el).dom.to.equalTag(`<${TAG} is-active is-error></${TAG}>`);
    expect(el.didLoad).toBe(false);
    expect(el.isLoading).toBe(false);
    expect(el.templatePromise).toBeNull();
  });

  it("emits error when the URL fetch fails, and a reload recovers", async () => {
    KitLogger.suppress();
    let nthCall = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      nthCall++;
      if (nthCall === 1) return Promise.reject(new TypeError("offline"));
      return Promise.resolve(
        new Response("<p>recovered</p>", {
          headers: { "content-type": "text/html" },
        }),
      );
    });
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-url-fail.html"></${TAG}>`,
    );

    await waitForEvent(el, EVT("error"), () => {
      el.isActive = true;
    });
    expect(el.isError).toBe(true);
    expect(el.querySelector("p")).toBeNull();

    await waitForEvent(el, EVT("did-render"), () => {
      reload(el);
    });
    expect(el.isError).toBe(false);
    expect(el.didLoad).toBe(true);
    expect(el.querySelector("p")?.textContent).toBe("recovered");
    expect(nthCall).toBe(2);
  });

  it("changing template-ref clears did-load and renders the new template", async () => {
    document.body.innerHTML = `
      <template id="rl-tpl-a"><p>A</p></template>
      <template id="rl-tpl-b"><p>B</p></template>
      <${TAG} template-ref="#rl-tpl-a"></${TAG}>
    `;
    const el = document.querySelector(TAG) as any;

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(el.querySelector("p")?.textContent).toBe("A");

    await waitForEvent(el, EVT("did-render"), () => {
      el.templateRef = "#rl-tpl-b";
    });
    expect(el.querySelector("p")?.textContent).toBe("B");
    expect(el.didLoad).toBe(true);
  });

  it("changing template-ref while loading aborts the in-flight fetch", async () => {
    spyAbortableFetch();
    document.body.innerHTML = `
      <template id="rl-tpl-swap"><p>swapped</p></template>
      <${TAG} template-ref="/rl-url-slow-swap.html"></${TAG}>
    `;
    const el = document.querySelector(TAG) as any;
    const onError = vi.fn();
    el.addEventListener(EVT("error"), onError);

    el.isActive = true;
    // the load starts on the render thunk's microtask
    await wait(0);
    expect(el.isLoading).toBe(true);
    const { signal } = el.abortController;

    await waitForEvent(el, EVT("did-render"), () => {
      el.templateRef = "#rl-tpl-swap";
    });

    expect(signal.aborted).toBe(true);
    expect(el.querySelector("p")?.textContent).toBe("swapped");
    await wait(10);
    expect(onError).not.toHaveBeenCalled();
    expect(el.isError).toBe(false);
  });

  it("changing template-ref while inactive only resets state", async () => {
    const fetchSpy = spyFetch(html("<p>x</p>"));
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-url-inactive-a.html"></${TAG}>`,
    );
    el.templateRef = "/rl-url-inactive-b.html";
    await wait(10);
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "/rl-url-inactive-a.html",
      expect.anything(),
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "/rl-url-inactive-b.html",
      expect.anything(),
    );
    expect(el.didLoad).toBe(false);
    expect(el.isLoading).toBe(false);
  });
});

describe("RenderableElement pre-fetch", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    KitLogger.unsuppress();
  });

  it("pre-fetch=eager fetches while inactive and renders warm on activate", async () => {
    const fetchSpy = spyFetch(html("<p>eager</p>"));
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-prefetch-eager.html" pre-fetch="eager"></${TAG}>`,
    );

    await wait(10);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(el.didLoad).toBe(true);
    expect(el.isActive).toBeFalsy();
    expect(el.querySelector("p")).toBeNull();

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(el.querySelector("p")?.textContent).toBe("eager");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("pre-fetch='' aliases eager", async () => {
    const fetchSpy = spyFetch(html("<p>alias</p>"));
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-prefetch-alias.html" pre-fetch=""></${TAG}>`,
    );
    await wait(10);
    expect(el.preFetch).toBe("");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(el.didLoad).toBe(true);
  });

  it("pre-fetch=idle schedules the fetch through requestIdleCallback", async () => {
    const idleSpy = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idleSpy);
    const fetchSpy = spyFetch(html("<p>idle</p>"));

    const el = fixture<any>(
      `<${TAG} template-ref="/rl-prefetch-idle.html" pre-fetch="idle"></${TAG}>`,
    );

    expect(idleSpy).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 17,
    });
    await wait(10);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(el.didLoad).toBe(true);
    expect(el.isActive).toBeFalsy();
  });

  it("pre-fetch=idle skips the fetch when pre-fetch changed before idle", async () => {
    let idleCb: (() => void) | undefined;
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((cb: () => void) => {
        idleCb = cb;
        return 1;
      }),
    );
    const fetchSpy = spyFetch(html("<p>never</p>"));

    const el = fixture<any>(
      `<${TAG} template-ref="/rl-prefetch-idle-changed.html" pre-fetch="idle"></${TAG}>`,
    );
    expect(idleCb).toBeTypeOf("function");

    el.preFetch = "lazy";
    idleCb!();
    await wait(10);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(el.didLoad).toBeFalsy();
    expect(el.isLoading).toBeFalsy();
  });

  it("pre-fetch=lazy does not fetch until activated", async () => {
    const fetchSpy = spyFetch(html("<p>lazy</p>"));
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-prefetch-lazy.html" pre-fetch="lazy"></${TAG}>`,
    );
    await wait(10);
    expect(fetchSpy).not.toHaveBeenCalled();
    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("setting pre-fetch while active re-resolves immediately", async () => {
    const fetchSpy = spyFetch(html("<p>active</p>"));
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-prefetch-active.html"></${TAG}>`,
    );
    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });

    await waitForEvent(el, EVT("did-render"), () => {
      el.preFetch = "idle";
    });
    // URL fragment is cached: no second network hit
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(el.querySelector("p")?.textContent).toBe("active");
  });

  it("reload while inactive with pre-fetch=eager resets and re-warms did-load", async () => {
    const fetchSpy = spyFetch(html("<p>rewarm</p>"));
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-prefetch-reload.html" pre-fetch="eager"></${TAG}>`,
    );
    await wait(10);
    expect(el.didLoad).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    reload(el);
    await wait(10);
    expect(el.didLoad).toBe(true);
    expect(el.isActive).toBeFalsy();

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(el.querySelector("p")?.textContent).toBe("rewarm");
  });
});

describe("RenderableElement host-ref", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    KitLogger.unsuppress();
  });

  it("host-ref=shadow attaches an open shadow root and renders into it", async () => {
    const el = fixture<any>(
      `<${TAG} host-ref="shadow"><template><p>shadow</p></template></${TAG}>`,
    );
    expect(el.shadowRoot).not.toBeNull();
    expect(el.renderHost).toBe(el.shadowRoot);

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    // activation re-resolves the host and reuses the existing shadow root
    expect(el.renderHost).toBe(el.shadowRoot);
    expect(el.shadowRoot.querySelector("p")?.textContent).toBe("shadow");
    expect(el.querySelector("p")).toBeNull();
    expect(el.querySelector("template")).not.toBeNull();

    await waitForEvent(el, EVT("did-unrender"), () => {
      el.isActive = false;
    });
    expect(el.shadowRoot.querySelector("p")).toBeNull();
  });

  it("host-ref=iframe renders into the author iframe body and unrenders from it", async () => {
    const el = fixture<any>(
      `<${TAG} host-ref="iframe">
        <template><p>iframed</p></template>
        <iframe data-render-host srcdoc="<!doctype html><html><body></body></html>"></iframe>
      </${TAG}>`,
    );
    const iframe = el.querySelector("iframe[data-render-host]");

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(el.renderHost).toBe(iframe.contentDocument.body);
    expect(iframe.contentDocument.body.querySelector("p")?.textContent).toBe(
      "iframed",
    );
    expect(Array.from(el.children).some((c: any) => c.tagName === "P")).toBe(
      false,
    );

    await waitForEvent(el, EVT("did-unrender"), () => {
      el.isActive = false;
    });
    expect(iframe.contentDocument.body.querySelector("p")).toBeNull();
    expect(el.querySelector("iframe[data-render-host]")).toBe(iframe);
  });

  it("host-ref=iframe without an author iframe renders nothing", async () => {
    const el = fixture<any>(
      `<${TAG} host-ref="iframe"><template><p>x</p></template></${TAG}>`,
    );
    expect(el.renderHost).toBeNull();
    const onRender = vi.fn();
    el.addEventListener(EVT("did-render"), onRender);

    el.isActive = true;
    await wait(20);

    expect(el.didLoad).toBe(true);
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.querySelector("p")).toBeNull();
    expect(onRender).not.toHaveBeenCalled();
  });

  it("host-ref selector portals content into the matched element", async () => {
    document.body.innerHTML = `
      <div id="rl-portal-target"></div>
      <${TAG} host-ref="#rl-portal-target"><template><p>portal</p></template></${TAG}>
    `;
    const el = document.querySelector(TAG) as any;
    const target = document.getElementById("rl-portal-target")!;
    expect(el.renderHost).toBe(target);

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(target.querySelector("p")?.textContent).toBe("portal");
    expect(el.querySelector("p")).toBeNull();

    await waitForEvent(el, EVT("did-unrender"), () => {
      el.isActive = false;
    });
    expect(target.querySelector("p")).toBeNull();
  });

  it("host-ref selector that matches nothing renders and unrenders nothing", async () => {
    const el = fixture<any>(
      `<${TAG} host-ref="#rl-nowhere"><template><p>x</p></template></${TAG}>`,
    );
    expect(el.renderHost).toBeNull();
    const onRender = vi.fn();
    const onUnrender = vi.fn();
    el.addEventListener(EVT("did-render"), onRender);
    el.addEventListener(EVT("did-unrender"), onUnrender);

    el.isActive = true;
    await wait(20);
    expect(el.querySelector("p")).toBeNull();
    expect(onRender).not.toHaveBeenCalled();

    el.isActive = false;
    await wait(10);
    expect(onUnrender).not.toHaveBeenCalled();
  });

  it("re-targets from light DOM to shadow while active, clearing the old host", async () => {
    const el = fixture<any>(
      `<${TAG}><template><p>moves</p></template></${TAG}>`,
    );
    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(el.querySelector("p")?.textContent).toBe("moves");

    const onUnrender = vi.fn();
    el.addEventListener(EVT("did-unrender"), onUnrender);
    await waitForEvent(el, EVT("did-render"), () => {
      el.hostRef = "shadow";
    });

    expect(onUnrender).toHaveBeenCalledTimes(1);
    expect(el.querySelector("p")).toBeNull();
    expect(el.shadowRoot.querySelector("p")?.textContent).toBe("moves");
  });

  it("re-targets a persisted tree without re-resolving the template", async () => {
    const el = fixture<any>(
      `<${TAG} persist-content><template><p>kept</p></template></${TAG}>`,
    );
    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    const live = el.querySelector("p");
    expect(el._persistedTree).toBeTruthy();

    await waitForEvent(el, EVT("did-render"), () => {
      el.hostRef = "shadow";
    });
    expect(el.shadowRoot.querySelector("p")).toBe(live);
    expect(el._persistedTree).toBeTruthy();
  });

  it("routes an invalid host-ref selector to the error lifecycle", () => {
    const errorSpy = vi.spyOn(KitLogger, "error").mockImplementation(
      () => {},
    );
    const el = fixture<any>(`<${TAG}><template><p>x</p></template></${TAG}>`);
    el.hostRef = "#[invalid";
    expect(errorSpy).toHaveBeenCalledWith(
      `${TAG}:`,
      expect.objectContaining({ message: expect.any(String) }),
    );
  });
});

describe("RenderableElement late-ready iframe host", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    KitLogger.unsuppress();
  });

  it("waits for the iframe to load, then paints into its body", async () => {
    const { el, doc, load } = buildPendingIframeHost();
    expect(el.renderHost).toBeNull();

    el.isActive = true;
    await wait(10);
    expect(el.didLoad).toBe(true);
    expect(doc.body.querySelector("p")).toBeNull();

    await waitForEvent(el, EVT("did-render"), load);
    expect(el.renderHost).toBe(doc.body);
    expect(doc.body.querySelector("p")?.textContent).toBe("late");
  });

  it("only records the host when the iframe loads while inactive", async () => {
    const { el, doc, load } = buildPendingIframeHost();
    load();
    await wait(0);
    expect(el.renderHost).toBe(doc.body);
    expect(doc.body.querySelector("p")).toBeNull();

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(doc.body.querySelector("p")?.textContent).toBe("late");
  });

  it("ignores the iframe load once host-ref has moved elsewhere", async () => {
    const { el, doc, load } = buildPendingIframeHost();
    el.isActive = true;
    await wait(10);

    await waitForEvent(el, EVT("did-render"), () => {
      el.hostRef = "shadow";
    });
    load();
    await wait(10);

    expect(doc.body.querySelector("p")).toBeNull();
    expect(el.renderHost).toBe(el.shadowRoot);
    expect(el.shadowRoot.querySelector("p")?.textContent).toBe("late");
  });

  it("ignores the iframe load once the iframe has been removed", async () => {
    const { el, iframe, doc, load } = buildPendingIframeHost();
    el.isActive = true;
    await wait(10);

    iframe.remove();
    load();
    await wait(10);

    expect(el.renderHost).toBeNull();
    expect(doc.body.querySelector("p")).toBeNull();
  });

  it("re-places a persisted tree once the iframe is ready", async () => {
    // Start on a shadow host. A light-DOM host would clear the author
    // iframe with the rendered content when `host-ref` retargets.
    const { el, doc, load } = buildPendingIframeHost(
      "persist-content",
      "shadow",
    );
    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    const live = el.shadowRoot.querySelector("p");
    expect(live).not.toBeNull();
    expect(el._persistedTree).toBe(live);

    el.hostRef = "iframe";
    await wait(0);
    expect(el.renderHost).toBeNull();
    expect(el.shadowRoot.querySelector("p")).toBeNull();
    expect(el._persistedTree).toBe(live);

    await waitForEvent(el, EVT("did-render"), load);
    expect(el.renderHost).toBe(doc.body);
    expect(doc.body.querySelector("p")).toBe(live);
  });
});

describe("RenderableElement reload", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    KitLogger.unsuppress();
  });

  it("re-fetches with bypassCache and re-renders while active", async () => {
    let nthCall = 0;
    const fetchSpy = spyFetch(() => html(`<p>render-${++nthCall}</p>`));
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-reload-refetch.html"></${TAG}>`,
    );

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(el.querySelector("p")?.textContent).toBe("render-1");

    await waitForEvent(el, EVT("did-render"), () => {
      reload(el);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(el.querySelector("p")?.textContent).toBe("render-2");
    expect(el.didLoad).toBe(true);
  });

  it("does nothing while inactive with lazy pre-fetch", async () => {
    const fetchSpy = spyFetch(html("<p>x</p>"));
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-reload-inactive.html"></${TAG}>`,
    );
    reload(el);
    await wait(10);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(el.isLoading).toBeFalsy();
    expect(el.didLoad).toBeFalsy();
  });

  it("aborts an in-flight fetch before re-resolving", async () => {
    let nthCall = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      nthCall++;
      if (nthCall === 1) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(abortError()));
        });
      }
      return Promise.resolve(
        new Response(`<p>reloaded-${nthCall}</p>`, {
          headers: { "content-type": "text/html" },
        }),
      );
    });
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-reload-inflight.html"></${TAG}>`,
    );
    const onError = vi.fn();
    el.addEventListener(EVT("error"), onError);

    el.isActive = true;
    // the load starts on the render thunk's microtask
    await wait(0);
    expect(el.isLoading).toBe(true);
    const { signal } = el.abortController;

    await waitForEvent(el, EVT("did-render"), () => {
      reload(el);
    });
    expect(signal.aborted).toBe(true);
    expect(nthCall).toBe(2);
    expect(el.querySelector("p")?.textContent).toBe("reloaded-2");
    expect(onError).not.toHaveBeenCalled();
  });

  it("drops a persisted tree so the reload paints fresh nodes", async () => {
    let nthCall = 0;
    spyFetch(() => html(`<p>v${++nthCall}</p>`));
    const el = fixture<any>(
      `<${TAG} persist-content template-ref="/rl-reload-persist.html"></${TAG}>`,
    );
    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    const first = el.querySelector("p");
    expect(el._persistedTree).toBe(first);

    await waitForEvent(el, EVT("did-render"), () => {
      reload(el);
    });
    const second = el.querySelector("p");
    expect(second).not.toBe(first);
    expect(second?.textContent).toBe("v2");
    expect(el._persistedTree).toBe(second);
  });
});

describe("RenderableElement ready-on and render events", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    KitLogger.unsuppress();
  });

  it("keeps delaying-ready until the ready-on event fires", async () => {
    const el = fixture<any>(
      `<${TAG} ready-on="rl-ready"><template><p>r</p></template></${TAG}>`,
    );
    expect(el).toContainListeners({ "rl-ready": 1 });

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(el.delayingReady).toBe(true);
    expect(el).dom.to.equalTag(
      `<${TAG} ready-on="rl-ready" is-active did-load delaying-ready></${TAG}>`,
    );
    const readyPromise = el.readyPromiseObject.promise;

    el.dispatchEvent(new Event("rl-ready"));
    await readyPromise;
    await wait(0);
    expect(el.delayingReady).toBe(false);
    expect(el.readyPromiseObject).toBeNull();
  });

  it("render thunk resolves when ready-on fires", async () => {
    const el = fixture<any>(
      `<${TAG} ready-on="rl-ready-thunk"><template><p>t</p></template></${TAG}>`,
    );
    let thunkResult: Promise<void> | undefined;
    el.addEventListener(EVT("render"), (e: CustomEvent) => {
      e.preventDefault();
      thunkResult = e.detail();
    });

    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    expect(thunkResult).toBeInstanceOf(Promise);
    expect(el.delayingReady).toBe(true);

    el.dispatchEvent(new Event("rl-ready-thunk"));
    await thunkResult;
    expect(el.delayingReady).toBe(false);
  });

  it("swaps and removes the ready-on listener as the option changes", () => {
    const el = fixture<any>(
      `<${TAG} ready-on="rl-ready-a"><template><p>r</p></template></${TAG}>`,
    );
    expect(el).toContainListeners({ "rl-ready-a": 1 });

    el.readyOn = "rl-ready-b";
    expect(el).toContainListeners({ "rl-ready-a": 0, "rl-ready-b": 1 });

    el.removeAttribute("ready-on");
    expect(el).toContainListeners({ "rl-ready-a": 0, "rl-ready-b": 0 });
  });

  it("aborts a delaying-ready render when deactivated", async () => {
    const el = fixture<any>(
      `<${TAG} ready-on="rl-ready-abort"><template><p>r</p></template></${TAG}>`,
    );
    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    const readyPromise = el.readyPromiseObject.promise;
    const onUnrender = vi.fn();
    el.addEventListener(EVT("unrender"), onUnrender);

    await waitForEvent(el, "aborted", () => {
      el.isActive = false;
    });
    await expect(readyPromise).rejects.toBeUndefined();
    expect(el.delayingReady).toBe(false);
    expect(onUnrender).not.toHaveBeenCalled();
  });

  it("a deferred render thunk is a no-op once the element is inactive", async () => {
    const el = fixture<any>(`<${TAG}><template><p>d</p></template></${TAG}>`);
    let thunk: (() => Promise<void> | undefined) | undefined;
    el.addEventListener(EVT("render"), (e: CustomEvent) => {
      e.preventDefault();
      thunk = e.detail;
    });
    const onRender = vi.fn();
    el.addEventListener(EVT("did-render"), onRender);

    el.isActive = true;
    expect(thunk).toBeTypeOf("function");
    expect(el.readyPromiseObject).toBeTruthy();

    el.isActive = false;
    await wait(0);
    thunk!();
    await wait(10);

    expect(onRender).not.toHaveBeenCalled();
    expect(el.querySelector("p")).toBeNull();
    expect(el.readyPromiseObject).toBeNull();
  });

  it("a cancelled unrender leaves content in place until the thunk runs", async () => {
    const el = fixture<any>(`<${TAG}><template><p>u</p></template></${TAG}>`);
    await waitForEvent(el, EVT("did-render"), () => {
      el.isActive = true;
    });
    let thunk: (() => void) | undefined;
    el.addEventListener(EVT("unrender"), (e: CustomEvent) => {
      e.preventDefault();
      thunk = e.detail;
    });

    el.isActive = false;
    await wait(0);
    expect(el.querySelector("p")).not.toBeNull();

    await waitForEvent(el, EVT("did-unrender"), () => thunk!());
    expect(el.querySelector("p")).toBeNull();
  });
});

describe("RenderableElement abort handling", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    KitLogger.unsuppress();
  });

  it("aborts the in-flight template fetch on disconnect without an error", async () => {
    spyAbortableFetch();
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-abort-disconnect.html"></${TAG}>`,
    );
    const onError = vi.fn();
    el.addEventListener(EVT("error"), onError);

    el.isActive = true;
    // the load starts on the render thunk's microtask
    await wait(0);
    expect(el.isLoading).toBe(true);
    const { signal } = el.abortController;

    el.remove();
    await wait(10);

    expect(signal.aborted).toBe(true);
    expect(el.isLoading).toBe(false);
    expect(el.templatePromise).toBeNull();
    expect(el.isError).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("deactivating while loading emits aborted instead of unrender", async () => {
    spyAbortableFetch();
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-abort-deactivate.html"></${TAG}>`,
    );
    const onUnrender = vi.fn();
    el.addEventListener(EVT("unrender"), onUnrender);
    el.isActive = true;
    await wait(0);
    expect(el.isLoading).toBe(true);
    const { signal } = el.abortController;

    await waitForEvent(el, "aborted", () => {
      el.isActive = false;
    });
    expect(signal.aborted).toBe(true);
    expect(el.isLoading).toBe(false);
    expect(onUnrender).not.toHaveBeenCalled();
  });

  it("an externally aborted fetch is logged as debug, not error", async () => {
    spyAbortableFetch();
    const debugSpy = vi.spyOn(KitLogger, "debug").mockImplementation(
      () => {},
    );
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-abort-external.html"></${TAG}>`,
    );
    const onError = vi.fn();
    el.addEventListener(EVT("error"), onError);

    el.isActive = true;
    await wait(0);
    expect(el.isLoading).toBe(true);
    el.doAbort();
    await wait(10);

    expect(onError).not.toHaveBeenCalled();
    expect(el.isError).toBe(false);
    expect(debugSpy).toHaveBeenCalledWith("templatePromise was aborted");
  });

  it("wraps a non-abort rejection as AbortError when the signal was aborted", async () => {
    spyAbortableFetch(() => new Error("socket closed"));
    const debugSpy = vi.spyOn(KitLogger, "debug").mockImplementation(
      () => {},
    );
    const el = fixture<any>(
      `<${TAG} template-ref="/rl-abort-wrapped.html"></${TAG}>`,
    );
    const onError = vi.fn();
    el.addEventListener(EVT("error"), onError);

    el.isActive = true;
    await wait(0);
    expect(el.isLoading).toBe(true);
    el.doAbort();
    await wait(10);

    expect(onError).not.toHaveBeenCalled();
    expect(el.isError).toBe(false);
    expect(debugSpy).toHaveBeenCalledWith("templatePromise was aborted");
  });
});
