/**
 * The progressive entry: nothing registered up front, each package imported
 * the first time one of its tags appears in the document.
 */
import {
  loadElement,
  observeElements,
  PROGRESSIVE_LOADERS,
  PROGRESSIVE_TAGS,
} from "../../nucleus-kit.progressive";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const settle = async () => {
  await wait(0);
  await wait(0);
};

describe("nucleus-kit progressive entry", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("covers every tag Nucleus Kit defines", () => {
    expect([...PROGRESSIVE_TAGS].sort()).toEqual(
      [
        "content-carousel",
        "content-carousel-slide",
        "content-drawer",
        "content-tabs",
        "content-tabs-body",
        "content-tabs-header",
        "data-table",
        "data-th",
        "detect-browser",
        "detect-features",
        "detect-media",
        "dialog-anchor",
        "dismiss-watcher",
        "dom-observer",
        "event-handler",
        "gesture-handler",
        "include-content",
        "network-status",
        "provider-fetch",
        "provider-geolocation",
        "provider-orientation",
        "provider-storage",
        "quark-sheet",
        "scroll-into-view",
        "service-worker",
        "spa-a",
        "spa-manager",
        "spa-route",
        "super-form",
        "super-input",
        "web-authn",
      ].sort()
    );
    // sub-adapters share their parent's loader so a family is one import
    expect(PROGRESSIVE_LOADERS["content-tabs-header"]).toBe(PROGRESSIVE_LOADERS["content-tabs"]);
    expect(PROGRESSIVE_LOADERS["spa-a"]).toBe(PROGRESSIVE_LOADERS["spa-route"]);
  });

  it("defines every tag it maps", async () => {
    await Promise.all(PROGRESSIVE_TAGS.map((tag) => loadElement(tag)));
    for (const tag of PROGRESSIVE_TAGS) {
      expect(customElements.get(tag), tag).toBeDefined();
    }
  });

  it("loads a package once on demand and defines its elements", async () => {
    const first = loadElement("content-drawer");
    expect(loadElement("content-drawer")).toBe(first);
    await first;
    expect(customElements.get("content-drawer")).toBeDefined();
    expect(loadElement("not-a-kit-tag")).toBeUndefined();
  });

  it("loads elements inserted into the document, including nested ones", async () => {
    document.body.innerHTML = `<div>text <section><super-form></super-form></section></div>`;
    document.body.appendChild(document.createTextNode("loose text"));
    await settle();
    await loadElement("super-form");
    expect(customElements.get("super-form")).toBeDefined();

    const el = document.createElement("dialog-anchor");
    document.body.appendChild(el);
    await settle();
    await loadElement("dialog-anchor");
    expect(customElements.get("dialog-anchor")).toBeDefined();
  });

  it("observes a shadow root on request and stops when disposed", async () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<network-status></network-status>`;
    document.body.appendChild(host);
    const stop = observeElements(shadow);
    await loadElement("network-status");
    expect(customElements.get("network-status")).toBeDefined();
    stop();
    const spy = vi.spyOn(PROGRESSIVE_LOADERS as Record<string, () => Promise<unknown>>, "scroll-into-view");
    shadow.appendChild(document.createElement("scroll-into-view"));
    await settle();
    expect(spy).not.toHaveBeenCalled();
  });

  it("logs a failed import and retries on the next call", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let attempts = 0;
    (PROGRESSIVE_LOADERS as Record<string, () => Promise<unknown>>)["x-broken"] = () => {
      attempts++;
      return attempts === 1 ? Promise.reject(new Error("nope")) : Promise.resolve("ok");
    };
    await expect(loadElement("x-broken")).rejects.toThrow("nope");
    expect(error).toHaveBeenCalledWith("[nucleus-kit] failed to load <x-broken>", expect.any(Error));
    await expect(loadElement("x-broken")).resolves.toBe("ok");
    expect(attempts).toBe(2);
    delete (PROGRESSIVE_LOADERS as Record<string, unknown>)["x-broken"];
  });
});

type Loader = () => Promise<unknown>;
type Entry = typeof import("../../nucleus-kit.progressive");

// not `new URL(…, import.meta.url)`: Vite rewrites that into an asset URL
const ENTRY_URL = import.meta.url.replace(/support\/tests\/[^/]+$/, "nucleus-kit.progressive.ts");

/**
 * A fresh entry (re-reads the opt-in at import) with every package loader
 * swapped for one spy per package, so nothing is really fetched.
 */
const freshEntry = async () => {
  vi.resetModules();
  const entry: Entry = await import("../../nucleus-kit.progressive");
  const loaders = entry.PROGRESSIVE_LOADERS as Record<string, Loader>;
  const spies = new Map<Loader, ReturnType<typeof vi.fn<Loader>>>();
  for (const tag of entry.PROGRESSIVE_TAGS) {
    if (!spies.has(loaders[tag])) spies.set(loaders[tag], vi.fn<Loader>(() => Promise.resolve()));
    loaders[tag] = spies.get(loaders[tag])!;
  }
  const spy = (tag: string) => loaders[tag] as ReturnType<typeof vi.fn<Loader>>;
  /** Imported packages, each as its first tag. */
  const loadedTags = () =>
    entry.PROGRESSIVE_TAGS.filter(
      (tag, i, tags) =>
        tags.findIndex((other) => loaders[other] === loaders[tag]) === i && spy(tag).mock.calls.length > 0,
    );
  return { entry, spy, loadedTags, packageCount: spies.size };
};

describe("nucleus-kit progressive idle loading", () => {
  const idleQueue: IdleRequestCallback[] = [];
  const stubIdle = () =>
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: IdleRequestCallback) => idleQueue.push(callback)),
    );
  /** Run the next pending idle callback once the sweep has asked for it. */
  const runIdle = async () => {
    await vi.waitFor(() => expect(idleQueue.length).toBe(1));
    idleQueue.shift()!({ didTimeout: false, timeRemaining: () => 50 });
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    idleQueue.length = 0;
    document.body.removeAttribute("nucleus-kit-idle");
    document.head.querySelectorAll("script").forEach((script) => script.remove());
    document.body.innerHTML = "";
    delete (navigator as { connection?: unknown }).connection;
  });

  it("loads nothing when not opted in", async () => {
    const { loadedTags } = await freshEntry();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(loadedTags()).toEqual([]);
  });

  it("<body nucleus-kit-idle> loads every package, one per idle period", async () => {
    document.body.setAttribute("nucleus-kit-idle", "");
    const { loadedTags, packageCount } = await freshEntry();
    expect(loadedTags()).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(loadedTags()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(loadedTags()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100 * packageCount);
    expect(loadedTags()).toHaveLength(packageCount);
  });

  it("loads only the listed tags; a family is one package", async () => {
    document.body.setAttribute("nucleus-kit-idle", " content-drawer\n content-tabs  content-tabs-body ");
    const { loadedTags, spy } = await freshEntry();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(loadedTags()).toEqual(["content-drawer", "content-tabs"]);
    expect(spy("content-tabs")).toHaveBeenCalledTimes(1);
  });

  it("warns about unknown tags and loads the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.setAttribute("nucleus-kit-idle", "x-nope data-table");
    const { loadedTags } = await freshEntry();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("[nucleus-kit] unknown idle tag <x-nope>");
    expect(loadedTags()).toEqual(["data-table"]);
  });

  it("reads data-idle from its own <script>, before the body attribute", async () => {
    document.body.setAttribute("nucleus-kit-idle", "data-table");
    document.head.insertAdjacentHTML(
      "beforeend",
      `<script type="x-test" src="/other.js" data-idle="super-form"></script>` +
        `<script type="x-test" src="${ENTRY_URL}" data-idle="content-drawer"></script>`,
    );
    const { loadedTags } = await freshEntry();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(loadedTags()).toEqual(["content-drawer"]);
  });

  it("waits for the page load event", async () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    document.body.setAttribute("nucleus-kit-idle", "content-drawer");
    const { loadedTags } = await freshEntry();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(loadedTags()).toEqual([]);
    window.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(100);
    expect(loadedTags()).toEqual(["content-drawer"]);
  });

  it("does nothing in data-saver mode", async () => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
    document.body.setAttribute("nucleus-kit-idle", "");
    const { loadedTags } = await freshEntry();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(loadedTags()).toEqual([]);
  });

  it("uses requestIdleCallback: next package only after the previous one evaluated", async () => {
    stubIdle();
    const { entry, spy } = await freshEntry();
    let evaluate!: (value: unknown) => void;
    spy("content-drawer").mockImplementation(() => new Promise((resolve) => (evaluate = resolve)));
    const done = entry.idleLoadElements(["content-drawer", "data-table"]);
    await runIdle();
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 });
    expect(spy("content-drawer")).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(idleQueue).toHaveLength(0);
    expect(spy("data-table")).not.toHaveBeenCalled();
    evaluate(undefined);
    await runIdle();
    await done;
    expect(spy("data-table")).toHaveBeenCalledOnce();
  });

  it("skips packages the observer already loaded", async () => {
    stubIdle();
    const { entry, spy } = await freshEntry();
    document.body.innerHTML = `<content-drawer></content-drawer>`;
    await vi.waitFor(() => expect(spy("content-drawer")).toHaveBeenCalledOnce());
    const done = entry.idleLoadElements(["content-drawer", "data-table"]);
    await runIdle();
    await done;
    expect(requestIdleCallback).toHaveBeenCalledOnce();
    expect(spy("content-drawer")).toHaveBeenCalledOnce();
    expect(spy("data-table")).toHaveBeenCalledOnce();
  });

  it("does not reload a package when its tag appears after the sweep", async () => {
    const { entry, spy } = await freshEntry();
    await Promise.all([entry.idleLoadElements(["super-form"]), vi.advanceTimersByTimeAsync(100)]);
    document.body.innerHTML = `<super-form></super-form>`;
    await vi.advanceTimersByTimeAsync(100);
    expect(spy("super-form")).toHaveBeenCalledOnce();
  });

  it("keeps going after a failed import", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { entry, spy } = await freshEntry();
    spy("content-drawer").mockRejectedValueOnce(new Error("offline"));
    await Promise.all([
      entry.idleLoadElements(["content-drawer", "data-table"]),
      vi.advanceTimersByTimeAsync(200),
    ]);
    expect(spy("data-table")).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith("[nucleus-kit] failed to load <content-drawer>", expect.any(Error));
  });
});
