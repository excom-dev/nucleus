/**
 * `element.quark`: the JS side of bindings (`setProperty` /
 * `setProperties` / `removeProperty` / `getPropertyValue`) on every
 * element, and how sheets react to those writes.
 */
import { Quark } from "../../index";
import { BINDING_CHANGE_EVENT } from "../../src/bindings";
import { installElementApi, QuarkElementApi } from "../../src/element-api";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { createSheet, flush, mount, unregisterAll } from "./helpers";

describe("element.quark", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
  });

  it("is a lazy, stable accessor on every element, SVG included", () => {
    const div = document.createElement("div");
    expect(div.quark).toBeInstanceOf(QuarkElementApi);
    expect(div.quark).toBe(div.quark);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "g");
    expect(svg.quark).toBeInstanceOf(QuarkElementApi);
    expect(svg.quark).not.toBe(div.quark);
    // not enumerable: never serialized alongside real properties
    expect(Object.keys(div)).not.toContain("quark");
  });

  it("installs once and stays configurable", () => {
    const before = Object.getOwnPropertyDescriptor(Element.prototype, "quark");
    installElementApi();
    expect(
      Object.getOwnPropertyDescriptor(Element.prototype, "quark")?.get
    ).toBe(before?.get);
    expect(before?.configurable).toBe(true);
    // a foreign prototype gets its own accessor
    const proto = {};
    installElementApi(proto);
    expect(typeof Object.getOwnPropertyDescriptor(proto, "quark")?.get).toBe(
      "function"
    );
  });

  it("writes a binding on the owner and re-runs readers below it", async () => {
    const { root, quark } = mount(
      `<main><span bind-x></span></main>`,
      `main { $x: "a"; }
       [bind-x] { content: $x; }`
    );
    await flush();
    const main = root.querySelector("main")!;
    expect(root.querySelector("[bind-x]")?.textContent).toBe("a");
    expect(main.quark.setProperty("$x", "b")).toBe(true);
    await flush();
    expect(root.querySelector("[bind-x]")?.textContent).toBe("b");
    // same value: no change, no re-run
    const runs = quark.rules[1].numberOfRuns;
    expect(main.quark.setProperty("x", "b")).toBe(false);
    await flush();
    expect(quark.rules[1].numberOfRuns).toBe(runs);
  });

  it("works on an element no rule matched and shadows an ancestor's binding", async () => {
    const { root } = mount(
      `<main><section><span bind-x></span></section></main>`,
      `main { $x: "outer"; }
       [bind-x] { content: $x; }`
    );
    await flush();
    const section = root.querySelector("section")!;
    section.quark.setProperty("$x", "inner");
    await flush();
    expect(root.querySelector("[bind-x]")?.textContent).toBe("inner");
    expect(section.quark.getPropertyValue("$x")).toBe("inner");
    // removeProperty = unset: the reader falls through to the ancestor
    expect(section.quark.removeProperty("$x")).toBe(true);
    await flush();
    expect(root.querySelector("[bind-x]")?.textContent).toBe("outer");
    expect(section.quark.getPropertyValue("x")).toBe("outer");
    expect(section.quark.removeProperty("$x")).toBe(false);
  });

  it("getPropertyValue resolves upward like a rule would", () => {
    const root = fixture<HTMLElement>(
      `<div><main><section><span></span></section></main></div>`
    );
    const main = root.querySelector("main")!;
    const span = root.querySelector("span")!;
    expect(span.quark.getPropertyValue("$missing")).toBeUndefined();
    main.quark.setProperty("$list", [1, 2]);
    expect(span.quark.getPropertyValue("$list")).toEqual([1, 2]);
    // by value: a new object is a change, an equal one is not
    expect(main.quark.setProperty("$list", [1, 2])).toBe(false);
    expect(main.quark.setProperty("$list", [1, 2, 3])).toBe(true);
  });

  it("setProperties stores every value before announcing any of them", async () => {
    const { root } = mount(
      `<main><span bind-sum></span></main>`,
      `main { $a: 1; $b: 1; }
       [bind-sum] { content: "#{$a}+#{$b}"; }`
    );
    await flush();
    const main = root.querySelector("main")!;
    const seen: string[] = [];
    root.addEventListener(BINDING_CHANGE_EVENT, () => {
      seen.push(root.querySelector("[bind-sum]")?.textContent ?? "");
      seen.push(`${main.quark.getPropertyValue("$a")}/${main.quark.getPropertyValue("$b")}`);
    });
    expect(main.quark.setProperties({ $a: 2, b: 3 })).toBe(true);
    await flush();
    expect(root.querySelector("[bind-sum]")?.textContent).toBe("2+3");
    // both values were stored when the first change event fired
    expect(seen[1]).toBe("2/3");
    expect(main.quark.setProperties({ $a: 2, $b: 3 })).toBe(false);
  });

  it("tags the change event with sheetId null for DevTools", () => {
    const el = fixture<HTMLElement>(`<div></div>`);
    const heard = vi.fn();
    el.addEventListener(BINDING_CHANGE_EVENT, (e) =>
      heard((e as CustomEvent).detail)
    );
    el.quark.setProperty("$k", 1);
    expect(heard).toHaveBeenCalledWith(
      expect.objectContaining({ name: "$k", sheetId: null })
    );
  });

  it("is State, not an event: a write before the sheet registers is read on the first run", async () => {
    const { root, register } = createSheet(
      `<main><span bind-x></span></main>`,
      `[bind-x] { content: $x; }`
    );
    root.querySelector("main")!.quark.setProperty("$x", "early");
    register();
    await flush();
    expect(root.querySelector("[bind-x]")?.textContent).toBe("early");
  });

  it("reaches readers in another sheet below the owner", async () => {
    const root = fixture<HTMLElement>(
      `<div><main><div id="s1"></div><section><div id="s2"></div><span bind-x></span></section></main></div>`
    );
    const outer = new Quark({ src: `:scope { $x: "one"; }`, options: { isScoped: true } });
    outer.register({ sheetElement: root.querySelector("#s1") as HTMLElement });
    const inner = new Quark({ src: `[bind-x] { content: $x; }`, options: { isScoped: true } });
    inner.register({ sheetElement: root.querySelector("#s2") as HTMLElement });
    await flush();
    expect(root.querySelector("[bind-x]")?.textContent).toBe("one");
    root.querySelector("main")!.quark.setProperty("$x", "two");
    await flush();
    expect(root.querySelector("[bind-x]")?.textContent).toBe("two");
  });

  it("a rule's def re-running rewrites a JS value (last writer wins)", async () => {
    const { root } = mount(
      `<main><span bind-x></span></main>`,
      `main { $x: attr("data-mode"); }
       [bind-x] { content: $x; }`
    );
    await flush();
    const main = root.querySelector("main")!;
    main.quark.setProperty("$x", "js");
    await flush();
    expect(root.querySelector("[bind-x]")?.textContent).toBe("js");
    // the def's dependency changes: the rule writes again and wins
    main.setAttribute("data-mode", "rule");
    await flush();
    expect(root.querySelector("[bind-x]")?.textContent).toBe("rule");
  });

  it("lets a @use handler raise state without a signal box", async () => {
    const { root } = mount(
      `<div data-demo-counter><button></button><output></output></div>`,
      `:scope { $count: 0; }
       button { @on click (handle: bump(closest("[data-demo-counter]"))); }
       output { content: "#{$count}"; }`,
      {
        bump: (owner: Element) => () => {
          owner.quark.setProperty(
            "$count",
            ((owner.quark.getPropertyValue("$count") as number) ?? 0) + 1
          );
        },
      }
    );
    await flush();
    const button = root.querySelector("button")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(root.querySelector("output")?.textContent).toBe("2");
  });
});
