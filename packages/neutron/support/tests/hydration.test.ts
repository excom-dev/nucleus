import { Neutron } from "../../src/neutron";
import {
  bootHydration,
  type FetchRecord,
  fetchRecord,
  HYDRATION_ISLAND_ID,
  type HydrationIsland,
  isHydrating,
  observeProperty,
  replaceNonTemplateChildren,
  resetHydration,
  SSR_ATTR,
  STAMP_ATTR,
  TEMPLATE_ID_ATTR,
  templateIdentity,
} from "@excom/kit-utils";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  vi,
  wait,
} from "@excom/nucleus-test";

let count = 0;
const uniqueTag = () => `hydration-el-${++count}`;

/** A prerendered page: `<html n-ssr>`, its island at the end of the body. */
const island = (data: Partial<HydrationIsland> = {}) => {
  document.documentElement.setAttribute(SSR_ATTR, "");
  return fixture(
    `<script type="application/json" id="${HYDRATION_ISLAND_ID}">${JSON.stringify(
      { v: 1, provisions: {}, responses: [], ...data }
    )}</script>`
  );
};

const boot = (data: Partial<HydrationIsland> = {}) => {
  island(data);
  bootHydration();
};

const record = (body: string): FetchRecord => ({
  url: "/api/deferred",
  status: 200,
  statusText: "OK",
  ok: true,
  redirected: false,
  type: "basic",
  headers: [["content-type", "text/plain"]],
  body,
});

/** A browser upgrades the element it already has (happy-dom replaces it). */
const upgradeInPlace = (
  element: HTMLElement,
  Internal: {
    CustomElement: { prototype: object };
    new (el: HTMLElement): unknown;
  }
) => {
  Object.setPrototypeOf(element, Internal.CustomElement.prototype);
  (element as unknown as { _n_: unknown })._n_ = new Internal(element);
};

/** Runs every timer due at the next instant: one macrotask of the window. */
const nextTask = () => vi.advanceTimersToNextTimerAsync();

const loading = () =>
  vi.spyOn(document, "readyState", "get").mockReturnValue("loading");

const parsed = (readyState: ReturnType<typeof loading>) => {
  readyState.mockReturnValue("interactive");
  document.dispatchEvent(new Event("DOMContentLoaded"));
};

afterEach(() => {
  resetHydration();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(SSR_ATTR);
});

describe("Hydration: provisions", () => {
  it("boots at define; an element upgraded by replacement claims its provision", () => {
    const tag = uniqueTag();
    fixture(`<${tag} ${SSR_ATTR}="r1"></${tag}>`);
    island({ provisions: { r1: { title: "Prerendered" } } });
    const provisioned = vi.fn();
    document.addEventListener("neutron-provision", provisioned);
    Neutron({ tag, props: { provision: Object } }).define();
    document.removeEventListener("neutron-provision", provisioned);
    const el = document.querySelector(tag) as HTMLElement & {
      provision: unknown;
    };
    expect(isHydrating()).toBe(true);
    expect(el.provision).toEqual({ title: "Prerendered" });
    expect(el.hasAttribute(SSR_ATTR)).toBe(false);
    expect(provisioned).toHaveBeenCalledTimes(1);
  });

  it("an element created after boot claims its provision at first connect", () => {
    const tag = uniqueTag();
    const provisionSet = vi.fn();
    Neutron({ tag, props: { provision: Object } })
      .onPropSet("provision", provisionSet)
      .define();
    boot({ provisions: { late: [1] } });
    const el = document.createElement(tag) as HTMLElement & {
      provision: unknown;
    };
    el.setAttribute(SSR_ATTR, "late");
    document.body.append(el);
    expect(el.provision).toEqual([1]);
    expect(el.hasAttribute(SSR_ATTR)).toBe(false);
    expect(provisionSet).toHaveBeenCalledTimes(1);
    const unknown = fixture<typeof el>(`<${tag} ${SSR_ATTR}="none"></${tag}>`);
    expect(unknown.provision).toBeNull();
    expect(unknown.hasAttribute(SSR_ATTR)).toBe(false);
  });
});

describe("Hydration: values set before an in-place upgrade", () => {
  it("survive the accessors; notifications wait for mount", () => {
    const tag = uniqueTag();
    const el = document.createElement(tag) as any;
    el.provision = { a: 1 };
    el.label = "pre";
    // internal flags are never adopted
    el.isMounted = true;
    const labelSet = vi.fn();
    const Internal = Neutron({
      tag,
      props: { provision: Object, label: String },
    }).onPropSet("label", labelSet);
    Internal.define();
    upgradeInPlace(el, Internal as any);
    expect(el.provision).toEqual({ a: 1 });
    expect(el.isMounted).toBe(false);
    // attribute-backed: set at first connect
    expect(el.hasAttribute("label")).toBe(false);
    const provisioned = vi.fn();
    el.addEventListener("neutron-provision", provisioned);
    document.body.append(el);
    expect(el.getAttribute("label")).toBe("pre");
    expect(el.label).toBe("pre");
    expect(labelSet).toHaveBeenCalledTimes(1);
    expect(provisioned).toHaveBeenCalledTimes(1);
  });

  it("include a value an observer wrapper holds, and the observer stays on", () => {
    const tag = uniqueTag();
    const el = document.createElement(tag) as any;
    const seen = vi.fn();
    // a sheet subscribed before boot; boot assigned the provision
    observeProperty(el, "provision", seen);
    el.provision = { from: "island" };
    const Internal = Neutron({ tag, props: { provision: Object } });
    Internal.define();
    upgradeInPlace(el, Internal as any);
    expect(el.provision).toEqual({ from: "island" });
    expect(seen).toHaveBeenLastCalledWith({ from: "island" }, null);
    document.body.append(el);
    el.provision = { next: true };
    expect(seen).toHaveBeenLastCalledWith({ next: true }, { from: "island" });
  });

  it("include a Promise, which settles once the element mounts", async () => {
    const tag = uniqueTag();
    const el = document.createElement(tag) as any;
    el.task = Promise.resolve("done");
    const resolved = vi.fn();
    const Internal = Neutron({
      tag,
      props: { task: Promise },
    }).onPromiseResolved("task", (_, result) => resolved(result.task));
    Internal.define();
    expect(() => upgradeInPlace(el, Internal as any)).not.toThrow();
    document.body.append(el);
    await wait(0);
    expect(resolved).toHaveBeenCalledWith("done");
  });

  it("lose to a write made after the upgrade", () => {
    const tag = uniqueTag();
    const el = document.createElement(tag) as any;
    el.isOpen = true;
    const Internal = Neutron({ tag, props: { isOpen: Boolean } });
    Internal.define();
    upgradeInPlace(el, Internal as any);
    el.isOpen = false;
    document.body.append(el);
    expect(el.isOpen).toBe(false);
    expect(el.hasAttribute("is-open")).toBe(false);
  });
});

describe("Hydration: deferred defaults", () => {
  const fetchLater = (setup: (results: Promise<FetchRecord>[]) => void) => {
    vi.useFakeTimers();
    const results: Promise<FetchRecord>[] = [];
    const fetchSpy = spyFetch({ body: "network" });
    boot({
      responses: [
        { method: "GET", url: "/api/deferred", record: record("served") },
      ],
    });
    // runs beside the window's first quiet task: what it defers lands after
    // the second, which closes an unheld window
    setTimeout(() => setup(results), 0);
    return { results, fetchSpy };
  };

  it("an event default runs inside the window it was scheduled in", async () => {
    const tag = uniqueTag();
    Neutron({ tag, props: {} })
      .onEventDefault(`${tag}-go`, () => {
        results.push(fetchRecord("/api/deferred"));
      })
      .define();
    const el = fixture(`<${tag}></${tag}>`);
    const { results, fetchSpy } = fetchLater(() =>
      el.dispatchEvent(new Event(`${tag}-go`))
    );
    await nextTask();
    await nextTask();
    expect(isHydrating()).toBe(true);
    expect((await results[0]).body).toBe("served");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a plain timer gets no such hold", async () => {
    const { results, fetchSpy } = fetchLater((results) =>
      setTimeout(() => results.push(fetchRecord("/api/deferred")), 0)
    );
    await nextTask();
    await nextTask();
    expect(isHydrating()).toBe(false);
    await vi.runAllTimersAsync();
    expect((await results[0]).body).toBe("network");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a host rendered at mount and again from a deferred update adopts both times", async () => {
    vi.useFakeTimers();
    const tag = uniqueTag();
    const renders: unknown[] = [];
    const render = (el: HTMLElement) =>
      renders.push(
        replaceNonTemplateChildren(el, [document.createElement("p")], {
          identity: templateIdentity(":scope > template", { scope: el }),
        })
      );
    // like `<spa-manager>`: the update is an event default awaiting renders
    Neutron({ tag, props: {} })
      .defineMethods({
        update: async (el: HTMLElement) => {
          await Promise.resolve();
          render(el);
        },
      })
      .onConnected((el) => {
        render(el as unknown as HTMLElement);
      })
      .onEventDefault(`${tag}-update`, () => ({ update: [] }))
      .define();
    boot();
    const el = fixture(
      `<${tag} ${STAMP_ATTR}="#t1"><template ${TEMPLATE_ID_ATTR}="t1"><p>x</p></template><p id="server">x</p></${tag}>`
    );
    const server = el.querySelector("#server");
    setTimeout(() => el.dispatchEvent(new Event(`${tag}-update`)), 0);
    await nextTask();
    await nextTask();
    expect(renders).toEqual(["adopted", "adopted"]);
    expect(el.querySelector("#server")).toBe(server);
  });
});

describe("Hydration: mount gate", () => {
  it("a prerendered page's elements mount once the island is parsed", () => {
    const tag = uniqueTag();
    Neutron({ tag, props: { provision: Object } }).define();
    document.documentElement.setAttribute(SSR_ATTR, "");
    const readyState = loading();
    const el = document.createElement(tag) as any;
    el.setAttribute(SSR_ATTR, "g1");
    const provisioned = vi.fn();
    el.addEventListener("neutron-provision", provisioned);
    document.body.append(el);
    const removed = document.createElement(tag) as any;
    document.body.append(removed);
    removed.remove();
    const moved = document.createElement(tag) as any;
    document.body.append(moved);
    document.body.prepend(moved);
    expect(el.isMounted).toBe(false);
    // the parser reaches the island, then the document is parsed
    island({ provisions: { g1: { ok: true } } });
    parsed(readyState);
    expect(isHydrating()).toBe(true);
    expect(el.isMounted).toBe(true);
    expect(el.provision).toEqual({ ok: true });
    expect(provisioned).toHaveBeenCalledTimes(1);
    expect(moved.isMounted).toBe(true);
    expect(removed.isMounted).toBe(false);
    expect(removed.wasMounted).toBe(false);
  });

  it("other pages mount while loading", () => {
    const tag = uniqueTag();
    Neutron({ tag, props: {} }).define();
    loading();
    const el = fixture<any>(`<${tag}></${tag}>`);
    expect(el.isMounted).toBe(true);
  });

  it("a move while the page is loading keeps a mounted element mounted", async () => {
    const tag = uniqueTag();
    Neutron({ tag, props: {} }).define();
    const el = fixture<any>(`<${tag}></${tag}>`);
    document.documentElement.setAttribute(SSR_ATTR, "");
    loading();
    document.body.prepend(el);
    await Promise.resolve();
    expect(el.isMounted).toBe(true);
  });

  /** Two gated elements, the first one's first mount throwing. */
  const gateTwo = () => {
    const failing = uniqueTag();
    const tag = uniqueTag();
    Neutron({ tag: failing, props: {} })
      .onConnected(() => {
        throw new Error("mount failed");
      })
      .define();
    Neutron({ tag, props: {} }).define();
    document.documentElement.setAttribute(SSR_ATTR, "");
    const readyState = loading();
    document.body.append(document.createElement(failing));
    const el = document.body.appendChild(document.createElement(tag)) as any;
    island();
    return { el, readyState };
  };

  it("one mount, or the boot, that throws keeps the others mounting", () => {
    const reported = vi.fn();
    vi.stubGlobal("reportError", reported);
    const { el, readyState } = gateTwo();
    expect(el.isMounted).toBe(false);
    vi.spyOn(document.documentElement, "hasAttribute").mockImplementationOnce(
      () => {
        throw new Error("boot failed");
      }
    );
    parsed(readyState);
    expect(el.isMounted).toBe(true);
    expect(reported.mock.calls.map(([error]) => error.message)).toEqual([
      "boot failed",
      "mount failed",
    ]);
  });

  it("logs the error where reportError is missing", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { el, readyState } = gateTwo();
    parsed(readyState);
    expect(el.isMounted).toBe(true);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ message: "mount failed" })
    );
  });
});
