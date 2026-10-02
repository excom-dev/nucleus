import { describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import { createDom, installGlobals, whenIdle } from "../../index";

type Descriptors = Record<PropertyKey, PropertyDescriptor>;

/** Keys whose own descriptor on `globalThis` differs from `before`. */
const changedSince = (before: Descriptors): PropertyKey[] => {
  const after = Object.getOwnPropertyDescriptors(globalThis) as Descriptors;
  return [...new Set([...Reflect.ownKeys(before), ...Reflect.ownKeys(after)])].filter((key) => {
    const [a, b] = [before[key as string], after[key as string]];
    return (
      !a ||
      !b ||
      (["value", "get", "set", "writable", "enumerable", "configurable"] as const).some((field) => !Object.is(a[field], b[field]))
    );
  });
};

describe("installGlobals", () => {
  it("runs browser modules against the window: classes, document, registry, location", async () => {
    const { window, dispose } = createDom({ url: "https://shop.test/cart", html: `<x-cart></x-cart>` });
    const restore = installGlobals(window);
    try {
      class Cart extends HTMLElement {}
      customElements.define("x-cart", Cart);
      expect(window.document.querySelector("x-cart")).toBeInstanceOf(Cart);
      expect(document.createElement("x-cart")).toBeInstanceOf(Cart);
      expect([globalThis.window, self, document, location.pathname]).toEqual([window, window, window.document, "/cart"]);
      expect(customElements).toBe(window.customElements);
    } finally {
      restore();
    }
    await dispose();
  });

  it("binds the window's methods, timers included, and keeps Node's built-ins", async () => {
    const { window, dispose } = createDom({ holdTimersAbove: 1000 });
    const node = { Array, Promise, console, process: globalThis.process, queueMicrotask, Buffer: globalThis.Buffer };
    const restore = installGlobals(window);
    try {
      const heard = vi.fn();
      const { addEventListener, dispatchEvent } = globalThis;
      addEventListener("ping", heard);
      dispatchEvent(new Event("ping"));
      expect(heard).toHaveBeenCalledOnce();
      expect(globalThis.setTimeout).toBe(globalThis.setTimeout);
      setTimeout(() => {}, 5000);
      requestAnimationFrame(() => {});
      expect({ Array, Promise, console, process: globalThis.process, queueMicrotask, Buffer: globalThis.Buffer }).toEqual(node);
      expect(new Event("x")).toBeInstanceOf(window.Event);
    } finally {
      restore();
    }
    expect(await whenIdle(window)).toMatchObject({ frames: 0, held: [5000] });
    await dispose();
  });

  it("shadows a global assigned while installed, leaving the window alone", async () => {
    const { window, dispose } = createDom();
    const restore = installGlobals(window);
    const stub = vi.fn();
    try {
      globalThis.fetch = stub;
      expect([globalThis.fetch, window.fetch === stub]).toEqual([stub, false]);
    } finally {
      restore();
    }
    expect(globalThis.fetch).not.toBe(stub);
    await dispose();
  });

  it("stacks two installs: restoring the first while the second is active keeps the second", async () => {
    const [first, second] = [createDom(), createDom()];
    const before = Object.getOwnPropertyDescriptors(globalThis) as Descriptors;
    const envDocument = document;
    const restoreFirst = installGlobals(first.window);
    const restoreSecond = installGlobals(second.window);
    restoreFirst();
    expect(document).toBe(second.document);
    restoreSecond();
    expect([document, changedSince(before)]).toEqual([envDocument, []]);
    const again = installGlobals(first.window);
    const later = installGlobals(second.window);
    later();
    expect(document).toBe(first.document);
    again();
    expect([document, changedSince(before)]).toEqual([envDocument, []]);
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("restores globalThis as it was, over the test environment's window, once", async () => {
    const { window, dispose } = createDom();
    const before = Object.getOwnPropertyDescriptors(globalThis) as Descriptors;
    const envDocument = document;
    const restore = installGlobals(window);
    expect(document).toBe(window.document);
    expect(changedSince(before)).toContain("document");
    restore();
    expect(changedSince(before)).toEqual([]);
    expect(document).toBe(envDocument);
    restore();
    expect(changedSince(before)).toEqual([]);
    await dispose();
  });
});
