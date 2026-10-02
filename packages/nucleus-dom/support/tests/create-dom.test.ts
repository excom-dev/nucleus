import { Window } from "happy-dom";
import { describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import {
  createDom,
  ignoreStrayMarkup,
  installCommandShim,
  installMissingApis,
  installShims,
  keepEventPaths,
  keepFormParents,
  pinMutationObservers,
  supportSelectors,
  supportTableTemplates,
  upgradeClones,
  type DomWindow,
} from "../../index";

const happyDOM = (win: DomWindow) => (win as unknown as Window).happyDOM;

/** happy-dom's internal method `name`, found on `target`'s prototype chain. */
const internalMethod = (target: object, name: string): unknown => {
  const key = Object.getOwnPropertySymbols(target).find((symbol) => symbol.description === name);
  return key ? (target as Record<symbol, unknown>)[key] : internalMethod(Object.getPrototypeOf(target), name);
};

const patchedFunctions = (win: DomWindow | typeof globalThis) => [
  win.Element.prototype.querySelector,
  win.Element.prototype.querySelectorAll,
  win.Element.prototype.matches,
  win.Element.prototype.closest,
  win.MutationObserver.prototype.observe,
  win.MutationObserver.prototype.disconnect,
  win.Element.prototype.checkVisibility,
  win.Event.prototype.composedPath,
  win.document.importNode,
  win.customElements.define,
  internalMethod(win.Node.prototype, "connectedToNode"),
  (win as { ServiceWorkerContainer?: unknown }).ServiceWorkerContainer,
];

describe("createDom", () => {
  it("opens http://localhost/ unless given a URL", async () => {
    const plain = createDom();
    const shop = createDom({ url: "https://shop.test/cart?step=2" });
    expect(plain.window.location.href).toBe("http://localhost/");
    expect([shop.document.URL, shop.window.location.pathname]).toEqual([
      "https://shop.test/cart?step=2",
      "/cart",
    ]);
    await Promise.all([plain.dispose(), shop.dispose()]);
  });

  it("writes a whole document or body markup", async () => {
    const page = createDom({
      html: `<!doctype html><html lang="en"><head><title>Cart</title></head><body><main>2 items</main></body></html>`,
    });
    const fragment = createDom({ html: `<p>hi</p>` });
    expect([page.document.documentElement.lang, page.document.title]).toEqual(["en", "Cart"]);
    expect(page.document.body.innerHTML).toBe("<main>2 items</main>");
    expect(fragment.document.body.innerHTML).toBe("<p>hi</p>");
    await Promise.all([page.dispose(), fragment.dispose()]);
  });

  it("installs the missing APIs", async () => {
    const { window, document, dispose } = createDom({ html: `<p hidden>x</p>` });
    expect(typeof (window as { ServiceWorkerContainer?: unknown }).ServiceWorkerContainer).toBe(
      "function",
    );
    expect(document.querySelector("p")!.checkVisibility()).toBe(true);
    expect(document.createElementNS("http://www.w3.org/2000/svg", "svg").checkVisibility()).toBe(true);
    const bare = new Window();
    expect((bare as { ServiceWorkerContainer?: unknown }).ServiceWorkerContainer).toBeUndefined();
    await Promise.all([dispose(), bare.happyDOM.close()]);
  });

  it("dispose() closes the window and stops its timers", async () => {
    const { window, dispose } = createDom();
    const tick = vi.fn();
    window.setTimeout(tick, 0);
    await dispose();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(window.closed).toBe(true);
    expect(tick).not.toHaveBeenCalled();
  });

  it("sizes the viewport", async () => {
    const phone = createDom({ viewport: { width: 390, height: 844 } });
    const desktop = createDom({ settings: { viewport: { width: 1280, devicePixelRatio: 2 } } });
    expect([phone.window.innerWidth, phone.window.innerHeight]).toEqual([390, 844]);
    expect(phone.window.matchMedia("(max-width: 600px)").matches).toBe(true);
    expect([desktop.window.innerWidth, desktop.window.innerHeight, desktop.window.devicePixelRatio]).toEqual([
      1280, 768, 2,
    ]);
    await Promise.all([phone.dispose(), desktop.dispose()]);
  });

  it("never loads JavaScript files or navigates the main frame, unless settings say so", async () => {
    const { window, document, dispose } = createDom({ url: "https://shop.test/" });
    const script = Object.assign(document.createElement("script"), { src: "/app.js" });
    const events: string[] = [];
    for (const type of ["load", "error"]) script.addEventListener(type, () => events.push(type));
    document.head.append(script);
    window.location.href = "https://shop.test/cart";
    const { settings, virtualConsolePrinter } = happyDOM(window);
    expect(events).toEqual(["load"]);
    expect(virtualConsolePrinter.readAsString()).toBe("");
    expect([window.location.href, window.document === document]).toEqual(["https://shop.test/cart", true]);
    expect([settings.enableJavaScriptEvaluation, settings.disableJavaScriptFileLoading]).toEqual([false, true]);
    await dispose();

    const strict = createDom({
      settings: { handleDisabledFileLoadingAsSuccess: false, navigation: { disableChildFrameNavigation: true } },
    });
    const { navigation, handleDisabledFileLoadingAsSuccess } = happyDOM(strict.window).settings;
    expect([handleDisabledFileLoadingAsSuccess, navigation.disableMainFrameNavigation, navigation.disableChildFrameNavigation]).toEqual([
      false, true, true,
    ]);
    await strict.dispose();
  });

  it("disposing one window leaves another working", async () => {
    const first = createDom();
    const { window, document, dispose } = createDom({
      html: `<main><ul><li>a</li></ul><button command="--open" commandfor="panel"></button><div id="panel"></div></main>`,
    });
    await first.dispose();
    expect(document.querySelector("ul")!.querySelector("main li")!.textContent).toBe("a");
    const commands: Event[] = [];
    document.getElementById("panel")!.addEventListener("command", (event) => commands.push(event));
    document.querySelector("button")!.click();
    expect(commands).toHaveLength(1);
    const records: MutationRecord[] = [];
    new window.MutationObserver((list) => records.push(...list)).observe(document.body, {
      attributes: true,
      subtree: true,
    });
    document.querySelector("li")!.setAttribute("x", "1");
    await Promise.resolve();
    expect(records).toHaveLength(1);
    await dispose();
  });
});

describe("installShims", () => {
  it("patches a window once, however often it runs", async () => {
    const { window, document, dispose } = createDom({
      html: `<button command="--open" commandfor="panel"></button><div id="panel"></div>`,
    });
    const patched = patchedFunctions(window);
    installShims(window);
    for (const install of [
      supportSelectors,
      pinMutationObservers,
      installCommandShim,
      installMissingApis,
      upgradeClones,
      keepFormParents,
      supportTableTemplates,
      ignoreStrayMarkup,
      keepEventPaths,
    ]) {
      install(window);
    }
    expect(patchedFunctions(window)).toEqual(patched);
    const events: Event[] = [];
    document.getElementById("panel")!.addEventListener("command", (event) => events.push(event));
    document.querySelector("button")!.click();
    expect(events).toHaveLength(1);
    await dispose();
  });

  it("ignores define() on a closed window's registry, as happy-dom does", async () => {
    const { window, dispose } = createDom();
    await dispose();
    window.customElements.define("x-closed", class extends window.HTMLElement {});
    expect(window.customElements.get("x-closed")).toBeUndefined();
  });

  it("patches the test environment's window through globalThis", () => {
    installShims(globalThis);
    const patched = patchedFunctions(globalThis);
    installShims(globalThis);
    expect(patchedFunctions(globalThis)).toEqual(patched);
    expect(typeof (globalThis as { ServiceWorkerContainer?: unknown }).ServiceWorkerContainer).toBe(
      "function",
    );
  });
});
