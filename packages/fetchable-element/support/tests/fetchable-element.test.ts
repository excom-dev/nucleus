import { FetchableElement } from "../../index";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { KitLogger } from "@excom/kit-logger";

const TAG = "fetchable-element-test";
if (!customElements.get(TAG)) {
  FetchableElement.define(TAG);
}

describe("FetchableElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("defines a custom element tag", () => {
    expect(customElements.get(TAG)).toBeTruthy();
  });

  it("starts with default state", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(el).dom.to.equalTag(`<${TAG}></${TAG}>`);
    expect(el.provision).toBeFalsy();
  });

  it("has default header values", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(el.headerAccept).toBe("application/json");
    expect(el.headerContentType).toBe("application/json");
  });

  it("sets loading state", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );
    el.setLoadingState("http://localhost/api", {});
    expect(el).dom.to.equalTag(`<${TAG} is-loading></${TAG}>`);
  });

  it("sets success state", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const data = { status: 200, body: { result: "ok" } };
    el.setSuccessState(data);
    expect(el).dom.to.equalTag(`<${TAG} is-success></${TAG}>`);
    expect(el.provision).toEqual(data);
  });

  it("sets error state", () => {
    KitLogger.suppress();
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const errorData = { status: 500, message: "Server error" };
    el.setErrorState(errorData);
    expect(el).dom.to.equalTag(`<${TAG} is-error></${TAG}>`);
    expect(el.provision).toEqual(errorData);
    KitLogger.unsuppress();
  });

  it("setCanceledState resets state when fetch is active", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    el.fetchPromise = Promise.resolve();
    el.setCanceledState();
    expect(el).dom.to.equalTag(`<${TAG}></${TAG}>`);
  });

  it("setCanceledState is a no-op when no active fetch", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const result = el.setCanceledState();
    expect(result).toBeFalsy();
  });

  it("aborts fetch when new fetch is started", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );
    el.setLoadingState("http://localhost/api/first", {});
    const firstSignal = el.abortController.signal;
    el.doFetch(["http://localhost/api/second", {}]);
    expect(firstSignal.aborted).toBe(true);
    expect(el.abortController.signal.aborted).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("getFormElement returns null when no formRef", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    expect(el.getFormElement()).toBeNull();
  });

  it("getFormElement finds child form with default selector", () => {
    const el = fixture<any>(
      `<${TAG} form-ref=":scope form"><form></form></${TAG}>`,
    );
    const form = el.getFormElement();
    expect(form).toBeInstanceOf(HTMLFormElement);
  });

  it("getFetchArgs builds correct GET request", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" api-method="get"></${TAG}>`,
    );
    expect(el).dom.to.equalTag(
      `<${TAG} api-url="/api/items" api-method="get"></${TAG}>`,
    );
    const args = el.getFetchArgs();
    expect(args).toHaveLength(2);
    expect(args[1].method).toBe("GET");
    expect(args[1].headers.Accept).toBe("application/json");
    expect(args[1].credentials).toBe("include");
    expect(args[1].headers["Content-Type"]).toBeUndefined();
  });

  it("getFetchArgs builds correct POST request with body", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" api-method="post" form-ref=":scope form">
        <form><input name="name" value="test" /></form>
      </${TAG}>`,
    );
    const args = el.getFetchArgs();
    expect(args[1].method).toBe("POST");
    expect(args[1].headers["Content-Type"]).toBe("application/json");
    expect(args[1].body).toBeDefined();
  });

  it("getFetchArgs uses PUT as body-carrying method", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" api-method="put"></${TAG}>`,
    );
    const args = el.getFetchArgs();
    expect(args[1].method).toBe("PUT");
    expect(args[1].headers["Content-Type"]).toBe("application/json");
  });

  it("getFetchArgs uses PATCH as body-carrying method", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" api-method="patch"></${TAG}>`,
    );
    const args = el.getFetchArgs();
    expect(args[1].method).toBe("PATCH");
    expect(args[1].headers["Content-Type"]).toBe("application/json");
  });

  it("getFetchArgs respects custom headers", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" header-accept="text/html" header-cache-control="no-cache"></${TAG}>`,
    );
    const args = el.getFetchArgs();
    expect(args[1].headers.Accept).toBe("text/html");
    expect(args[1].headers["Cache-Control"]).toBe("no-cache");
  });

  it("getFetchArgs respects custom credentials", () => {
    const el = fixture<any>(
      `<${TAG} api-url="/api/items" fetch-credentials="same-origin"></${TAG}>`,
    );
    const args = el.getFetchArgs();
    expect(args[1].credentials).toBe("same-origin");
  });

  it("getFetchArgs defaults to GET method", () => {
    const el = fixture<any>(`<${TAG} api-url="/api/items"></${TAG}>`);
    const args = el.getFetchArgs();
    expect(args[1].method).toBe("GET");
  });

  it("getFetchArgs defaults credentials to include", () => {
    const el = fixture<any>(`<${TAG} api-url="/api/items"></${TAG}>`);
    const args = el.getFetchArgs();
    expect(args[1].credentials).toBe("include");
  });

  it("doFetch rejects when no fetch args provided", () => {
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const result = el.doFetch([]);
    expect(result).toBeFalsy();
  });
});
