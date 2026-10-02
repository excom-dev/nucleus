/**
 * The progressive entry on a prerendered page: it opens the hydration window
 * itself and holds it until the packages for the tags found at startup are
 * imported, so those elements still upgrade inside it. Later loads are not
 * held. On a page that is not prerendered it changes nothing.
 */
import {
  bootHydration,
  isHydrating,
  resetHydration,
  SSR_ATTR,
} from "@excom/kit-utils";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/nucleus-test";

type Entry = typeof import("../../nucleus-kit.progressive");

const ISLAND = `<script type="application/json" id="nucleus-hydration">{"v":1,"provisions":{},"responses":[]}</script>`;

const stubbed: string[] = [];
const observers: MutationObserver[] = [];

/**
 * Package `name` imported by hand: its import stays pending until `settle()`
 * (`settle(error)` fails it). `started()` waits for the one import attempt.
 */
const stubPackage = (name: string) => {
  const gate = Promise.withResolvers<void>();
  gate.promise.catch(() => {});
  const imports = vi.fn(() => gate.promise.then(() => ({})));
  vi.doMock(name, imports);
  stubbed.push(name);
  return {
    started: () => vi.waitFor(() => expect(imports).toHaveBeenCalledOnce()),
    settle: (error?: Error) => (error ? gate.reject(error) : gate.resolve()),
  };
};

/** A prerendered document: `<html>` stamped, `body` then the island. */
const prerendered = (body: string) => {
  document.documentElement.setAttribute(SSR_ATTR, "");
  document.body.innerHTML = body + ISLAND;
};

/** A fresh entry, as a page load starts it. */
const enter = (): Promise<Entry> => {
  vi.resetModules();
  return import("../../nucleus-kit.progressive");
};

/** The window is open at every one of `ticks` macrotasks. */
const staysOpen = async (ticks = 5) => {
  for (let tick = 0; tick < ticks; tick++) {
    await wait(0);
    expect(isHydrating()).toBe(true);
  }
};

const closes = () => vi.waitFor(() => expect(isHydrating()).toBe(false));

describe("nucleus-kit progressive entry: hydration window", () => {
  beforeEach(() => {
    // every entry leaves its document observer behind: collect them
    const observe = MutationObserver.prototype.observe;
    vi.spyOn(MutationObserver.prototype, "observe").mockImplementation(
      function (this: MutationObserver, ...args) {
        observers.push(this);
        return observe.apply(this, args);
      }
    );
  });

  afterEach(() => {
    observers.splice(0).forEach((observer) => observer.disconnect());
    resetHydration();
    stubbed.splice(0).forEach((name) => vi.doUnmock(name));
    vi.restoreAllMocks();
    document.documentElement.removeAttribute(SSR_ATTR);
    document.body.innerHTML = "";
  });

  it("holds the window open while the first packages load", async () => {
    const drawer = stubPackage("@excom/content-drawer");
    prerendered("<content-drawer></content-drawer>");
    await enter();
    expect(isHydrating()).toBe(true);
    await drawer.started();
    await staysOpen();
    drawer.settle();
    await closes();
  });

  it("closes after a failed import too, which is still logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const anchor = stubPackage("@excom/dialog-anchor");
    prerendered("<dialog-anchor></dialog-anchor>");
    await enter();
    await staysOpen();
    anchor.settle(new Error("offline"));
    await closes();
    expect(error).toHaveBeenCalledWith(
      "[nucleus-kit] failed to load <dialog-anchor>",
      expect.any(Error)
    );
  });

  it("keeps holding for the other packages after one import fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const include = stubPackage("@excom/include-content");
    const fetcher = stubPackage("@excom/provider-fetch");
    prerendered(
      "<include-content></include-content><provider-fetch></provider-fetch>"
    );
    await enter();
    await Promise.all([include, fetcher].map((stub) => stub.started()));
    include.settle(new Error("offline"));
    await staysOpen();
    fetcher.settle();
    await closes();
  });

  it("waits for every package the initial scan found, nested tags too", async () => {
    const table = stubPackage("@excom/data-table");
    const form = stubPackage("@excom/super-form");
    prerendered(
      "<data-table></data-table><section><super-form></super-form></section>"
    );
    await enter();
    table.settle();
    await staysOpen();
    form.settle();
    await closes();
  });

  it("holds nothing when no kit tag is present at startup", async () => {
    prerendered("");
    await enter();
    expect(isHydrating()).toBe(true);
    await closes();
  });

  it("does not hold packages found later or under another root", async () => {
    const watcher = stubPackage("@excom/dismiss-watcher");
    const observer = stubPackage("@excom/dom-observer");
    const handler = stubPackage("@excom/event-handler");
    prerendered("<dismiss-watcher></dismiss-watcher>");
    const entry = await enter();
    document.body.insertAdjacentHTML(
      "beforeend",
      "<dom-observer></dom-observer>"
    );
    const root = document.createElement("div");
    root.innerHTML = "<event-handler></event-handler>";
    const stop = entry.observeElements(root);
    await Promise.all(
      [watcher, observer, handler].map((stub) => stub.started())
    );
    expect(isHydrating()).toBe(true);
    watcher.settle();
    // the other two are still pending
    await closes();
    stop();
    observer.settle();
    handler.settle();
  });

  it.each([
    ["a plain page", false],
    ["a stamped document", true],
  ])("boots and holds nothing without an island: %s", async (_, stamped) => {
    const scroller = stubPackage("@excom/scroll-into-view");
    document.body.innerHTML = `<scroll-into-view n-ssr="s1"></scroll-into-view>`;
    if (stamped) document.documentElement.setAttribute(SSR_ATTR, "");
    const before = document.documentElement.outerHTML;
    await enter();
    // loads on first sight, as before
    await scroller.started();
    for (let tick = 0; tick < 5; tick++) {
      expect(isHydrating()).toBe(false);
      await wait(0);
    }
    // nothing claimed or touched
    expect(document.documentElement.outerHTML).toBe(before);
    // nothing spent either: an island parsed later still boots
    document.documentElement.setAttribute(SSR_ATTR, "");
    document.body.insertAdjacentHTML("beforeend", ISLAND);
    bootHydration();
    expect(isHydrating()).toBe(true);
    scroller.settle();
  });

  it("upgrades the elements inside the window, then closes it", async () => {
    const define = customElements.define;
    const windows: [string, boolean][] = [];
    vi.spyOn(customElements, "define").mockImplementation(function (
      this: CustomElementRegistry,
      ...args: Parameters<CustomElementRegistry["define"]>
    ) {
      windows.push([args[0], isHydrating()]);
      return define.apply(this, args);
    });
    prerendered("<content-tabs></content-tabs><super-input></super-input>");
    const entry = await enter();
    await Promise.all(["content-tabs", "super-input"].map(entry.loadElement));
    expect(windows.map(([tag]) => tag)).toEqual(
      expect.arrayContaining(["content-tabs", "super-input"])
    );
    expect(windows.filter(([, open]) => !open)).toEqual([]);
    await closes();
  });
});
