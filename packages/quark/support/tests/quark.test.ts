import { Quark } from "../../index";
import { deref, minifyQuark, stringToHash } from "../../src/utils";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  createSheet,
  expectComplexity,
  flush,
  measureComplexity,
  mount,
} from "./helpers";

const SCALE = 50;

const repeatHtml = (count: number, render: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => render(i)).join("");

describe("quark utils", () => {
  it("hashes strings deterministically", () => {
    expect(stringToHash("abc")).toBe(stringToHash("abc"));
    expect(stringToHash("abc")).not.toBe(stringToHash("abcd"));
  });

  it("normalizes whitespace but leaves comments to the parser", () => {
    const input =
      "/* comment */\n\n  .foo {   color:   red; } // line\n\n\n.bar { x: 1; }";
    const result = minifyQuark(input);
    expect(result).toBe(
      "/* comment */\n.foo { color: red; } // line\n.bar { x: 1; }"
    );
  });

  it("keeps // inside string literals intact", () => {
    const input = '@use "https://cdn.example.com/x.js" as api;';
    expect(minifyQuark(input)).toBe(input);
  });

  it("dereferences values and WeakRefs", () => {
    const el = document.createElement("div");
    const ref = new WeakRef(el);
    expect(deref(el)).toBe(el);
    expect(deref(ref)).toBe(el);
  });
});

describe("happy-dom querySelectorAll shim", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("matches ancestors outside the query root (browser semantics)", () => {
    const root = fixture<HTMLElement>(`<div id="outer">
      <div id="subject"><div id="inner"></div></div>
    </div>`);
    const subject = root.querySelector("#subject")!;
    expect(subject.querySelectorAll("#outer #inner")).toHaveLength(1);
    expect(subject.querySelector("#outer #inner")?.id).toBe("inner");
  });

  it("never returns the query root itself (browser semantics)", () => {
    const root = fixture<HTMLElement>(`<section><section></section></section>`);
    expect(root.querySelectorAll("section")).toHaveLength(1);
    expect(root.querySelector("section")).not.toBe(root);
  });

  it("resolves :scope via a temporary marker on the query root", () => {
    const root = fixture<HTMLElement>(
      `<div><div id="subject"><span class="child"></span></div></div>`
    );
    const subject = root.querySelector("#subject")!;
    expect(subject.querySelectorAll(":scope > .child")).toHaveLength(1);
    expect(subject.querySelector(":scope > .child")?.className).toBe("child");
  });
});

describe("Quark", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mutates matching bind targets on register", async () => {
    const body = `<main>${repeatHtml(
      SCALE,
      (i) => `<span bind-label data-i="${i}"></span>`
    )}</main>`;
    const { root, quark, register } = createSheet(
      body,
      `[bind-label] { data-ready: ""; }`
    );
    const meter = measureComplexity(quark);
    register();
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.querySelectorAll("[bind-label][data-ready]")).toHaveLength(
      SCALE
    );
    expectComplexity(budget);
    quark.unregister();
  });

  it("mutates elements rendered after register", async () => {
    const { root, quark, register } = createSheet(
      ``,
      `span { data-name: "my-span"; }`
    );
    register();
    await flush();

    const meter = measureComplexity(quark);
    const span = document.createElement("span");
    root.appendChild(span);
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(span.getAttribute("data-name")).toBe("my-span");
    expectComplexity(budget);
    quark.unregister();
  });

  it("removes an attribute with none", async () => {
    const { root, quark, register } = createSheet(
      `<span data-name="stale"></span>`,
      `span { data-name: none; }`
    );
    const meter = measureComplexity(quark);
    register();
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.querySelector("span")?.hasAttribute("data-name")).toBe(false);
    expectComplexity(budget);
    quark.unregister();
  });

  it("sets text content from a string", async () => {
    const { root, quark, register } = createSheet(
      `<p></p>`,
      `p { content: "hello"; }`
    );
    const meter = measureComplexity(quark);
    register();
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.querySelector("p")?.textContent).toBe("hello");
    expectComplexity(budget);
    quark.unregister();
  });

  it("passes nested variables into child content", async () => {
    const { root, quark, register } = createSheet(
      `<main><span bind-msg></span></main>`,
      `main {
        $msg: "hi";
        [bind-msg] { content: $msg; }
      }`
    );
    const meter = measureComplexity(quark);
    register();
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.querySelector("[bind-msg]")?.textContent).toBe("hi");
    expectComplexity(budget);
    quark.unregister();
  });

  it("calls registered module functions for attributes and listeners", async () => {
    const handleClick = vi.fn();
    const { root, quark, register } = createSheet(
      `<button type="button" id="target"></button>`,
      `#target {
        data-label: getLabel();
        @on click (handle: handleClick);
      }`,
      {
        getLabel: () => "from-js",
        handleClick,
      }
    );
    const meter = measureComplexity(quark);
    register();
    await flush();
    const budget = meter.take();
    meter.stop();

    const button = root.querySelector("#target") as HTMLButtonElement;
    expect(button.getAttribute("data-label")).toBe("from-js");
    button.click();
    expect(handleClick).toHaveBeenCalledTimes(1);
    expectComplexity(budget);
    quark.unregister();
  });

  it("reads .provision via prop() and re-runs when it is assigned", async () => {
    const root = fixture<HTMLElement>(`<section>
      <div id="sheet"></div>
      <data-provider is-success>
        <span bind-title></span>
      </data-provider>
    </section>`);
    const provider = root.querySelector("data-provider") as HTMLElement & {
      provision?: { title: string };
    };
    provider.provision = { title: "Hello" };

    const quark = new Quark({
      options: { isScoped: true },
      src: `data-provider[is-success] {
        $todo: prop("provision");
        [bind-title] { content: $todo.title; }
      }`,
    });
    const meter = measureComplexity(quark);
    quark.register({
      sheetElement: root.querySelector("#sheet") as HTMLElement,
    });
    await flush();
    expect(root.querySelector("[bind-title]")?.textContent).toBe("Hello");

    provider.provision = { title: "Hello, world!" };
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(root.querySelector("[bind-title]")?.textContent).toBe(
      "Hello, world!"
    );
    expectComplexity(budget);
    quark.unregister();
  });

  it("iterates an array into a template", async () => {
    const items = Array.from({ length: SCALE }, (_, i) => ({
      label: `item-${i}`,
    }));
    const root = fixture<HTMLElement>(`<section>
      <div id="sheet"></div>
      <data-provider is-success>
        <ul>
          <template><li bind-label></li></template>
        </ul>
      </data-provider>
    </section>`);
    const provider = root.querySelector("data-provider") as HTMLElement & {
      provision?: { label: string }[];
    };
    provider.provision = items;

    const quark = new Quark({
      options: { isScoped: true },
      src: `data-provider[is-success] {
        $items: prop("provision");
        ul { content: iterate($items); }
        [bind-label] { content: item.label; }
      }`,
    });
    const meter = measureComplexity(quark);
    quark.register({
      sheetElement: root.querySelector("#sheet") as HTMLElement,
    });
    await flush();

    const rows = [...root.querySelectorAll("ul > li")];
    expect(rows).toHaveLength(SCALE);

    // the iterate paint's insertions reach the row rules via childList
    const budget = meter.take();
    meter.stop();

    expect(rows.map((el) => el.textContent)).toEqual(
      items.map((item) => item.label)
    );
    expectComplexity(budget);
    quark.unregister();
  });

  it("re-runs when a watched attribute changes", async () => {
    const body = `<details>${repeatHtml(
      SCALE,
      () => `<p bind-status></p>`
    )}</details>`;
    const { root, quark, register } = createSheet(
      body,
      `details[open] [bind-status] {
        content: "open";
      }
      details:not([open]) [bind-status] {
        content: none;
      }`
    );
    // Spy before register so MutationObserver closes over the wrapper.
    const spy = vi.spyOn(quark, "queueRunRules");
    register();
    await flush();
    spy.mockClear();

    const details = root.querySelector("details")!;
    details.setAttribute("open", "");
    await wait(0);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ attribute: "open", element: details })
    );

    const meter = measureComplexity(quark);
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(
      [...root.querySelectorAll("[bind-status]")].every(
        (el) => el.textContent === "open"
      )
    ).toBe(true);
    expectComplexity(budget);
    quark.unregister();
  });

  it("activates many articles when data-active is set", async () => {
    const body = `<main>${repeatHtml(
      SCALE,
      (i) => `<article data-id="${i}"><span bind-label></span></article>`
    )}</main>`;
    const { root, quark } = mount(
      body,
      `article[data-active] [bind-label] {
        content: "active";
      }`
    );
    await flush();

    for (const article of root.querySelectorAll("article")) {
      article.setAttribute("data-active", "");
    }
    const meter = measureComplexity(quark);
    await flush();
    const budget = meter.take();
    meter.stop();

    expect(
      [...root.querySelectorAll("[bind-label]")].map((el) => el.textContent)
    ).toEqual(Array.from({ length: SCALE }, () => "active"));
    expectComplexity(budget);
    quark.unregister();
  });
});
