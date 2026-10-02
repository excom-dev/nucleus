import { hashString } from "../../common";
import { replaceNonTemplateChildren } from "../../dom";
import {
  clearFetchCaches,
  fetchPlainText,
  resolveTemplateContent,
  templateIdentity,
} from "../../fetching";
import {
  bootHydration,
  canAdopt,
  claimProvision,
  type FetchRecord,
  fetchRecord,
  hasServerContent,
  holdHydration,
  htmlIdentity,
  HYDRATION_ISLAND_ID,
  type HydrationIsland,
  INERT_ATTR,
  isHydrating,
  isIslandPending,
  isServerRender,
  resetHydration,
  type ServerRender,
  SSR_ATTR,
  STAMP_ATTR,
  TEMPLATE_ID_ATTR,
  whenHydrated,
} from "../../hydration";
import { LoopGuard } from "../../loop-guard";
import { observeProperty } from "../../property";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  vi,
} from "@excom/nucleus-test";

const ORIGIN = location.origin;

const record = (fields: Partial<FetchRecord> = {}): FetchRecord => ({
  url: "/api/a",
  status: 200,
  statusText: "OK",
  ok: true,
  redirected: false,
  type: "basic",
  headers: [["content-type", "application/json"]],
  body: `{"n":1}`,
  ...fields,
});

const islandJson = (data: Partial<HydrationIsland> = {}) =>
  JSON.stringify({ v: 1, provisions: {}, responses: [], ...data });

const script = (text: string, type = "application/json") =>
  fixture<HTMLScriptElement>(
    `<script type="${type}" id="${HYDRATION_ISLAND_ID}">${text}</script>`
  );

/** A prerendered page: `<html n-ssr>`, its island at the end of the body. */
const island = (data: Partial<HydrationIsland> = {}) => {
  document.documentElement.setAttribute(SSR_ATTR, "");
  return script(islandJson(data));
};

const boot = (data: Partial<HydrationIsland> = {}) => {
  island(data);
  bootHydration();
};

/** Runs every timer due at the next instant: one macrotask of the window. */
const nextTask = () => vi.advanceTimersToNextTimerAsync();

const ssr = (server: ServerRender | undefined) => {
  (globalThis as { __NUCLEUS_SSR__?: ServerRender }).__NUCLEUS_SSR__ = server;
};

const loading = () =>
  vi.spyOn(document, "readyState", "get").mockReturnValue("loading");

const parsed = (readyState: ReturnType<typeof loading>) => {
  readyState.mockReturnValue("interactive");
  document.dispatchEvent(new Event("DOMContentLoaded"));
};

/** A fetch answer whose headers may carry what a constructed Response drops. */
const answer = (headers: Record<string, string>, url = "") =>
  ({
    url,
    status: 200,
    statusText: "OK",
    ok: true,
    redirected: false,
    type: "basic",
    headers: new Headers(headers),
    text: async () => "body",
  }) as unknown as Response;

/** A fetch stand-in answered by hand. */
const deferredFetch = () => {
  const answers: Array<(response: Response) => void> = [];
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      () => new Promise<Response>((resolve) => answers.push(resolve))
    );
  return {
    fetchSpy,
    respond: (body = "network") => answers.shift()!(new Response(body)),
  };
};

afterEach(() => {
  resetHydration();
  ssr(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(SSR_ATTR);
});

describe("hydration: no island", () => {
  it("is inert", async () => {
    bootHydration();
    expect(isServerRender()).toBe(false);
    expect(isHydrating()).toBe(false);
    expect(isIslandPending()).toBe(false);
    await expect(whenHydrated()).resolves.toBeUndefined();
    const work = Promise.resolve(1);
    expect(holdHydration(work)).toBe(work);
    const host = fixture(`<div ${STAMP_ATTR}="#t"><p>server</p></div>`);
    expect(hasServerContent(host)).toBe(false);
    expect(canAdopt(host, "#t")).toBe(false);
  });

  it("fetchRecord passes the call to fetch and keeps a non-ok answer", async () => {
    const fetchSpy = spyFetch({ status: 404, body: "missing", url: "/x" });
    const init = { method: "GET" };
    await expect(fetchRecord("/api/missing", init)).resolves.toEqual({
      url: "/x",
      status: 404,
      statusText: "Not Found",
      ok: false,
      redirected: false,
      type: "basic",
      headers: [["content-type", "application/json"]],
      body: "missing",
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/missing", init);
  });

  it.each<[string, unknown, [string, string][]]>([
    ["no headers", undefined, []],
    ["plain-object headers", { "x-plain": "1" }, [["x-plain", "1"]]],
  ])(
    "fetchRecord reads a hand-made response with %s",
    async (_, headers, entries) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        headers,
        text: async () => "stub",
      } as Response);
      await expect(fetchRecord("/api/stub")).resolves.toMatchObject({
        ok: true,
        headers: entries,
        body: "stub",
      });
      await expect(fetchPlainText(`/text/${entries.length}.txt`)).resolves.toBe(
        "stub"
      );
    }
  );

  it("fetchRecord rejects like fetch on a network error or an abort", async () => {
    const offline = new TypeError("Failed to fetch");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(offline);
    await expect(fetchRecord("/api/a")).rejects.toBe(offline);
    const aborted = new DOMException("Aborted", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(aborted);
    await expect(fetchRecord("/api/a")).rejects.toBe(aborted);
  });
});

describe("hydration: the island", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("is read only on a prerendered page (`<html n-ssr>`)", () => {
    script(islandJson());
    bootHydration();
    expect(isHydrating()).toBe(false);
    document.documentElement.setAttribute(SSR_ATTR, "");
    bootHydration();
    expect(isHydrating()).toBe(true);
  });

  it("is the last JSON script with its id: earlier content cannot stand in", async () => {
    const forged = islandJson({
      provisions: { p: "forged" },
      responses: [
        {
          method: "GET",
          url: "/tpl/forged.html",
          record: record({ body: "<p>forged</p>" }),
        },
      ],
    });
    fixture(`<div id="${HYDRATION_ISLAND_ID}">${forged}</div>`);
    script(forged);
    script(islandJson({ provisions: { p: "plain" } }), "text/plain");
    island({ provisions: { p: "real" } });
    const el = fixture(`<island-el ${SSR_ATTR}="p"></island-el>`);
    bootHydration();
    expect(claimProvision(el)).toEqual({ value: "real" });
    const fetchSpy = spyFetch({ body: "<p>network</p>" });
    const content = (await resolveTemplateContent(
      "/tpl/forged.html"
    )) as Element;
    expect(content.textContent).toBe("network");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not JSON", "{oops"],
    ["another version", islandJson({ v: 2 } as unknown as HydrationIsland)],
    ["responses not an array", `{"v":1,"provisions":{},"responses":{}}`],
    ["a null response", `{"v":1,"provisions":{},"responses":[null]}`],
    ["provisions not an object", `{"v":1,"provisions":[],"responses":[]}`],
    ["no provisions", `{"v":1,"responses":[]}`],
    [
      "a response without a string method",
      `{"v":1,"provisions":{},"responses":[{"method":1,"url":"/a","record":{"body":""}}]}`,
    ],
    [
      "a response without a string url",
      `{"v":1,"provisions":{},"responses":[{"method":"GET","record":{"body":""}}]}`,
    ],
    [
      "a response without a record",
      `{"v":1,"provisions":{},"responses":[{"method":"GET","url":"/a","record":null}]}`,
    ],
    [
      "a record without a string body",
      `{"v":1,"provisions":{},"responses":[{"method":"GET","url":"/a","record":{"body":1}}]}`,
    ],
    // what serving relies on: each record as `fetchRecord` resolves one
    ...Object.entries<Partial<FetchRecord> & { count?: unknown }>({
      "a record URL that does not parse": { url: "http://[" },
      "malformed record headers": {
        headers: [["a"]] as unknown as FetchRecord["headers"],
      },
      "record headers not a list": {
        headers: { a: "1" } as unknown as FetchRecord["headers"],
      },
      "a record status that is not a number": {
        status: "200" as unknown as number,
      },
      "a record without ok": { ok: undefined },
      ...Object.fromEntries(
        [0, 1.5, "2", null, 1e300].map((count) => [
          `a count of ${count}`,
          { count },
        ])
      ),
    }).map(([name, { count, ...fields }]): [string, string] => [
      name,
      JSON.stringify({
        v: 1,
        provisions: {},
        responses: [{ method: "GET", url: "/a", record: record(fields), count }],
      }),
    ]),
  ])("is dropped whole when it has %s: one warning, no throw", (_, text) => {
    document.documentElement.setAttribute(SSR_ATTR, "");
    script(text);
    expect(() => bootHydration()).not.toThrow();
    bootHydration();
    expect(isHydrating()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("not there yet: nothing happens, silently, and a later call boots", () => {
    document.documentElement.setAttribute(SSR_ATTR, "");
    bootHydration();
    expect(isHydrating()).toBe(false);
    island();
    bootHydration();
    expect(isHydrating()).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips an element that refuses its provision, with one warning", () => {
    customElements.define(
      "getter-only-provision",
      class extends HTMLElement {
        get provision() {
          return null;
        }
      }
    );
    const sealed = fixture(`<other-pending ${SSR_ATTR}="b"></other-pending>`);
    Object.defineProperty(sealed, "provision", { get: () => null });
    const open = fixture<HTMLElement & { provision?: unknown }>(
      `<plain-pending ${SSR_ATTR}="c"></plain-pending>`
    );
    fixture(`<getter-only-provision ${SSR_ATTR}="a"></getter-only-provision>`);
    island({ provisions: { a: 1, b: 2, c: 3 } });
    expect(() => bootHydration()).not.toThrow();
    expect(isHydrating()).toBe(true);
    expect(open.provision).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("is read from the parsed page: a partial one or an earlier copy while loading is not", () => {
    const readyState = loading();
    fixture(`<pending-el ${SSR_ATTR}="p"></pending-el>`);
    script(islandJson({ provisions: { p: "forged" } }));
    const real = island({ provisions: { p: "real" } });
    real.textContent = `{"v":1,"provisions":{"p":`;
    bootHydration();
    expect(isHydrating()).toBe(false);
    expect(isIslandPending()).toBe(true);
    real.textContent = islandJson({ provisions: { p: "real" } });
    parsed(readyState);
    expect(isHydrating()).toBe(true);
    expect(isIslandPending()).toBe(false);
    expect(
      (
        document.querySelector("pending-el") as Element & {
          provision?: unknown;
        }
      ).provision
    ).toBe("real");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("hydration: boot", () => {
  it("opens the window once and ignores a later island", () => {
    boot({ provisions: { a: 1 } });
    expect(isHydrating()).toBe(true);
    const el = fixture<HTMLElement & { provision?: unknown }>(
      `<late-el ${SSR_ATTR}="a"></late-el>`
    );
    island({ provisions: { a: 2 } });
    bootHydration();
    expect(el.provision).toBeUndefined();
  });

  it("gives a not-yet-upgraded element an own provision and keeps its attribute", () => {
    const el = fixture<HTMLElement & { provision?: unknown }>(
      `<pending-el ${SSR_ATTR}="p1"></pending-el>`
    );
    const seen = vi.fn();
    // a sheet subscribed before boot
    observeProperty(el, "provision", seen);
    boot({ provisions: { p1: { title: "Hi" } } });
    expect(el.provision).toEqual({ title: "Hi" });
    expect(seen).toHaveBeenCalledWith({ title: "Hi" }, undefined);
    expect(el.getAttribute(SSR_ATTR)).toBe("p1");
    // the upgraded element claims the same value by the attribute
    expect(claimProvision(el)).toEqual({ value: { title: "Hi" } });
    expect(el.hasAttribute(SSR_ATTR)).toBe(false);
  });

  it("sets an upgraded element's provision through its setter", () => {
    class ProvisionProbe extends HTMLElement {
      received: unknown[] = [];
      set provision(value: unknown) {
        this.received.push(value);
      }
    }
    customElements.define("provision-probe", ProvisionProbe);
    const el = fixture<ProvisionProbe>(
      `<provision-probe ${SSR_ATTR}="p2"></provision-probe>`
    );
    const unknown = fixture(
      `<provision-probe ${SSR_ATTR}="nope"></provision-probe>`
    );
    boot({ provisions: { p2: [1, 2] } });
    expect(el.received).toEqual([[1, 2]]);
    expect(el.hasAttribute(SSR_ATTR)).toBe(false);
    expect(unknown.hasAttribute(SSR_ATTR)).toBe(false);
    expect(document.documentElement.getAttribute(SSR_ATTR)).toBe("");
  });

  it("stays inert during a server render", () => {
    ssr({ responses: [] });
    boot({ provisions: { a: 1 } });
    expect(isServerRender()).toBe(true);
    expect(isHydrating()).toBe(false);
    expect(isIslandPending()).toBe(false);
  });
});

describe("hydration: claimProvision", () => {
  it("boots when the island is there, claims once and drops the attribute", () => {
    const el = fixture(`<late-claim ${SSR_ATTR}="c"></late-claim>`);
    expect(claimProvision(fixture(`<p></p>`))).toBeUndefined();
    island({ provisions: { c: "data" } });
    expect(claimProvision(el)).toEqual({ value: "data" });
    expect(el.hasAttribute(SSR_ATTR)).toBe(false);
    expect(claimProvision(el)).toBeUndefined();
    el.setAttribute(SSR_ATTR, "c");
    expect(claimProvision(el)).toBeUndefined();
  });

  it("returns nothing for an upgraded element that boot just served", () => {
    customElements.define("claim-probe", class extends HTMLElement {});
    const el = fixture<HTMLElement & { provision?: unknown }>(
      `<claim-probe ${SSR_ATTR}="d"></claim-probe>`
    );
    island({ provisions: { d: "boot" } });
    expect(claimProvision(el)).toBeUndefined();
    expect(el.provision).toBe("boot");
  });
});

describe("hydration: the window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("closes after two quiet macrotasks and drops the island data", async () => {
    boot({
      provisions: { p: 1 },
      responses: [{ method: "GET", url: "/api/a", record: record() }],
    });
    const closed = vi.fn();
    whenHydrated().then(closed);
    await nextTask();
    expect(isHydrating()).toBe(true);
    await nextTask();
    expect(isHydrating()).toBe(false);
    expect(closed).toHaveBeenCalled();
    const el = fixture(`<x-late ${SSR_ATTR}="p"></x-late>`);
    expect(claimProvision(el)).toBeUndefined();
    const fetchSpy = spyFetch({ body: "net" });
    const pending = fetchRecord("/api/a");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ body: "net" });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("stays open while a hold is pending", async () => {
    const warn = vi.spyOn(console, "warn");
    boot();
    let release!: () => void;
    const work = new Promise<void>((resolve) => (release = resolve));
    expect(holdHydration(work)).toBe(work);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(isHydrating()).toBe(true);
    release();
    await work;
    await nextTask();
    expect(isHydrating()).toBe(true);
    await nextTask();
    expect(isHydrating()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("counts a served response as activity", async () => {
    boot({ responses: [{ method: "GET", url: "/api/a", record: record() }] });
    await nextTask();
    await fetchRecord("/api/a");
    await nextTask();
    await nextTask();
    expect(isHydrating()).toBe(true);
    await nextTask();
    expect(isHydrating()).toBe(false);
  });

  it("stays open for a kit fetch it does not serve, until it settles", async () => {
    boot();
    const { respond } = deferredFetch();
    const pending = fetchRecord("/api/live");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(isHydrating()).toBe(true);
    respond("late");
    await expect(pending).resolves.toMatchObject({ body: "late" });
    await nextTask();
    expect(isHydrating()).toBe(true);
    await nextTask();
    expect(isHydrating()).toBe(false);
  });

  it("closes at the deadline with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    boot();
    holdHydration(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(isHydrating()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(isHydrating()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("deadline");
  });

  it("resetHydration resolves waiters and forgets the window", async () => {
    boot();
    const waiting = whenHydrated();
    resetHydration();
    await expect(waiting).resolves.toBeUndefined();
    expect(isHydrating()).toBe(false);
  });
});

describe("hydration: whenHydrated", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("boots first, then resolves when the window closes", async () => {
    island();
    const done = vi.fn();
    whenHydrated().then(done);
    expect(isHydrating()).toBe(true);
    await nextTask();
    expect(done).not.toHaveBeenCalled();
    await nextTask();
    expect(done).toHaveBeenCalled();
  });

  it("on a page still being parsed, waits for the window the parsed page opens", async () => {
    const readyState = loading();
    document.documentElement.setAttribute(SSR_ATTR, "");
    const done = vi.fn();
    whenHydrated().then(done);
    script(islandJson());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(done).not.toHaveBeenCalled();
    parsed(readyState);
    expect(isHydrating()).toBe(true);
    await nextTask();
    expect(done).not.toHaveBeenCalled();
    await nextTask();
    expect(done).toHaveBeenCalled();
  });
});

describe("hydration: fetchRecord serving", () => {
  const served = record({ url: "/api/a?x=1", body: `{"n":2}` });
  // open for the whole test: the stubbed network answers a macrotask later
  const bootHeld = (data: Partial<HydrationIsland>) => {
    boot(data);
    holdHydration(new Promise(() => {}));
  };

  beforeEach(() => {
    bootHeld({
      responses: [
        { method: "GET", url: "/api/a?x=1", record: served },
        { method: "HEAD", url: "/api/a?x=1", record: record({ body: "" }) },
        // what a `Request` would have been keyed as
        { method: "GET", url: "/[object%20Request]", record: served },
        { method: "GET", url: "/api/u?k=1", record: record({ body: "u" }) },
        { method: "GET", url: "/api/dot?k=2", record: record({ body: "dot" }) },
        { method: "GET", url: "/api/up?k=3", record: record({ body: "up" }) },
      ],
    });
  });

  it("answers a matching request from memory, once without a count", async () => {
    const fetchSpy = spyFetch({ body: "network" });
    const first = await fetchRecord(`${ORIGIN}/api/a?x=1#part`);
    expect(first).toEqual({ ...served, url: `${ORIGIN}/api/a?x=1` });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await fetchRecord("/api/a?x=1", { method: "head" })).toMatchObject({
      body: "",
    });
    expect((await fetchRecord("/api/a?x=1")).body).toBe("network");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("answers as many identical requests as the server made, then the network", async () => {
    resetHydration();
    bootHeld({
      responses: [
        { method: "GET", url: "/api/twice", record: served, count: 2 },
      ],
    });
    const fetchSpy = spyFetch({ body: "network" });
    const bodies = [];
    for (let call = 0; call < 3; call++)
      bodies.push((await fetchRecord("/api/twice")).body);
    expect(bodies).toEqual([served.body, served.body, "network"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keys a URL object and ./ and ../ paths by path + query", async () => {
    const fetchSpy = spyFetch({ body: "network" });
    const bodies = await Promise.all(
      [new URL("/api/u?k=1", ORIGIN), "./api/dot?k=2", "../api/up?k=3"].map(
        async (input) => (await fetchRecord(input)).body
      )
    );
    expect(bodies).toEqual(["u", "dot", "up"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a Request to the network and leaves the entry for its URL", async () => {
    const fetchSpy = spyFetch({ body: "network" });
    const request = new Request(`${ORIGIN}/api/a?x=1`);
    expect((await fetchRecord(request)).body).toBe("network");
    expect(fetchSpy).toHaveBeenCalledWith(request, undefined);
    expect((await fetchRecord("/api/a?x=1")).body).toBe(served.body);
  });

  it("an abort before a served call answers rejects it, as fetch would, and gives its turn back", async () => {
    const fetchSpy = spyFetch({ body: "network" });
    const controller = new AbortController();
    const call = fetchRecord("/api/a?x=1", { signal: controller.signal });
    controller.abort();
    // as `doFetch` does: cancel, then fetch again at once
    const again = fetchRecord("/api/a?x=1");
    await expect(call).rejects.toBe(controller.signal.reason);
    expect((await again).body).toBe(served.body);
    // answered: the next call goes to the network
    expect((await fetchRecord("/api/a?x=1")).body).toBe("network");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("an abort after a served call answered, or once the window closed, gives nothing back", async () => {
    const fetchSpy = spyFetch({ body: "network" });
    const answered = new AbortController();
    await fetchRecord("/api/a?x=1", { signal: answered.signal });
    answered.abort();
    expect((await fetchRecord("/api/a?x=1")).body).toBe("network");
    const late = new AbortController();
    const call = fetchRecord("/api/u?k=1", { signal: late.signal });
    resetHydration();
    late.abort();
    await expect(call).rejects.toBe(late.signal.reason);
    expect((await fetchRecord("/api/u?k=1")).body).toBe("network");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each<[string, string, RequestInit?]>([
    ["a POST", "/api/a?x=1", { method: "POST" }],
    ["another query", "/api/a?x=2"],
    ["another origin", "https://elsewhere.test/api/a?x=1"],
    ["cache: no-store", "/api/a?x=1", { cache: "no-store" }],
    ["cache: no-cache", "/api/a?x=1", { cache: "no-cache" }],
    ["cache: reload", "/api/a?x=1", { cache: "reload" }],
    [
      "a Cache-Control header",
      "/api/a?x=1",
      { headers: { "Cache-Control": "max-age=0" } },
    ],
    [
      "an Authorization header",
      "/api/a?x=1",
      { headers: [["authorization", "Bearer x"]] },
    ],
    [
      "a Range header",
      "/api/a?x=1",
      { headers: new Headers({ range: "bytes=0-1" }) },
    ],
    ["integrity", "/api/a?x=1", { integrity: "sha256-x" }],
    ["mode: no-cors", "/api/a?x=1", { mode: "no-cors" }],
    ["an aborted signal", "/api/a?x=1", { signal: AbortSignal.abort() }],
    ["malformed headers", "/api/a?x=1", { headers: [["a"]] as HeadersInit }],
    ["an invalid URL", "http://[bad"],
  ])("never serves %s", async (_, url, init) => {
    const fetchSpy = spyFetch({ body: "network" });
    await expect(fetchRecord(url, init)).resolves.toMatchObject({
      body: "network",
    });
    expect(fetchSpy).toHaveBeenCalledWith(url, init);
  });

  it("feeds the template cache and its identity", async () => {
    resetHydration();
    document.body.innerHTML = "";
    const text = `<p class="served">hi</p>`;
    bootHeld({
      responses: [
        {
          method: "GET",
          url: "/tpl/served.html",
          record: record({ body: text }),
        },
        {
          method: "GET",
          url: "/text/served.txt",
          record: record({ body: "t" }),
        },
      ],
    });
    const fetchSpy = spyFetch({ body: "network" });
    expect(templateIdentity("/tpl/served.html")).toBeNull();
    const el = (await resolveTemplateContent("/tpl/served.html")) as Element;
    expect(el.className).toBe("served");
    expect(templateIdentity("/tpl/served.html")).toBe(
      `/tpl/served.html#${hashString(text)}`
    );
    await expect(fetchPlainText("/text/served.txt")).resolves.toBe("t");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("hydration: server recording", () => {
  let server: ServerRender;

  beforeEach(() => {
    server = { responses: [] };
    ssr(server);
  });

  it("records a same-origin GET / HEAD once, path-relative, counting identical requests", async () => {
    spyFetch({ body: "hello", url: `${ORIGIN}/api/r?q=1` });
    const got = await fetchRecord(`${ORIGIN}/api/r?q=1`);
    await fetchRecord("/api/r?q=1");
    await fetchRecord("/api/r?q=1", { method: "HEAD" });
    expect(got.url).toBe(`${ORIGIN}/api/r?q=1`);
    expect(server.responses).toEqual([
      {
        method: "GET",
        url: "/api/r?q=1",
        record: { ...got, url: "/api/r?q=1" },
        count: 2,
      },
      {
        method: "HEAD",
        url: "/api/r?q=1",
        record: { ...got, url: "/api/r?q=1" },
      },
    ]);
  });

  it("keeps the first body of a URL that answers differently, and counts the request", async () => {
    let body = "first";
    spyFetch(() => ({ body }));
    await fetchRecord("/api/changing");
    body = "second";
    await fetchRecord("/api/changing");
    await fetchRecord("/api/changing");
    expect(server.responses).toEqual([
      expect.objectContaining({
        record: expect.objectContaining({ body: "first" }),
        count: 3,
      }),
    ]);
  });

  it("counts only a repeat it would record", async () => {
    let status = 200;
    spyFetch(() => ({ status, body: "x" }));
    await fetchRecord("/api/repeat");
    status = 503;
    await fetchRecord("/api/repeat");
    server.exclude = (url) => url.endsWith("/api/repeat");
    status = 200;
    await fetchRecord("/api/repeat");
    expect(server.responses).toHaveLength(1);
    expect(server.responses[0]).not.toHaveProperty("count");
  });

  it("keeps a cross-origin response URL absolute", async () => {
    spyFetch({ body: "moved", url: "https://cdn.test/r", redirected: true });
    await fetchRecord("/api/moved");
    expect(server.responses[0].record.url).toBe("https://cdn.test/r");
  });

  it.each([404, 500, 503])("never records a %i answer", async (status) => {
    spyFetch({ status, body: "down" });
    await expect(fetchRecord("/api/flaky")).resolves.toMatchObject({ status });
    expect(server.responses).toEqual([]);
  });

  it.each<[string, Record<string, string>]>([
    ["Set-Cookie", { "set-cookie": "id=1" }],
    ["Cache-Control: private", { "cache-control": "private, max-age=60" }],
    ["Cache-Control: no-store", { "cache-control": "no-store" }],
    ["Vary: Cookie", { vary: "Accept-Encoding, Cookie" }],
    ["Vary: Authorization", { vary: "authorization" }],
    ["Vary: Accept-Language", { vary: "Accept-Language" }],
    ["Vary: *", { vary: "*" }],
  ])("never records a response with %s", async (_, headers) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(answer(headers));
    await expect(fetchRecord("/api/private")).resolves.toMatchObject({
      body: "body",
    });
    expect(server.responses).toEqual([]);
  });

  it("never records a request the client would not serve, or an excluded URL", async () => {
    server.exclude = (url) => url === `${ORIGIN}/api/live`;
    spyFetch({ body: "x" });
    await fetchRecord("/api/live");
    await fetchRecord("/api/post", { method: "POST" });
    await fetchRecord("https://elsewhere.test/api");
    await fetchRecord("/api/fresh", { cache: "no-store" });
    await fetchRecord(new Request(`${ORIGIN}/api/request`));
    await fetchRecord(
      new Request(`${ORIGIN}/api/request`, { method: "POST", body: "a" })
    );
    expect(server.responses).toEqual([]);
  });

  it("starts each server render with empty fetch caches", async () => {
    const fetchSpy = spyFetch({ body: "<p>page</p>" });
    await resolveTemplateContent("/tpl/per-render.html");
    await fetchPlainText("/text/per-render.txt");
    expect(server.responses.map(({ url }) => url)).toEqual([
      "/tpl/per-render.html",
      "/text/per-render.txt",
    ]);
    const next: ServerRender = { responses: [] };
    ssr(next);
    expect(templateIdentity("/tpl/per-render.html")).toBeNull();
    await resolveTemplateContent("/tpl/per-render.html");
    await fetchPlainText("/text/per-render.txt");
    expect(next.responses).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    // outside a server render the page keeps its caches
    ssr(undefined);
    await resolveTemplateContent("/tpl/per-render.html");
    await fetchPlainText("/text/per-render.txt");
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});

describe("hydration: stamped replacement", () => {
  const host = () =>
    fixture<HTMLElement>(
      `<div ${STAMP_ATTR}="#t1"><template ${TEMPLATE_ID_ATTR}="t1"><p>x</p></template><p id="server">x</p></div>`
    );
  const fresh = () => document.createElement("p");

  it("adopts a host the server rendered from the same source, every time", () => {
    boot();
    const el = host();
    const server = el.querySelector("#server");
    expect(hasServerContent(el)).toBe(true);
    expect(replaceNonTemplateChildren(el, [fresh()], { identity: "#t1" })).toBe(
      "adopted"
    );
    expect(replaceNonTemplateChildren(el, [fresh()], { identity: "#t1" })).toBe(
      "adopted"
    );
    expect(el.querySelector("#server")).toBe(server);
    expect(el.getAttribute(STAMP_ATTR)).toBe("#t1");
    // not a write: nothing for the loop guard to count
    expect(LoopGuard.depthOf(el, "content")).toBe(0);
  });

  it("replaces and drops n-tpl on another source, no source or a clear", () => {
    boot();
    const other = host();
    expect(
      replaceNonTemplateChildren(other, [fresh()], { identity: "#t2" })
    ).toBe(true);
    expect(other.hasAttribute(STAMP_ATTR)).toBe(false);
    expect(other.querySelector("#server")).toBeNull();
    const plain = host();
    expect(replaceNonTemplateChildren(plain, [fresh()])).toBe(true);
    expect(plain.hasAttribute(STAMP_ATTR)).toBe(false);
    const cleared = host();
    expect(replaceNonTemplateChildren(cleared, [], { identity: "#t1" })).toBe(
      true
    );
    expect(cleared.hasAttribute(STAMP_ATTR)).toBe(false);
  });

  it("replaces once the window is closed", () => {
    const el = host();
    expect(replaceNonTemplateChildren(el, [fresh()], { identity: "#t1" })).toBe(
      true
    );
    expect(el.hasAttribute(STAMP_ATTR)).toBe(false);
  });

  it("needs content besides templates and whitespace; text counts", () => {
    boot();
    const empty = fixture(
      `<div ${STAMP_ATTR}="#t1"><template></template>  </div>`
    );
    expect(hasServerContent(empty)).toBe(false);
    expect(canAdopt(empty, "#t1")).toBe(false);
    const text = fixture(`<div ${STAMP_ATTR}="html#a">Hello</div>`);
    expect(canAdopt(text, "html#a")).toBe(true);
    expect(canAdopt(text, null)).toBe(false);
    expect(canAdopt(text, undefined)).toBe(false);
  });

  it("renders a ShadowRoot host cold", () => {
    boot();
    const root = fixture(`<div></div>`).attachShadow({ mode: "open" });
    root.innerHTML = `<p>x</p>`;
    const node = fresh();
    expect(
      replaceNonTemplateChildren(root as unknown as Element, [node], {
        identity: "#t1",
      })
    ).toBe(true);
    expect(root.firstChild).toBe(node);
  });

  it("writes n-tpl on a server render and drops it on a later write", () => {
    ssr({ responses: [] });
    const el = fixture(`<div><template></template></div>`);
    replaceNonTemplateChildren(el, [fresh()], { identity: "/a.html#h" });
    expect(el.getAttribute(STAMP_ATTR)).toBe("/a.html#h");
    replaceNonTemplateChildren(el, [fresh()]);
    expect(el.hasAttribute(STAMP_ATTR)).toBe(false);
    replaceNonTemplateChildren(el, [fresh()], { identity: "/a.html#h" });
    replaceNonTemplateChildren(el, [], { identity: "/a.html#h" });
    expect(el.hasAttribute(STAMP_ATTR)).toBe(false);
  });

  it("leaves n-tpl alone when the loop guard drops the write", () => {
    ssr({ responses: [] });
    const el = fixture(`<div></div>`);
    LoopGuard.configure({ limit: 1, log: () => {} });
    try {
      LoopGuard.run(1, () =>
        expect(
          replaceNonTemplateChildren(el, [fresh()], { identity: "#t" })
        ).toBe(false)
      );
    } finally {
      LoopGuard.reset();
    }
    expect(el.hasAttribute(STAMP_ATTR)).toBe(false);
  });
});

describe("hydration: identities", () => {
  it("hashString is deterministic and spreads", () => {
    expect(hashString("")).toBe(hashString(""));
    expect(hashString("<p>a</p>")).not.toBe(hashString("<p>b</p>"));
    expect(hashString("é😀")).toMatch(/^[0-9a-z]+$/);
    expect(htmlIdentity("<b>x</b>")).toBe(`html#${hashString("<b>x</b>")}`);
  });

  it("names a URL template by its fetched text until its cache is cleared", async () => {
    ssr({ responses: [] });
    let body = `<p>v1</p>`;
    spyFetch(() => ({ body }));
    const url = "/tpl/identity.html";
    expect(templateIdentity(url)).toBeNull();
    await resolveTemplateContent(url);
    expect(templateIdentity(url)).toBe(`${url}#${hashString(body)}`);
    body = `<p>v2</p>`;
    await resolveTemplateContent(url, { bypassCache: true });
    expect(templateIdentity(url)).toBe(`${url}#${hashString(body)}`);
    clearFetchCaches(url);
    expect(templateIdentity(url)).toBeNull();
    await resolveTemplateContent(url);
    clearFetchCaches();
    expect(templateIdentity(url)).toBeNull();
  });

  it("hashes a fetched template only for a server render or the window", async () => {
    spyFetch({ body: `<p>x</p>` });
    await resolveTemplateContent("/tpl/cold.html");
    expect(templateIdentity("/tpl/cold.html")).toBeNull();
    boot();
    holdHydration(new Promise(() => {}));
    await resolveTemplateContent("/tpl/warm.html");
    expect(templateIdentity("/tpl/warm.html")).toBe(
      `/tpl/warm.html#${hashString("<p>x</p>")}`
    );
  });

  it("reads an in-document template's id on the client", () => {
    const scope = fixture(
      `<section><template ${TEMPLATE_ID_ATTR}="abc"><p>x</p></template><template class="bare"></template><div class="div"></div></section>`
    );
    expect(templateIdentity(":scope > template", { scope })).toBe("#abc");
    expect(templateIdentity(".bare")).toBeNull();
    expect(scope.querySelector(".bare")!.hasAttribute(TEMPLATE_ID_ATTR)).toBe(
      false
    );
    expect(templateIdentity(".div")).toBeNull();
    expect(templateIdentity("#missing")).toBeNull();
    expect(templateIdentity("[[invalid")).toBeNull();
  });

  it("assigns a missing template id on the server, from its source", () => {
    ssr({ responses: [] });
    const scope = fixture(
      `<section><template><p>x</p></template><template id="kept" ${TEMPLATE_ID_ATTR}="own"></template></section>`
    );
    const template = scope.querySelector("template")!;
    expect(templateIdentity(":scope > template", { scope })).toBe(
      `#${hashString(template.innerHTML)}`
    );
    expect(template.getAttribute(TEMPLATE_ID_ATTR)).toBe(
      hashString(template.innerHTML)
    );
    expect(templateIdentity("#kept")).toBe("#own");
  });
});

describe("hydration: scripts in fetched views", () => {
  const VIEW = `<section><script>run(1)</script><script type="module" src="/view.js"></script><template><script>run(2)</script></template></section>`;
  /** Every script below `root`, nested template contents included. */
  const scripts = (root: ParentNode): Element[] => [
    ...root.querySelectorAll("script"),
    ...[...root.querySelectorAll("template")].flatMap((template) =>
      scripts(template.content)
    ),
  ];
  const marked = (root: ParentNode) =>
    scripts(root).map((script) => script.hasAttribute(INERT_ATTR));

  it("a server render marks every script of a fetched view, in its clones too", async () => {
    ssr({ responses: [] });
    spyFetch({ body: VIEW });
    const view = (await resolveTemplateContent("/tpl/scripts.html")) as Element;
    expect(marked(view)).toEqual([true, true, true]);
    expect(marked(view.cloneNode(true) as Element)).toEqual([true, true, true]);
    expect(marked(document.importNode(view, true))).toEqual([true, true, true]);
  });

  it("marks nothing outside a server render", async () => {
    spyFetch({ body: VIEW });
    const view = (await resolveTemplateContent(
      "/tpl/scripts-cold.html"
    )) as Element;
    expect(marked(view)).toEqual([false, false, false]);
  });

  it("never marks an in-document template, whose scripts run when cloned", () => {
    ssr({ responses: [] });
    const template = fixture<HTMLTemplateElement>(
      `<template id="doc-view">${VIEW}</template>`
    );
    const view = resolveTemplateContent("#doc-view") as Element;
    expect(marked(view)).toEqual([false, false, false]);
    expect(marked(template.content)).toEqual([false, false, false]);
  });
});

describe("hydration: bundle copies", () => {
  it("two copies of the module share one window", async () => {
    vi.resetModules();
    const copy = await import("../../hydration");
    expect(copy.bootHydration).not.toBe(bootHydration);
    island({
      provisions: { p: "shared" },
      responses: [{ method: "GET", url: "/api/once", record: record() }],
    });
    copy.bootHydration();
    expect(isHydrating()).toBe(true);
    const el = fixture(`<copy-el ${SSR_ATTR}="p"></copy-el>`);
    expect(claimProvision(el)).toEqual({ value: "shared" });
    const fetchSpy = spyFetch({ body: "network" });
    expect((await copy.fetchRecord("/api/once")).body).toBe(record().body);
    expect((await fetchRecord("/api/once")).body).toBe("network");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resetHydration();
    expect(copy.isHydrating()).toBe(false);
  });
});
