import {
  clearFetchCaches,
  fetchPlainText,
  fetchTemplate,
  resolveModuleReference,
  resolveTemplateContent,
} from "../../fetching";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

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
