import {
  clearFetchCaches,
  fetchPlainText,
  fetchTemplate,
  resolveModuleReference,
  resolveModuleUrl,
  resolveTemplateContent,
} from "../../fetching";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  vi,
  wait,
} from "@excom/nucleus-test";

// The template cache is module-wide, so every URL test uses its own path.
let counter = 0;
const uniqueUrl = (prefix = "/") => `${prefix}tpl-${++counter}.html`;

describe("fetchTemplate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the URL and parses the body into a fragment", async () => {
    const fetchSpy = spyFetch({ body: `<p class="fetched">hi</p>` });
    const url = uniqueUrl();
    const content = await fetchTemplate(url);
    expect(content).toBeInstanceOf(DocumentFragment);
    expect(content.firstElementChild?.className).toBe("fetched");
    expect(fetchSpy).toHaveBeenCalledWith(url, {});
  });

  it("forwards reqInit to fetch", async () => {
    const fetchSpy = spyFetch({ body: "<p></p>" });
    const url = uniqueUrl();
    const reqInit = { headers: { "x-test": "1" } };
    await fetchTemplate(url, { reqInit });
    expect(fetchSpy).toHaveBeenCalledWith(url, reqInit);
  });

  it("rejects a non-ok response instead of parsing the error page", async () => {
    spyFetch({ status: 404, body: "<h1>Not Found</h1>" });
    const url = uniqueUrl();
    await expect(fetchTemplate(url)).rejects.toThrow(`HTTP 404: ${url}`);
  });
});

describe("resolveTemplateContent: URL templates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a promise on the first fetch and a clone synchronously after", async () => {
    const fetchSpy = spyFetch({ body: `<p class="one">one</p>` });
    const url = uniqueUrl();
    const first = resolveTemplateContent(url);
    expect(first).toBeInstanceOf(Promise);
    const firstEl = (await first) as Element;
    expect(firstEl.className).toBe("one");
    const second = resolveTemplateContent(url) as Element;
    expect(second).not.toBeInstanceOf(Promise);
    expect(second.className).toBe("one");
    expect(second).not.toBe(firstEl);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight fetch between concurrent resolves", async () => {
    const fetchSpy = spyFetch({ body: `<p>shared</p>` }, 2);
    const url = uniqueUrl("./");
    const a = resolveTemplateContent(url);
    const b = resolveTemplateContent(url);
    expect(a).toBeInstanceOf(Promise);
    expect(b).toBeInstanceOf(Promise);
    const [elA, elB] = (await Promise.all([a, b])) as Element[];
    expect(elA.textContent).toBe("shared");
    expect(elB.textContent).toBe("shared");
    expect(elA).not.toBe(elB);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("bypassCache refetches even when a fragment is cached and replaces it", async () => {
    let body = `<p>first</p>`;
    const fetchSpy = spyFetch(() => ({ body }));
    const url = uniqueUrl("../");
    await resolveTemplateContent(url);
    expect((resolveTemplateContent(url) as Element).textContent).toBe("first");
    body = `<p>second</p>`;
    const reload = resolveTemplateContent(url, { bypassCache: true });
    expect(reload).toBeInstanceOf(Promise);
    expect(((await reload) as Element).textContent).toBe("second");
    // later reads see the refreshed entry, synchronously
    const after = resolveTemplateContent(url) as Element;
    expect(after).not.toBeInstanceOf(Promise);
    expect(after.textContent).toBe("second");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("passes reqInit through on fetch and accepts absolute http URLs", async () => {
    const fetchSpy = spyFetch({ body: `<p>abs</p>` });
    const url = `http://example.test${uniqueUrl()}`;
    const reqInit = { cache: "no-store" as const };
    await resolveTemplateContent(url, { reqInit });
    expect(fetchSpy).toHaveBeenCalledWith(url, { reqInit }.reqInit);
  });

  it("wraps multi-root templates and honours skipCloning", async () => {
    spyFetch({ body: `<p>a</p><p>b</p>` });
    const url = uniqueUrl();
    const wrapped = (await resolveTemplateContent(url)) as Element;
    expect(wrapped.tagName).toBe("DIV");
    expect(wrapped.children.length).toBe(2);
    const single = uniqueUrl();
    vi.restoreAllMocks();
    spyFetch({ body: `<p>only</p>` });
    await resolveTemplateContent(single);
    const own1 = resolveTemplateContent(single, { skipCloning: true });
    const own2 = resolveTemplateContent(single, { skipCloning: true });
    expect(own1).toBe(own2);
    expect(resolveTemplateContent(single)).not.toBe(own1);
  });

  it("evicts a failed fetch so the next resolve fetches again", async () => {
    let status = 404;
    const fetchSpy = spyFetch(() => ({ status, body: `<p>page</p>` }));
    const url = uniqueUrl();
    const [a, b] = [resolveTemplateContent(url), resolveTemplateContent(url)];
    await expect(a).rejects.toThrow("404");
    await expect(b).rejects.toThrow("404");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    status = 200;
    const retry = resolveTemplateContent(url);
    expect(retry).toBeInstanceOf(Promise);
    expect(((await retry) as Element).textContent).toBe("page");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("resolveTemplateContent: selector templates", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("clones a <template> found in the document", () => {
    fixture(`<template id="tpl-sel"><span class="sel">x</span></template>`);
    const el = resolveTemplateContent("#tpl-sel") as Element;
    expect(el).not.toBeInstanceOf(Promise);
    expect(el.className).toBe("sel");
    const tpl = document.querySelector("#tpl-sel") as HTMLTemplateElement;
    expect(tpl.content.children.length).toBe(1);
    expect(el).not.toBe(tpl.content.firstElementChild);
  });

  it("resolves :scope relative to the given scope element", () => {
    const host = fixture<HTMLElement>(
      `<div><template class="inner-tpl"><i>scoped</i></template></div>`
    );
    fixture(`<template class="inner-tpl"><b>other</b></template>`);
    const el = resolveTemplateContent(":scope > .inner-tpl", {
      scope: host,
    }) as Element;
    expect(el.tagName).toBe("I");
    const own = resolveTemplateContent(":scope > .inner-tpl", {
      scope: host,
      skipCloning: true,
    }) as Element;
    expect(own).toBe(host.querySelector("template")!.content.firstElementChild);
  });

  it("throws when the scope cannot query or the template is missing", () => {
    expect(() =>
      resolveTemplateContent("#anything", { scope: {} as Element })
    ).toThrow("resolveTemplateContent requires a scope with querySelector");
    expect(() => resolveTemplateContent("#does-not-exist")).toThrow(
      "Template not found: #does-not-exist"
    );
    fixture(`<div id="not-a-template"></div>`);
    expect(() => resolveTemplateContent("#not-a-template")).toThrow(
      "Template not found: #not-a-template"
    );
  });
});

describe("resolveModuleReference", () => {
  it("imports relative to the page origin (unsupported under node)", async () => {
    await expect(resolveModuleReference("/mods/x.js")).rejects.toThrow();
  });

  it("refuses a data: module before importing it", async () => {
    await expect(
      resolveModuleReference("data:text/javascript,export const x = 1")
    ).rejects.toThrow('Refused module URL scheme "data:"');
  });
});

describe("resolveModuleUrl", () => {
  const origin = "https://app.test";

  it("passes absolute URLs through", () => {
    const cdn = "https://cdn.test/lib/mod.js?v=2";
    expect(resolveModuleUrl(cdn, origin)).toBe(cdn);
  });

  it("resolves every relative form against the site root", () => {
    for (const ref of [
      "/mods/x.js",
      "./mods/x.js",
      "../mods/x.js",
      "mods/x.js",
    ]) {
      expect(resolveModuleUrl(ref, origin)).toBe(`${origin}/mods/x.js`);
    }
  });

  it("defaults to the page origin", () => {
    expect(resolveModuleUrl("/x.js")).toBe(`${window.location.origin}/x.js`);
  });

  it("loads a scheme-relative or backslashed ref from that host", () => {
    for (const ref of ["//host/x.js", "\\\\host/x.js", "/\\host/x.js"]) {
      expect(resolveModuleUrl(ref, origin)).toBe("https://host/x.js");
    }
  });

  it("reads http:host/x.js per the page scheme", () => {
    expect(resolveModuleUrl("http:host/x.js", origin)).toBe("http://host/x.js");
    expect(resolveModuleUrl("http:host/x.js", "http://app.test")).toBe(
      "http://app.test/host/x.js"
    );
  });

  it("allows the page's own scheme, and only that one", () => {
    const app = "capacitor://localhost";
    for (const ref of ["/x.js", "./x.js", "x.js"]) {
      expect(resolveModuleUrl(ref, app)).toBe(`${app}/x.js`);
    }
    expect(() => resolveModuleUrl("data:text/javascript,1", app)).toThrow(
      'Refused module URL scheme "data:"'
    );
    expect(() => resolveModuleUrl(`${app}/x.js`, origin)).toThrow(
      'Refused module URL scheme "capacitor:"'
    );
  });

  it("refuses every other scheme from an https page", () => {
    for (const ref of [
      "data:text/javascript,export default 1",
      "blob:https://app.test/0f0e",
      "javascript:void 0",
      "file:///x.js",
    ]) {
      expect(() => resolveModuleUrl(ref, origin)).toThrow(
        "Refused module URL scheme"
      );
    }
  });
});

describe("fetchPlainText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches once per URL and caches the text", async () => {
    const fetchSpy = spyFetch({ body: "plain body" });
    const url = uniqueUrl("/text/");
    const reqInit = { method: "GET" };
    await expect(fetchPlainText(url, { reqInit })).resolves.toBe("plain body");
    await expect(fetchPlainText(url)).resolves.toBe("plain body");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(url, reqInit);
    const other = uniqueUrl("/text/");
    await expect(fetchPlainText(other)).resolves.toBe("plain body");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenLastCalledWith(other, {});
  });

  it("rejects a non-ok response and fetches a failed URL again", async () => {
    let status = 404;
    const fetchSpy = spyFetch(() => ({ status, body: "sheet" }));
    const url = uniqueUrl("/text/");
    await expect(fetchPlainText(url)).rejects.toThrow(`HTTP 404: ${url}`);
    status = 200;
    await expect(fetchPlainText(url)).resolves.toBe("sheet");
    await expect(fetchPlainText(url)).resolves.toBe("sheet");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("clearFetchCaches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forgets one URL so the next resolve fetches again", async () => {
    const fetchSpy = spyFetch({ body: `<p>v1</p>` }, 2);
    const url = uniqueUrl();
    await resolveTemplateContent(url);
    expect(clearFetchCaches(url)).toBe(1);
    const again = resolveTemplateContent(url);
    expect(again).toBeInstanceOf(Promise);
    await again;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("forgets plain-text entries too, and everything when no URL is given", async () => {
    spyFetch({ body: "text" }, 4);
    const tpl = uniqueUrl();
    const txt = uniqueUrl("/text-");
    await resolveTemplateContent(tpl);
    await fetchPlainText(txt);
    expect(clearFetchCaches()).toBeGreaterThanOrEqual(2);
    expect(clearFetchCaches(tpl)).toBe(0);
    await fetchPlainText(txt);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not resurrect a purged entry when the in-flight fetch settles", async () => {
    const fetchSpy = spyFetch({ body: `<p>late</p>` }, 2);
    const url = uniqueUrl();
    const pending = resolveTemplateContent(url);
    expect(clearFetchCaches(url)).toBe(1);
    await pending;
    const next = resolveTemplateContent(url);
    expect(next).toBeInstanceOf(Promise);
    await next;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

/** Fetch stand-in: settles on `respond`, rejects like fetch when its signal aborts. */
const deferredFetch = () => {
  const pending: Array<(res: Response) => void> = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, init) =>
      new Promise((resolve, reject) => {
        pending.push(resolve);
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal!.reason)
        );
      })
  );
  const respond = (status = 200) =>
    pending.shift()!(new Response("<p>shared</p>", { status }));
  return { fetchSpy, respond };
};

/** `promise`, or `true` when it is still pending once queued tasks ran. */
const atOnce = (promise: Promise<unknown>) => Promise.race([promise, wait(0)]);

describe.each([
  [
    "resolveTemplateContent",
    async (url: string, signal?: AbortSignal) =>
      ((await resolveTemplateContent(url, { reqInit: { signal } })) as Element)
        .outerHTML,
  ],
  [
    "fetchPlainText",
    (url: string, signal?: AbortSignal) =>
      fetchPlainText(url, { reqInit: { signal } }),
  ],
])("%s: a caller's abort signal", (_, load) => {
  const unhandled = vi.fn();
  beforeEach(() => {
    unhandled.mockClear();
    process.on("unhandledRejection", unhandled);
  });
  afterEach(async () => {
    await wait(0);
    process.off("unhandledRejection", unhandled);
    vi.restoreAllMocks();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("ends only that caller's wait; the shared request serves the others", async () => {
    const { fetchSpy, respond } = deferredFetch();
    const url = uniqueUrl();
    const [first, second] = [new AbortController(), new AbortController()];
    const spies = [first, second].map(({ signal }) => ({
      add: vi.spyOn(signal, "addEventListener"),
      remove: vi.spyOn(signal, "removeEventListener"),
    }));
    const waits = [load(url, first.signal), load(url, second.signal)];
    first.abort();
    await expect(atOnce(waits[0])).rejects.toBe(first.signal.reason);
    respond();
    await expect(waits[1]).resolves.toBe("<p>shared</p>");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    spies.forEach(({ add, remove }) =>
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1])
    );
  });

  it("keeps the request of a lone caller that aborts, for the next call", async () => {
    const { fetchSpy, respond } = deferredFetch();
    const url = uniqueUrl();
    const controller = new AbortController();
    const waiting = load(url, controller.signal);
    controller.abort();
    await expect(atOnce(waiting)).rejects.toBe(controller.signal.reason);
    respond();
    await wait(0);
    const next = load(url);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(next).resolves.toBe("<p>shared</p>");
  });

  it("evicts a failed request whose only waiter aborted", async () => {
    const { fetchSpy, respond } = deferredFetch();
    const url = uniqueUrl();
    const controller = new AbortController();
    const waiting = load(url, controller.signal);
    controller.abort();
    await expect(atOnce(waiting)).rejects.toBe(controller.signal.reason);
    respond(404);
    await wait(0);
    const retry = load(url);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    respond();
    await expect(retry).resolves.toBe("<p>shared</p>");
  });

  it("rejects an already aborted signal at once and starts no request", async () => {
    const { fetchSpy, respond } = deferredFetch();
    const url = uniqueUrl();
    const signal = AbortSignal.abort();
    const other = load(url);
    await expect(atOnce(load(url, signal))).rejects.toBe(signal.reason);
    await expect(atOnce(load(uniqueUrl(), signal))).rejects.toBe(signal.reason);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    respond();
    await expect(other).resolves.toBe("<p>shared</p>");
  });

  it("still evicts a failed request that an aborted caller left", async () => {
    const { fetchSpy, respond } = deferredFetch();
    const url = uniqueUrl();
    const controller = new AbortController();
    const waits = [load(url, controller.signal), load(url)];
    controller.abort();
    await expect(atOnce(waits[0])).rejects.toBe(controller.signal.reason);
    respond(404);
    await expect(waits[1]).rejects.toThrow(`HTTP 404: ${url}`);
    const retry = load(url);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    respond();
    await expect(retry).resolves.toBe("<p>shared</p>");
  });
});
