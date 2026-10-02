import { FetchableElement } from "../../index";
import { KitLogger } from "@excom/kit-logger";
import {
  bootHydration,
  type FetchRecord,
  holdHydration,
  HYDRATION_ISLAND_ID,
  type HydrationIsland,
  resetHydration,
  SSR_ATTR,
} from "@excom/kit-utils";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  vi,
  waitForEvent,
} from "@excom/nucleus-test";

const TAG = "fetchable-hydration-test";
if (!customElements.get(TAG)) {
  FetchableElement.define(TAG);
}

// Lifecycle events use the base's config tag (`noop-tag`), not the defined tag.
const EVT = (name: string) => `noop-tag-${name}`;

const URL_PATH = "/api/items?page=2";
const ABSOLUTE = `${location.origin}${URL_PATH}`;

const record = (fields: Partial<FetchRecord> = {}): FetchRecord => ({
  url: URL_PATH,
  status: 200,
  statusText: "OK",
  ok: true,
  redirected: false,
  type: "basic",
  headers: [["content-type", "application/json; charset=utf-8"]],
  body: `{"items":[1,2]}`,
  ...fields,
});

/** A prerendered page whose window stays open: the stubbed network answers a task later. */
const bootWith = (responses: HydrationIsland["responses"]) => {
  document.documentElement.setAttribute(SSR_ATTR, "");
  fixture(
    `<script type="application/json" id="${HYDRATION_ISLAND_ID}">${JSON.stringify(
      { v: 1, provisions: {}, responses }
    )}</script>`
  );
  bootHydration();
  holdHydration(new Promise(() => {}));
};

const load = (el: any) =>
  el.doFetch([ABSOLUTE, { method: "GET", headers: { Accept: "*/*" } }]);

describe("FetchableElement hydration", () => {
  afterEach(() => {
    resetHydration();
    document.body.innerHTML = "";
    document.documentElement.removeAttribute(SSR_ATTR);
    vi.restoreAllMocks();
    KitLogger.unsuppress();
  });

  it("takes a recorded response: the events and provision of a cold load", async () => {
    bootWith([{ method: "GET", url: URL_PATH, record: record() }]);
    const fetchSpy = spyFetch({ body: "network" });
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    const events: string[] = [];
    for (const name of ["loading", "success"]) {
      el.addEventListener(EVT(name), () => events.push(name));
    }
    await waitForEvent(el, EVT("success"), () => load(el));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events).toEqual(["loading", "success"]);
    const served = el.provision;
    expect(served.body).toEqual({ items: [1, 2] });

    resetHydration();
    spyFetch({
      body: record().body,
      headers: new Headers(record().headers),
      url: ABSOLUTE,
    });
    await waitForEvent(el, EVT("success"), () => load(el));
    expect(served).toEqual(el.provision);
  });

  it("keeps a recorded text body as text", async () => {
    bootWith([
      {
        method: "GET",
        url: URL_PATH,
        record: record({
          headers: [["Content-Type", "text/plain"]],
          body: "hi",
        }),
      },
    ]);
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    await waitForEvent(el, EVT("success"), () => load(el));
    expect(el.provision.body).toBe("hi");
  });

  it("errors on a recorded error status, as on a cold load", async () => {
    KitLogger.suppress();
    bootWith([
      {
        method: "GET",
        url: URL_PATH,
        record: record({
          status: 404,
          statusText: "Not Found",
          ok: false,
          body: `{"reason":"gone"}`,
        }),
      },
    ]);
    const el = fixture<any>(`<${TAG}></${TAG}>`);
    await waitForEvent(el, EVT("error"), () => load(el));
    expect(el).dom.to.equalTag(`<${TAG} is-error></${TAG}>`);
    expect(el.provision.status).toBe(404);
    expect(el.provision.body).toEqual({ reason: "gone" });
  });
});
