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
