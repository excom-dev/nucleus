import { FetchableElement } from "../../index";
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

const TAG = "fetchable-lifecycle-test";
if (!customElements.get(TAG)) {
  FetchableElement.define(TAG);
}

// Lifecycle events use the base's config tag (`noop-tag`), not the defined tag.
const EVT = (name: string) => `noop-tag-${name}`;

const abortError = () =>
  new DOMException("The operation was aborted.", "AbortError");

/** A fetch stub that only settles when its signal aborts (rejects `AbortError`). */
const spyAbortableFetch = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError()));
      }),
  );

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("FetchableElement fetch lifecycle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    KitLogger.unsuppress();
  });

  it("emits loading, then success with the parsed JSON provision", async () => {
    spyFetch({ body: JSON.stringify({ ok: 1 }) });
    const el = fixture<any>(`<${TAG}></${TAG}>`);

    const loading = waitForEvent(el, EVT("loading"));
    const provisioned = waitForEvent(el, "neutron-provision");
    let successDetail: any;
    el.addEventListener(EVT("success"), (e: CustomEvent) => {
      successDetail = e.detail;
    });

    await waitForEvent(el, EVT("success"), () => {
      el.doFetch(["/api/json-ok", { method: "GET" }]);
    });
    await loading;
    await provisioned;

    expect(el).dom.to.equalTag(`<${TAG} is-success></${TAG}>`);
    expect(el.isLoading).toBe(false);
    expect(el.fetchPromise).toBeNull();
    expect(el.provision.status).toBe(200);
    expect(el.provision.ok).toBe(true);
    expect(el.provision.body).toEqual({ ok: 1 });
    expect(el.provision.headers).toEqual(
      expect.arrayContaining([["content-type", "application/json"]]),
    );
    expect(successDetail).toBe(el.provision);
  });

  it("reads the body as text when the response is not JSON", async () => {
    spyFetch({
      body: "plain text",
      headers: new Headers({ "content-type": "text/plain" }),
    });
    const el = fixture<any>(`<${TAG}></${TAG}>`);

    await waitForEvent(el, EVT("success"), () => {
      el.doFetch(["/api/text", {}]);
    });

    expect(el.provision.body).toBe("plain text");
  });

  it("reads the body as text when the response has no content-type", async () => {
    spyFetch({ body: "untyped", headers: new Headers() });
    const el = fixture<any>(`<${TAG}></${TAG}>`);

    await waitForEvent(el, EVT("success"), () => {
      el.doFetch(["/api/untyped", {}]);
    });

    expect(el.provision.body).toBe("untyped");
  });

  it("sets is-loading while the request is in flight", () => {
    spyAbortableFetch();
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    el.doFetch(["/api/slow", {}]);
    expect(el).dom.to.equalTag(`<${TAG} is-loading></${TAG}>`);
    expect(el.fetchPromise).toBeInstanceOf(Promise);
  });

  it("emits error with the response payload on a non-2xx status", async () => {
    KitLogger.suppress();
    spyFetch({ status: 500, body: JSON.stringify({ reason: "boom" }) });
    const el = fixture<any>(`<${TAG}></${TAG}>`);

    let errorDetail: any;
    el.addEventListener(EVT("error"), (e: CustomEvent) => {
      errorDetail = e.detail;
    });

    await waitForEvent(el, EVT("error"), () => {
      el.doFetch(["/api/server-error", {}]);
    });

    expect(el).dom.to.equalTag(`<${TAG} is-error></${TAG}>`);
    expect(el.isLoading).toBe(false);
    expect(el.fetchPromise).toBeNull();
    expect(el.provision.status).toBe(500);
    expect(el.provision.ok).toBe(false);
    expect(el.provision.body).toEqual({ reason: "boom" });
    expect(errorDetail).toBe(el.provision);
  });

  it("emits error with { message, stack } when fetch itself throws", async () => {
    KitLogger.suppress();
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const el = fixture<any>(`<${TAG}></${TAG}>`);

    await waitForEvent(el, EVT("error"), () => {
      el.doFetch(["/api/network-down", {}]);
    });

    expect(el).dom.to.equalTag(`<${TAG} is-error></${TAG}>`);
    expect(el.provision.message).toBe("Failed to fetch");
    expect(el.provision.stack).toBeDefined();
  });

  it("cancelling an in-flight request clears state without an error event", async () => {
    spyAbortableFetch();
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const onError = vi.fn();
    const onSuccess = vi.fn();
    el.addEventListener(EVT("error"), onError);
    el.addEventListener(EVT("success"), onSuccess);

    el.doFetch(["/api/cancel-me", {}]);
    const { signal } = el.abortController;
    expect(el.isLoading).toBe(true);

    el.setCanceledState();
    await wait(10);

    expect(signal.aborted).toBe(true);
    expect(el).dom.to.equalTag(`<${TAG}></${TAG}>`);
    expect(el.fetchPromise).toBeNull();
    expect(el.provision).toBeFalsy();
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("a replacing request aborts the first and resolves with the second response", async () => {
    let nthCall = 0;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init) => {
        nthCall++;
        if (nthCall === 1) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(abortError()),
            );
          });
        }
        return Promise.resolve(jsonResponse({ call: nthCall }));
      });
    const el = fixture<any>(`<${TAG}></${TAG}>`);

    el.doFetch(["/api/first", {}]);
    const firstSignal = el.abortController.signal;

    await waitForEvent(el, EVT("success"), () => {
      el.doFetch(["/api/second", {}]);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(firstSignal.aborted).toBe(true);
    expect(el.provision.body).toEqual({ call: 2 });
    expect(el).dom.to.equalTag(`<${TAG} is-success></${TAG}>`);
  });

  it("aborts the in-flight request when disconnected", async () => {
    spyAbortableFetch();
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const onError = vi.fn();
    el.addEventListener(EVT("error"), onError);

    el.doFetch(["/api/disconnect", {}]);
    const { signal } = el.abortController;
    expect(el.isLoading).toBe(true);

    el.remove();
    await wait(10);

    expect(signal.aborted).toBe(true);
    expect(el.fetchPromise).toBeNull();
    expect(el.isLoading).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("serialises the body and forwards method, headers and signal to fetch", async () => {
    const fetchSpy = spyFetch({ body: JSON.stringify({ saved: true }) });
    const el = fixture<any>(`<${TAG}></${TAG}>`);

    await waitForEvent(el, EVT("success"), () => {
      el.doFetch([
        "/api/items",
        {
          method: "POST",
          body: { name: "widget" } as unknown as BodyInit,
          headers: { "X-Test": "1" },
        },
      ]);
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/items");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "widget" }));
    expect(init.headers).toEqual({ "X-Test": "1" });
    expect(init.signal).toBeDefined();
    expect(init.signal!.aborted).toBe(false);
  });

  it("sends no body when the request init has none", async () => {
    const fetchSpy = spyFetch({ body: "{}" });
    const el = fixture<any>(`<${TAG}></${TAG}>`);

    await waitForEvent(el, EVT("success"), () => {
      el.doFetch(["/api/no-body", { method: "GET" }]);
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });
});

describe("FetchableElement getFetchArgs", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("defaults api-url to an empty string resolved against the origin", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(el.apiUrl).toBe("");
    const [url] = el.getFetchArgs();
    expect(url).toBe(new URL("", window.location.origin).toString());
  });

  it("custom fetch args take priority over attributes", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/base" api-method="get"></${TAG}>`,
    );
    const [url, init] = el.getFetchArgs([
      "/api/custom",
      { method: "post", headers: { "X-Custom": "1" } },
    ]);
    expect(url).toContain("/api/custom");
    expect(url).not.toContain("/api/base");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Custom"]).toBe("1");
    expect(init.headers.Accept).toBe("application/json");
    expect(init.body).toBeDefined();
  });

  it("custom init without a url keeps the attribute url", () => {
    const el = fixture<any>(`<${TAG} api-url="/api/base"></${TAG}>`);
    const [url, init] = el.getFetchArgs([undefined, { redirect: "error" }]);
    expect(url).toContain("/api/base");
    expect(init.redirect).toBe("error");
  });

  it("keeps a body supplied through custom fetch args", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" form-ref=":scope form">
        <form><input name="ignored" value="1" /></form>
      </${TAG}>`,
    );
    const [, init] = el.getFetchArgs([
      undefined,
      { method: "post", body: "raw-body" },
    ]);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("raw-body");
  });

  it("an empty api-method sends no body", () => {
    const el = fixture<any>(`<${TAG} api-url="/api/items"></${TAG}>`);
    el.apiMethod = "";
    const [, init] = el.getFetchArgs();
    expect(init.method).toBe("");
    expect(init.body).toBeUndefined();
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("has-body forces a body (and Content-Type) on a GET request", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" has-body form-ref=":scope form">
        <form><input name="q" value="1" /></form>
      </${TAG}>`,
    );
    const [url, init] = el.getFetchArgs();
    expect(init.method).toBe("GET");
    expect(init.body).toEqual({ q: "1" });
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(url).not.toContain("q=1");
  });

  it("merges the payload into query params when there is no body", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" form-ref=":scope form">
        <form><input name="q" value="1" /><input name="page" value="2" /></form>
      </${TAG}>`,
    );
    const [url, init] = el.getFetchArgs();
    expect(url).toContain("q=1");
    expect(url).toContain("page=2");
    expect(init.body).toBeUndefined();
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("drops headers and credentials that are cleared to empty strings", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" api-method="post"></${TAG}>`,
    );
    el.headerAccept = "";
    el.headerContentType = "";
    el.fetchCredentials = "";
    const [, init] = el.getFetchArgs();
    expect(init.method).toBe("POST");
    expect(init.headers.Accept).toBeUndefined();
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.credentials).toBeUndefined();
  });

  it("passes fetch-redirect and a custom Content-Type through", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" api-method="put" fetch-redirect="manual" header-content-type="text/plain"></${TAG}>`,
    );
    const [, init] = el.getFetchArgs();
    expect(init.redirect).toBe("manual");
    expect(init.headers["Content-Type"]).toBe("text/plain");
  });

  it("sources action, method, enctype and fields from an external form-ref", () => {
    document.body.innerHTML = `
      <form id="ext-form" action="/api/from-form" method="post" enctype="multipart/form-data">
        <input name="title" value="hello" />
      </form>
      <${TAG} api-url="/api/ignored" form-ref="#ext-form"></${TAG}>
    `;
    const el = document.querySelector(TAG) as any;
    expect(el.getFormElement()).toBe(document.getElementById("ext-form"));

    const [url, init] = el.getFetchArgs();
    expect(url).toContain("/api/from-form");
    expect(url).not.toContain("/api/ignored");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("multipart/form-data");
    expect(init.body).toEqual({ title: "hello" });
  });

  it("falls back to attribute url and method when the form has neither", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/attr" api-method="patch" form-ref=":scope form">
        <form><input name="a" value="b" /></form>
      </${TAG}>`,
    );
    const [url, init] = el.getFetchArgs();
    expect(url).toContain("/api/attr");
    expect(init.method).toBe("PATCH");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toEqual({ a: "b" });
  });

  it("getFormElement returns null when the form-ref selector matches nothing", () => {
    const el = fixture<any>(`<${TAG} form-ref="#no-such-form"></${TAG}>`);
    expect(el.getFormElement()).toBeNull();
  });
});
