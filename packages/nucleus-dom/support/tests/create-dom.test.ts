import { Window } from "happy-dom";
import { describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import {
  createDom,
  installCommandShim,
  installMissingApis,
  installShims,
  pinMutationObservers,
  scopeQueriesToDocument,
  type DomWindow,
} from "../../index";

const patchedFunctions = (win: DomWindow | typeof globalThis) => [
  win.Element.prototype.querySelector,
  win.Element.prototype.querySelectorAll,
  win.MutationObserver.prototype.observe,
  win.MutationObserver.prototype.disconnect,
  win.Element.prototype.checkVisibility,
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
    for (const install of [scopeQueriesToDocument, pinMutationObservers, installCommandShim, installMissingApis]) {
      install(window);
    }
    expect(patchedFunctions(window)).toEqual(patched);
    const events: Event[] = [];
    document.getElementById("panel")!.addEventListener("command", (event) => events.push(event));
    document.querySelector("button")!.click();
    expect(events).toHaveLength(1);
    await dispose();
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
