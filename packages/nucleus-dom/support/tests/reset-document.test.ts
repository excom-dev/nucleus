import type { Window } from "happy-dom";
import { describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import { createDom, type DomWindow, resetDocument, upgradeClones, whenIdle } from "../../index";
import { dependencies } from "../../package.json";

/** Node's own timer: test waits never run on the window under test. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const happyDOM = (window: DomWindow) => (window as unknown as Window).happyDOM;

const PAGE = `<!doctype html><html lang="en" data-theme="dark"><head><title>Cart</title></head><body class="cart"><x-card id="old"></x-card></body></html>`;

/** Defines `<x-card>` in `window`, logging its lifecycle and the URL it saw. */
const defineCard = (window: DomWindow, log: string[]) => {
  class Card extends window.HTMLElement {
    connectedCallback() {
      log.push(`connected ${this.id}`);
    }
    disconnectedCallback() {
      log.push(`disconnected ${this.id}`);
      queueMicrotask(() => log.push(`microtask ${this.id} at ${window.location.pathname}`));
    }
  }
  window.customElements.define("x-card", Card);
  return Card;
};

describe("resetDocument", () => {
  it("keeps the registry: an element defined before the reset upgrades in the new page", async () => {
    const { window, document, dispose } = createDom({ url: "https://shop.test/cart" });
    const log: string[] = [];
    const Card = defineCard(window, log);
    document.write(PAGE);
    await resetDocument(window, {
      url: "/checkout",
      html: `<!doctype html><html lang="fr"><head><title>Checkout</title></head><body data-step="2"><x-card id="new"><b>items</b></x-card></body></html>`,
      beforeParse: () => log.push(`beforeParse at ${window.location.pathname}, body ${document.body.childNodes.length}`),
    });
    expect(document.getElementById("new")).toBeInstanceOf(Card);
    expect(window.customElements.get("x-card")).toBe(Card);
    expect(log).toEqual([
      "connected old",
      "disconnected old",
      "microtask old at /cart",
      "beforeParse at /checkout, body 0",
      "connected new",
    ]);
    expect(document.documentElement.outerHTML).toBe(
      `<html lang="fr"><head><title>Checkout</title></head><body data-step="2"><x-card id="new"><b>items</b></x-card></body></html>`,
    );
    expect(document.title).toBe("Checkout");
    await dispose();
  });

  it("starts a fresh history entry at the new URL, keeping module-level listeners", async () => {
    const { window, document, dispose } = createDom({ url: "https://shop.test/cart#totals", html: PAGE });
    window.history.pushState({ step: 1 }, "", "/cart?step=1");
    const listeners = { document: vi.fn(), window: vi.fn() };
    document.addEventListener("ping", listeners.document);
    window.addEventListener("ping", listeners.window);
    window.history.pushState({ step: 2 }, "", "/cart?step=2");
    await resetDocument(window, { url: "/shop/tables?page=2", html: `<p>tables</p>` });
    expect([window.location.href, window.history.state, window.history.length]).toEqual([
      "https://shop.test/shop/tables?page=2",
      null,
      1,
    ]);
    expect(document.documentElement.outerHTML).toBe(`<html><head></head><body><p>tables</p></body></html>`);
    for (const target of [document, window]) target.dispatchEvent(new window.Event("ping"));
    expect([listeners.document.mock.calls.length, listeners.window.mock.calls.length]).toEqual([1, 1]);
    await dispose();
  });

  it("fires no hashchange for the new page's URL, as a page load", async () => {
    const { window, dispose } = createDom({ url: "https://shop.test/cart#totals" });
    const changes = vi.fn();
    window.addEventListener("hashchange", (event) => changes(event.newURL));
    await resetDocument(window, { url: "/checkout" });
    await whenIdle(window);
    await resetDocument(window, { url: "/checkout" });
    window.location.hash = "pay";
    await whenIdle(window);
    expect(changes.mock.calls).toEqual([["https://shop.test/checkout#pay"]]);
    await dispose();
  });

  it("removes nodes outside <html>, keeps only the new page's doctype and awaits an async beforeParse", async () => {
    const { window, document, dispose } = createDom({ html: `<!-- old -->${PAGE}` });
    expect(document.childNodes).toHaveLength(3);
    const beforeParse = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 10)));
    await resetDocument(window, { url: "http://localhost/next", beforeParse });
    expect(beforeParse).toHaveBeenCalledOnce();
    expect([[...document.childNodes].map((node) => node.nodeName), document.doctype]).toEqual([["HTML"], null]);
    expect(document.body.childNodes).toHaveLength(0);
    await resetDocument(window, { url: "/again", html: `<!DOCTYPE HTML><p>again</p>` });
    expect([...document.childNodes].map((node) => node.nodeName)).toEqual(["html", "HTML"]);
    await dispose();
  });

  it("cancels what is still due after the settle and drops held timers; requests finish untracked", async () => {
    const { window, dispose } = createDom({
      holdTimersAbove: 1000,
      html: PAGE,
      settings: {
        fetch: {
          interceptor: {
            beforeAsyncRequest: async ({ window: page }) => {
              await sleep(80);
              return new page.Response("late");
            },
          },
        },
      },
    });
    const ran = vi.fn();
    window.setTimeout(() => ran("past the settle"), 300);
    window.setTimeout(() => ran("held"), 3000);
    window.setInterval(() => ran("interval"), 5);
    const loop = () => window.requestAnimationFrame(loop);
    loop();
    const late = window.fetch("/slow");
    await resetDocument(window, { url: "/next" });
    ran.mockClear();
    expect(await whenIdle(window, { timeout: 40 })).toEqual({ requests: [], timers: [], frames: 0, held: [] });
    expect(await (await late).text()).toBe("late");
    await sleep(300);
    expect(ran).not.toHaveBeenCalled();
    await dispose();
  });

  it("lets the teardown settle: a module-level flag's timer fires before the new page parses", async () => {
    const { window, document, dispose } = createDom();
    // module state that outlives pages: a flag only its own timer resets (kit-utils' loop guard)
    let bumpScheduled = false;
    const bump = () => {
      if (bumpScheduled) return;
      bumpScheduled = true;
      window.setTimeout(() => (bumpScheduled = false), 0);
    };
    window.customElements.define(
      "x-guarded",
      class extends window.HTMLElement {
        disconnectedCallback() {
          // teardown writes land in a microtask, as Neutron batches them
          void Promise.resolve().then(bump);
        }
      },
    );
    document.body.innerHTML = `<x-guarded></x-guarded>`;
    const flagAtParse = vi.fn();
    await resetDocument(window, { url: "/next", beforeParse: () => flagAtParse(bumpScheduled) });
    expect(flagAtParse).toHaveBeenCalledWith(false);
    await dispose();
  });

  it("lets a two-step zero-delay chain of the teardown complete, as Quark's requeue", async () => {
    const { window, document, dispose } = createDom();
    const steps: string[] = [];
    window.customElements.define(
      "x-requeue",
      class extends window.HTMLElement {
        disconnectedCallback() {
          window.setTimeout(() => {
            steps.push("queued");
            window.setTimeout(() => steps.push("ran"), 0);
          }, 0);
        }
      },
    );
    document.body.innerHTML = `<x-requeue></x-requeue>`;
    await resetDocument(window, { url: "/next", beforeParse: () => steps.push("parse") });
    expect(steps).toEqual(["queued", "ran", "parse"]);
    await dispose();
  });

  it("cuts off teardown work that never settles within 50 ms, leaving the next page idle", async () => {
    const { window, document, dispose } = createDom();
    const ticks = vi.fn();
    window.customElements.define(
      "x-busy",
      class extends window.HTMLElement {
        disconnectedCallback() {
          window.setInterval(ticks, 5);
          const chain = () => window.setTimeout(chain, 0);
          chain();
          const frames = () => window.requestAnimationFrame(frames);
          frames();
        }
      },
    );
    document.body.innerHTML = `<x-busy></x-busy>`;
    const started = Date.now();
    await resetDocument(window, { url: "/next" });
    expect(Date.now() - started).toBeLessThan(500);
    // the interval's next ticks ran before the cut
    expect(ticks).toHaveBeenCalled();
    const count = ticks.mock.calls.length;
    expect(await whenIdle(window, { timeout: 100 })).toEqual({ requests: [], timers: [], frames: 0, held: [] });
    await sleep(30);
    expect(ticks).toHaveBeenCalledTimes(count);
    await dispose();
  });

  it("resets a test environment's window through globalThis", async () => {
    localStorage.setItem("bag", "2");
    history.pushState({ step: 1 }, "", "/cart");
    await resetDocument(globalThis, { url: "/next", html: `<html lang="en"><body><p>env</p></body></html>` });
    expect([document.body.innerHTML, location.pathname, history.length, localStorage.length]).toEqual([
      "<p>env</p>",
      "/next",
      1,
      0,
    ]);
  });

  it("starts each page with empty storage and cookies, which beforeParse may seed", async () => {
    const { window, document, dispose } = createDom({ url: "https://shop.test/", html: PAGE });
    window.localStorage.setItem("bag", "2");
    window.sessionStorage.setItem("step", "1");
    document.cookie = "consent=yes; path=/";
    document.cookie = "deep=1; path=/deep";
    await resetDocument(window, { url: "/deep/page" });
    expect([window.localStorage.length, window.sessionStorage.length, document.cookie]).toEqual([0, 0, ""]);
    await resetDocument(window, { url: "/", beforeParse: () => (document.cookie = "seeded=1; path=/") });
    expect(document.cookie).toBe("seeded=1");
    await dispose();
  });
});

describe("resetDocument: the page parses whole, then its elements upgrade", () => {
  /** An element class logging `id event`: construction counts its attributes / children. */
  const logging = (window: DomWindow, log: string[]) =>
    class extends window.HTMLElement {
      static observedAttributes = ["lang"];
      constructor() {
        super();
        log.push(`${this.id} new ${this.attributes.length}/${this.childElementCount}`);
      }
      attributeChangedCallback(attribute: string, _: string | null, value: string | null) {
        log.push(`${this.id} ${attribute}=${value}`);
      }
      connectedCallback() {
        log.push(`${this.id} connected "${this.textContent!.trim()}"`);
      }
      disconnectedCallback() {
        log.push(`${this.id} disconnected`);
      }
    };

  /** Defines each name in order, logging, on a fresh window. */
  const page = (names: string[]) => {
    const dom = createDom();
    const log: string[] = [];
    for (const name of names) dom.window.customElements.define(name, logging(dom.window, log));
    return { ...dom, log };
  };

  const consoleOf = (window: DomWindow) => happyDOM(window).virtualConsolePrinter.readAsString();

  it("upgrades an element as a browser: constructed with its attributes and children, then its callbacks", async () => {
    const { window, document, log, dispose } = page(["x-text"]);
    await resetDocument(window, { url: "/next", html: `<x-text id="t" lang="en">hello <b>world</b></x-text>` });
    expect(log).toEqual(["t new 2/1", "t lang=en", 't connected "hello world"']);
    expect(document.getElementById("t")).toBeInstanceOf(window.customElements.get("x-text")!);
    // happy-dom's waits for define(), one per undefined element parsed: none left to leak
    const key = Object.getOwnPropertySymbols(window.customElements).find((symbol) => symbol.description === "callbacks")!;
    expect((window.customElements as unknown as Record<symbol, Map<string, unknown>>)[key].has("x-text")).toBe(false);
    await dispose();
  });

  it("upgrades in definition order, parse order within a definition", async () => {
    const html = `<x-parent id="p1" lang="a"><x-child id="c1" lang="b"></x-child><x-child id="c2"></x-child></x-parent><x-parent id="p2"></x-parent>`;
    const upgraded = async (names: string[]) => {
      const { window, log, dispose } = page(names);
      await resetDocument(window, { url: "/next", html });
      await dispose();
      return log.filter((line) => !line.endsWith("disconnected"));
    };
    const child = ["c1 new 2/0", "c1 lang=b", 'c1 connected ""', "c2 new 1/0", 'c2 connected ""'];
    const parent = ["p1 new 2/2", "p1 lang=a", 'p1 connected ""', "p2 new 1/0", 'p2 connected ""'];
    expect(await upgraded(["x-child", "x-parent"])).toEqual([...child, ...parent]);
    expect(await upgraded(["x-parent", "x-child"])).toEqual([...parent, ...child]);
  });

  it("gives an element moved before its turn no callbacks until then", async () => {
    const { window, document, dispose } = createDom();
    const log: string[] = [];
    window.customElements.define(
      "x-mover",
      class extends window.HTMLElement {
        connectedCallback() {
          this.append(document.querySelector("x-moved")!);
        }
      },
    );
    // defined after x-mover: x-mover moves it before its turn
    window.customElements.define(
      "x-moved",
      class extends window.HTMLElement {
        connectedCallback() {
          log.push(`connected in ${this.parentElement!.localName}`);
        }
        disconnectedCallback() {
          log.push("disconnected");
        }
      },
    );
    await resetDocument(window, { url: "/next", html: `<x-moved></x-moved><x-mover></x-mover>` });
    expect(log).toEqual(["connected in x-mover"]);
    await dispose();
  });

  it("leaves an element removed before its turn undefined, to upgrade once inserted again", async () => {
    const { window, document, dispose } = createDom();
    const log: string[] = [];
    let removed: Element | undefined;
    window.customElements.define(
      "x-remover",
      class extends window.HTMLElement {
        connectedCallback() {
          removed = document.querySelector("x-removed")!;
          removed.remove();
        }
      },
    );
    class Removed extends window.HTMLElement {
      connectedCallback() {
        log.push("connected");
      }
      disconnectedCallback() {
        log.push("disconnected");
      }
    }
    window.customElements.define("x-removed", Removed);
    await resetDocument(window, { url: "/next", html: `<x-removed></x-removed><x-remover></x-remover>` });
    expect([log, removed instanceof Removed]).toEqual([[], false]);
    document.body.append(removed!);
    expect([log, removed instanceof Removed]).toEqual([["connected"], true]);
    await dispose();
  });

  it("leaves <template> content undefined: an import upgrades it, a clone once inserted", async () => {
    const { window, document, dispose } = createDom();
    const log: string[] = [];
    class Row extends window.HTMLElement {
      constructor() {
        super();
        log.push(`new ${this.dataset.n}`);
      }
      connectedCallback() {
        log.push(`connected ${this.dataset.n} "${this.textContent}"`);
      }
    }
    window.customElements.define("x-row", Row);
    await resetDocument(window, {
      url: "/next",
      html: `<template><x-row data-n="1">a</x-row><div><p><x-row data-n="2">b</x-row></p></div></template>`,
    });
    const { content } = document.querySelector("template")!;
    const rows = (node: ParentNode) => [...node.querySelectorAll("x-row")].map((row) => row instanceof Row);
    expect([log, rows(content)]).toEqual([[], [false, false]]);
    const imported = document.importNode(content, true);
    const cloned = content.cloneNode(true) as DocumentFragment;
    expect([rows(imported), rows(cloned)]).toEqual([
      [true, true],
      [false, false],
    ]);
    document.body.append(imported, cloned);
    expect(rows(document.body)).toEqual([true, true, true, true]);
    expect(log).toEqual([
      "new 1",
      "new 2",
      'connected 1 "a"',
      'connected 2 "b"',
      "new 1",
      'connected 1 "a"',
      "new 2",
      'connected 2 "b"',
    ]);
    const shallow = document.importNode(content.firstElementChild!);
    expect([shallow instanceof Row, shallow.childNodes.length, shallow.getAttribute("data-n")]).toEqual([true, 0, "1"]);
    expect(document.importNode(document.createTextNode("text")).textContent).toBe("text");
    await dispose();
  });

  it("parses through a spy on document.createElementNS, and leaves it in place", async () => {
    const { window, document, dispose } = createDom();
    window.customElements.define("x-spied", class extends window.HTMLElement {});
    const createElementNS = vi.spyOn(document, "createElementNS");
    await resetDocument(window, { url: "/next", html: `<x-spied></x-spied>` });
    expect([
      document.createElementNS === createElementNS,
      createElementNS.mock.calls.some(([, name]) => name === "x-spied"),
    ]).toEqual([true, true]);
    await dispose();
  });

  it("imports with the importing document's registry", async () => {
    const a = createDom();
    const b = createDom();
    class Card extends a.window.HTMLElement {}
    a.window.customElements.define("x-card", Card);
    await resetDocument(a.window, { url: "/next", html: `<template><x-card></x-card></template>` });
    b.document.body.innerHTML = `<template><x-card></x-card></template>`;
    const content = (dom: typeof a) => dom.document.querySelector("template")!.content;
    const intoA = a.document.importNode(content(b), true).firstElementChild!;
    const intoB = b.document.importNode(content(a), true).firstElementChild!;
    expect([intoA instanceof Card, intoB instanceof Card, intoB.constructor === b.window.HTMLElement]).toEqual([
      true,
      false,
      true,
    ]);
    await Promise.all([a.dispose(), b.dispose()]);
  });

  it("constructs at once the elements code creates as the page loads; parsed ones wait for their turn", async () => {
    const { window, document, dispose } = createDom();
    const log: string[] = [];
    window.customElements.define(
      "x-maker",
      class extends window.HTMLElement {
        connectedCallback() {
          log.push("maker connected");
          this.append(Object.assign(document.createElement("x-made"), { id: "created" }));
          this.insertAdjacentHTML("beforeend", `<x-made id="parsed-later"></x-made>`);
        }
      },
    );
    window.customElements.define("x-made", logging(window, log));
    await resetDocument(window, { url: "/next", html: `<x-made id="parsed"></x-made><x-maker></x-maker>` });
    expect(log).toEqual([
      "maker connected",
      " new 0/0",
      'created connected ""',
      " new 0/0",
      'parsed-later connected ""',
      "parsed new 1/0",
      'parsed connected ""',
    ]);
    await dispose();
  });

  it("keeps the registry for code that runs as the page loads; later elements wait undefined", async () => {
    const { window, document, dispose } = createDom();
    const seen: unknown[][] = [];
    class Later extends window.HTMLElement {}
    window.customElements.define(
      "x-probe",
      class extends window.HTMLElement {
        connectedCallback() {
          seen.push([
            window.customElements.get("x-later") === Later,
            document.createElement("x-later") instanceof Later,
            document.querySelector("x-later") instanceof Later,
          ]);
          window.customElements.define("x-new", class extends window.HTMLElement {});
        }
      },
    );
    window.customElements.define("x-later", Later);
    await resetDocument(window, { url: "/next", html: `<x-probe></x-probe><x-later></x-later><x-new></x-new>` });
    expect(seen).toEqual([[true, true, false]]);
    expect([document.querySelector("x-later") instanceof Later, document.querySelector("x-new")!.constructor]).toEqual([
      true,
      window.customElements.get("x-new"),
    ]);
    await dispose();
  });

  it("reports a constructor or callback that throws and loads the rest of the page; a failed element stays undefined", async () => {
    const { window, document, dispose } = createDom();
    const log: string[] = [];
    let failures = 1;
    window.customElements.define("x-ok", logging(window, log));
    window.customElements.define(
      "x-broken",
      class extends window.HTMLElement {
        static observedAttributes = ["lang"];
        constructor() {
          super();
          if (failures-- > 0) throw new Error("broken constructor");
        }
        attributeChangedCallback() {
          log.push("broken attribute");
        }
        connectedCallback() {
          log.push("broken connected");
        }
        disconnectedCallback() {
          log.push("broken disconnected");
        }
      },
    );
    window.customElements.define(
      "x-throws",
      class extends window.HTMLElement {
        connectedCallback() {
          throw new Error("throwing connectedCallback");
        }
        disconnectedCallback() {
          log.push("throws disconnected");
        }
      },
    );
    window.customElements.define("x-last", logging(window, log));
    await resetDocument(window, {
      url: "/next",
      html: `<x-throws></x-throws><x-broken lang="en"><b>kept</b></x-broken><x-ok id="a"></x-ok><x-last id="z"></x-last>`,
    });
    const broken = document.querySelector("x-broken")!;
    expect(log).toEqual(["a new 1/0", 'a connected ""', "z new 1/0", 'z connected ""']);
    expect([broken.constructor === window.HTMLElement, broken.innerHTML]).toEqual([true, "<b>kept</b>"]);
    expect(consoleOf(window)).toMatch(/broken constructor[\s\S]*throwing connectedCallback/);
    // undefined for good: no callbacks, moved or changed
    broken.setAttribute("lang", "fr");
    document.body.append(broken);
    await resetDocument(window, { url: "/again", html: `<x-ok id="b"></x-ok>` });
    expect(log.slice(4)).toEqual(["throws disconnected", "a disconnected", "z disconnected", "b new 1/0", 'b connected ""']);
    // page code's own DOM calls throw, as in plain happy-dom
    expect(() => document.body.append(document.createElement("x-throws"))).toThrow("throwing connectedCallback");
    await dispose();
  });

  it("reports a disconnectedCallback that throws as the page unloads, and loads the next page", async () => {
    const { window, document, dispose } = createDom();
    window.customElements.define(
      "x-sticky",
      class extends window.HTMLElement {
        disconnectedCallback() {
          throw new Error("cannot leave");
        }
      },
    );
    await resetDocument(window, { url: "/a", html: `<x-sticky></x-sticky><p>a</p>` });
    await resetDocument(window, { url: "/b", html: `<p>b</p>` });
    expect([document.body.innerHTML, consoleOf(window)]).toEqual(["<p>b</p>", expect.stringContaining("cannot leave")]);
    await dispose();
  });

  it("upgrades subclasses of a shared base class, and constructs the elements a constructor creates", async () => {
    const { window, document, dispose } = createDom();
    class Base extends window.HTMLElement {
      base = this.localName;
    }
    class Inner extends Base {}
    class Outer extends Base {
      inner = document.createElement("x-inner") as Inner;
    }
    window.customElements.define("x-outer", Outer);
    window.customElements.define("x-inner", Inner);
    await resetDocument(window, { url: "/next", html: `<x-outer></x-outer>` });
    const outer = document.querySelector("x-outer") as Outer;
    expect([outer instanceof Outer, outer.base, outer.inner instanceof Inner, outer.inner.base]).toEqual([
      true,
      "x-outer",
      true,
      "x-inner",
    ]);
    expect(Object.getPrototypeOf(Base)).toBe(window.HTMLElement);
    await dispose();
  });

  it("fails, as browsers do, an upgrade whose class is no HTMLElement or whose constructor returns another object", async () => {
    const { window, document, dispose } = createDom();
    window.customElements.define("x-object", class {} as unknown as CustomElementConstructor);
    window.customElements.define(
      "x-swap",
      class extends window.HTMLElement {
        constructor() {
          super();
          return document.createElement("div");
        }
      },
    );
    await resetDocument(window, { url: "/next", html: `<x-object></x-object><x-swap></x-swap>` });
    const names = ["x-object", "x-swap"];
    expect(names.map((name) => document.querySelector(name)!.constructor === window.HTMLElement)).toEqual([true, true]);
    expect(consoleOf(window)).toMatch(
      /<x-object>: its class does not extend HTMLElement[\s\S]*<x-swap>: its constructor returned another object/,
    );
    await dispose();
  });

  it("parses attribute names setAttribute() refuses, never calling it", async () => {
    const { window, document, dispose } = createDom();
    class Tag extends window.HTMLElement {}
    window.customElements.define("x-tag", Tag);
    const setAttribute = vi.spyOn(Object.getPrototypeOf(window.HTMLElement.prototype), "setAttribute");
    await resetDocument(window, {
      url: "/next",
      html: `<x-tag -dash="1" data-n="2">a</x-tag><template><x-tag -dash="3"></x-tag></template>`,
    });
    const parsed = document.querySelector("x-tag")!;
    const imported = document.importNode(document.querySelector("template")!.content, true).firstElementChild!;
    expect([
      parsed instanceof Tag,
      parsed.getAttribute("-dash"),
      imported instanceof Tag,
      imported.getAttribute("-dash"),
      setAttribute.mock.calls.length,
    ]).toEqual([true, "1", true, "3", 0]);
    setAttribute.mockRestore();
    await dispose();
  });

  // V8 takes ~120 000 call arguments
  it("loads and imports an element with more children than a call takes arguments", { timeout: 30_000 }, async () => {
    const { window, document, dispose } = createDom();
    class List extends window.HTMLElement {}
    window.customElements.define("x-list", List);
    const items = "<i></i>".repeat(130_000);
    await resetDocument(window, { url: "/next", html: `<x-list>${items}</x-list><template><x-list>${items}</x-list></template>` });
    const list = document.querySelector("x-list")!;
    const imported = document.importNode(document.querySelector("template")!.content, true).firstElementChild!;
    expect([list instanceof List, list.childElementCount, imported instanceof List, imported.childElementCount]).toEqual([
      true,
      130_000,
      true,
      130_000,
    ]);
    await dispose();
  });

  it("names the happy-dom pin when happy-dom's registry is not where it should be", async () => {
    const { window, dispose } = createDom();
    const registry = Object.getOwnPropertyDescriptor(window, "customElements")!;
    Object.defineProperty(window, "customElements", { configurable: true, value: {} });
    await expect(resetDocument(window, { url: "/next", html: `<p>x</p>` })).rejects.toThrow(
      `nucleus-dom needs happy-dom ${dependencies["happy-dom"]}: this happy-dom has no "registry"`,
    );
    Object.defineProperty(window, "customElements", registry);
    await dispose();
  });

  it("pins happy-dom's own construction of elements page code adds later: connected before their children parse", async () => {
    const { window, document, log, dispose } = page(["x-late"]);
    await resetDocument(window, { url: "/next" });
    document.body.innerHTML = `<x-late id="a">a</x-late>`;
    document.body.append(Object.assign(document.createElement("x-late"), { id: "b" }));
    expect(log).toEqual([" new 0/0", 'a connected ""', " new 0/0", 'b connected ""']);
    await dispose();
  });

  it("reports a throwing disconnectedCallback as the page unloads, for an element defined after it loaded", async () => {
    const { window, document, dispose } = createDom();
    await resetDocument(window, { url: "/a", html: `<p>a</p>` });
    window.customElements.define(
      "x-lazy",
      class extends window.HTMLElement {
        disconnectedCallback() {
          throw new Error("lazy cannot leave");
        }
      },
    );
    document.body.append(document.createElement("x-lazy"));
    await resetDocument(window, { url: "/b", html: `<p>b</p>` });
    expect([document.documentElement.outerHTML, consoleOf(window)]).toEqual([
      "<html><head></head><body><p>b</p></body></html>",
      expect.stringContaining("lazy cannot leave"),
    ]);
    await dispose();
  });

  it("upgrades an element created before its definition once inserted, whether an import ran before or not", async () => {
    const insert = async (importFirst: boolean) => {
      const { window, document, dispose } = createDom();
      const log: string[] = [];
      const [early, other] = [document.createElement("x-early"), document.createElement("x-early")];
      class Early extends window.HTMLElement {
        connectedCallback() {
          log.push(`connected ${this instanceof Early}`);
        }
      }
      window.customElements.define("x-early", Early);
      if (importFirst) document.importNode(other);
      document.body.append(early);
      await dispose();
      return [early instanceof Early, ...log];
    };
    expect(await insert(false)).toEqual([true, "connected true"]);
    expect(await insert(true)).toEqual([true, "connected true"]);
  });

  it("reports what throws as browsers report an uncaught error: an error event on the window, and its console", async () => {
    const { window, document, dispose } = createDom();
    const events: string[] = [];
    window.addEventListener("error", (event) => events.push((event as ErrorEvent).error.message));
    window.customElements.define(
      "x-bad",
      class extends window.HTMLElement {
        constructor() {
          super();
          throw new Error("bad constructor");
        }
      },
    );
    await resetDocument(window, { url: "/next", html: `<template><x-bad></x-bad></template>` });
    const imported = document.importNode(document.querySelector("template")!.content, true).firstElementChild!;
    expect([imported.constructor === window.HTMLElement, events, consoleOf(window)]).toEqual([
      true,
      ["bad constructor"],
      expect.stringContaining("bad constructor"),
    ]);
    await dispose();
  });

  it("upgrades a class whose constructor never calls super() (compiled ES5) with a new element in place, its children moved without callbacks", async () => {
    const { window, document, dispose } = createDom();
    const log: string[] = [];
    window.customElements.define("x-inner", logging(window, log));
    // as Babel's `_wrapNativeSuper` and TypeScript's ES5 output construct
    function Legacy(this: HTMLElement) {
      const element = Reflect.construct(window.HTMLElement, [], new.target) as HTMLElement;
      log.push(`legacy new ${element.childElementCount}`);
      return element;
    }
    Object.setPrototypeOf(Legacy.prototype, window.HTMLElement.prototype);
    Object.setPrototypeOf(Legacy, window.HTMLElement);
    Legacy.prototype.connectedCallback = function (this: HTMLElement) {
      log.push(`legacy connected ${this.dataset.n}: ${this.childElementCount} children`);
    };
    window.customElements.define("x-legacy", Legacy as unknown as CustomElementConstructor);
    await resetDocument(window, {
      url: "/next",
      html: `<x-legacy data-n="1"><x-inner id="i"></x-inner></x-legacy><template><x-legacy data-n="2"><b></b></x-legacy></template>`,
    });
    const { content } = document.querySelector("template")!;
    const imported = document.importNode(content, true).firstElementChild!;
    document.body.append(content.cloneNode(true));
    const [parsed, inserted] = document.querySelectorAll("body > x-legacy");
    expect([parsed, imported, inserted].map((element) => element instanceof Legacy)).toEqual([true, true, true]);
    expect([parsed.firstElementChild!.id, imported.getAttribute("data-n"), inserted.childElementCount]).toEqual(["i", "2", 1]);
    expect(log).toEqual([
      "i new 1/0",
      'i connected ""',
      "legacy new 0",
      "legacy connected 1: 1 children",
      "legacy new 0",
      "legacy new 0",
      "legacy connected 2: 1 children",
    ]);
    await dispose();
  });

  it("upgrades an inserted subtree in tree order, once the insertion is done", async () => {
    const { window, document, log, dispose } = page(["x-sub", "x-cell"]);
    await resetDocument(window, {
      url: "/next",
      html: `<template><x-cell id="c" lang="a"><x-sub id="s"></x-sub></x-cell></template>`,
    });
    document.body.append(document.querySelector("template")!.content.cloneNode(true));
    expect(log).toEqual(["c new 2/1", "c lang=a", 'c connected ""', "s new 1/0", 's connected ""']);
    await dispose();
  });

  it("gates a definition once with another nucleus-dom copy in the process", async () => {
    // a second module instance, as a second copy of the package
    const path = "../../src/custom-elements.ts?copy";
    const copy = (await import(/* @vite-ignore */ path)) as typeof import("../../src/custom-elements");
    const { window, document, dispose } = createDom();
    const log: string[] = [];
    window.customElements.define(
      "x-once",
      class extends window.HTMLElement {
        connectedCallback() {
          log.push("connected");
        }
      },
    );
    const registry = window.customElements as unknown as Record<symbol, Map<string, { lifecycleCallbacks: object }>>;
    const key = Object.getOwnPropertySymbols(registry).find((symbol) => symbol.description === "registry")!;
    const { lifecycleCallbacks } = registry[key].get("x-once")!;
    const gates = { ...lifecycleCallbacks };
    copy.upgradeClones(window);
    copy.loadPage(window, document.documentElement, `<x-once></x-once>`);
    expect([copy.upgradeClones === upgradeClones, lifecycleCallbacks, log]).toEqual([false, gates, ["connected"]]);
    await dispose();
  });
});
