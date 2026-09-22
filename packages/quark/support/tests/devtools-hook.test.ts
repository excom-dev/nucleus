/**
 * Quark side of the Nucleus DevTools probe. Mirrors
 * `neutron/support/tests/devtools-hook.test.ts`: install a hook, drive a
 * sheet, assert the publications and the renderer's `inspect()` snapshot.
 */
import { Quark } from "../../index";
import type { QuarkRenderer } from "../../src/devtools-hook";
import {
  type DevtoolsHook,
  type DevtoolsRenderer,
  NUCLEUS_DEVTOOLS_HOOK_KEY,
  pathMatches,
  type PublicizeMeta,
  type PublicizePath,
} from "@excom/kit-devtools";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { createSheet, flush } from "./helpers";

type Publication = { path: PublicizePath; meta: PublicizeMeta };

describe("Quark DevTools hook", () => {
  const publications: Publication[] = [];
  const injected: DevtoolsRenderer[] = [];

  const ofPath = (...tokens: string[]) =>
    publications.filter((p) => pathMatches(p.path, tokens));

  const quarkRenderer = () =>
    injected.find((r) => r.kind === "quark") as QuarkRenderer | undefined;

  const installHook = () => {
    const hook: DevtoolsHook = {
      version: 1,
      inject: (renderer) => {
        injected.push(renderer);
      },
      publicize: (path, meta) => {
        publications.push({ path, meta });
      },
    };
    Quark.attachDevtools(hook);
    return hook;
  };

  afterEach(() => {
    document.body.innerHTML = "";
    delete (globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY];
    publications.length = 0;
    injected.length = 0;
    vi.restoreAllMocks();
  });

  it("is dormant when no hook is installed", async () => {
    const { quark, register } = createSheet(
      `<p bind-x></p>`,
      `[bind-x] { content: "hi"; }`,
    );
    register();
    await flush();
    expect(publications).toHaveLength(0);
    quark.unregister();
  });

  it("injects the quark renderer on attach", () => {
    installHook();
    const renderer = quarkRenderer();
    expect(renderer).toBeDefined();
    expect(renderer!.version).toBe(1);
    expect(renderer!.kind).toBe("quark");
  });

  it("publicizes sheet registered / unregistered on the host", async () => {
    installHook();
    const { root, quark, register } = createSheet(
      `<p bind-x></p>`,
      `[bind-x] { content: "hi"; }`,
    );
    register();
    await flush();

    const registered = ofPath("quark", "sheet", "registered");
    expect(registered).toHaveLength(1);
    expect(registered[0].meta.tag).toBe("section");
    expect(registered[0].meta.sheetId).toBe(quark.id);
    expect(registered[0].meta.ruleCount).toBe(1);
    expect(registered[0].meta.isScoped).toBe(true);
    expect((registered[0].meta.weakElement as WeakRef<Element>).deref()).toBe(
      root,
    );

    quark.unregister();
    const unregistered = ofPath("quark", "sheet", "unregistered");
    expect(unregistered).toHaveLength(1);
    expect(unregistered[0].meta.sheetId).toBe(quark.id);
  });

  it("publicizes one apply per property with selector, key, expression and result", async () => {
    installHook();
    const { root, quark, register } = createSheet(
      `<article><p bind-x></p></article>`,
      `article {
        $greeting: "hi";
        p[bind-x] { content: $greeting; data-kind: "greeting"; }
      }`,
    );
    register();
    await flush();

    const applies = ofPath("quark", "apply");
    const p = root.querySelector("p")!;
    const article = root.querySelector("article")!;

    const variable = applies.find((a) => a.meta.key === "$greeting")!;
    expect(variable).toBeDefined();
    expect(variable.meta.kind).toBe("variable");
    expect(variable.meta.selector).toBe("article");
    expect(variable.meta.expression).toBe('"hi"');
    expect(variable.meta.result).toBe("hi");
    expect(variable.meta.tag).toBe("article");
    expect(variable.meta.isFirstRun).toBe(true);
    expect((variable.meta.weakElement as WeakRef<Element>).deref()).toBe(
      article,
    );

    const content = applies.find((a) => a.meta.key === "content")!;
    expect(content.meta.kind).toBe("content");
    expect(content.meta.selector).toBe("article p[bind-x]");
    expect(content.meta.result).toBe("hi");
    expect((content.meta.weakElement as WeakRef<Element>).deref()).toBe(p);

    const attribute = applies.find((a) => a.meta.key === "data-kind")!;
    expect(attribute.meta.kind).toBe("attribute");
    expect(attribute.meta.result).toBe("greeting");
    expect(attribute.meta.isWipe).toBe(false);
    expect(attribute.meta.isNoop).toBe(false);
    expect(typeof attribute.meta.sheetId).toBe("number");
    expect(typeof attribute.meta.ruleId).toBe("number");
    expect(typeof attribute.meta.runId).toBe("string");
    quark.unregister();
  });

  it("marks preserve as no-op and none as wipe", async () => {
    installHook();
    const { quark, register } = createSheet(
      `<p bind-x>stale</p>`,
      `[bind-x] { data-a: preserve; data-b: none; }`,
    );
    register();
    await flush();
    const a = ofPath("quark", "apply").find((p) => p.meta.key === "data-a")!;
    const b = ofPath("quark", "apply").find((p) => p.meta.key === "data-b")!;
    expect(a.meta.isNoop).toBe(true);
    expect(a.meta.result).toBeUndefined();
    expect(b.meta.isWipe).toBe(true);
    expect(b.meta.result).toBeNull();
    quark.unregister();
  });

  it("publicizes listener applies with functions tagged, not retained", async () => {
    installHook();
    const handler = () => {};
    const { quark, register } = createSheet(
      `<button bind-x></button>`,
      `[bind-x] { @on click (handle: handler); }`,
      { handler },
    );
    register();
    await flush();
    const listener = ofPath("quark", "apply").find(
      (p) => p.meta.key === "@on click (handle: handler)",
    )!;
    expect(listener.meta.kind).toBe("listener");
    expect(listener.meta.result).toEqual([{ $constructor: "Function" }]);
    quark.unregister();
  });

  it("publicizes an error when an expression fails", async () => {
    installHook();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { quark, register } = createSheet(
      `<p bind-x></p>`,
      `[bind-x] { content: "x".splice(0); }`,
    );
    register();
    await flush();
    const errors = ofPath("quark", "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].meta.key).toBe("content");
    expect(errors[0].meta.selector).toBe("[bind-x]");
    expect(errors[0].meta.expression).toBe('"x".splice(0)');
    expect(typeof errors[0].meta.errorMessage).toBe("string");
    // a failed expression still records an apply as a no-op
    const apply = ofPath("quark", "apply").find((p) => p.meta.key === "content")!;
    expect(apply.meta.isNoop).toBe(true);
    quark.unregister();
  });

  it("publishes content results as the author meant them, never as render plumbing", async () => {
    installHook();
    const { quark, register } = createSheet(
      `<section>
        <template id="t"><span id="from-template">hi</span></template>
        <div bind-tpl></div>
        <div bind-html></div>
        <ul bind-list><template><li class="row"></li></template></ul>
        <p bind-text></p>
      </section>`,
      `[bind-tpl] { content: template("#t"); }
       [bind-html] { content: dangerous-html("<b>bold</b>"); }
       [bind-list] { $items: items; content: iterate($items, none, "id"); }
       [bind-text] { content: "plain"; }`,
      { items: [{ id: "a" }, { id: "b" }] },
    );
    register();
    await flush();
    await flush();
    const content = (selector: string) =>
      ofPath("quark", "apply").find(
        (p) => p.meta.key === "content" && p.meta.selector === selector,
      )!;
    // template(): the promised { type: "nodes", value: [fragment] } → the nodes
    expect(content("[bind-tpl]").meta.result).toEqual([
      { $element: "span", id: "from-template" },
    ]);
    // dangerous-html(): the sync { type: "html", value } → the string
    expect(content("[bind-html]").meta.result).toBe("<b>bold</b>");
    // iterate(): the promised rows → the row elements
    expect(content("[bind-list]").meta.result).toEqual([
      { $element: "li", id: null },
      { $element: "li", id: null },
    ]);
    expect(content("[bind-text]").meta.result).toBe("plain");
    for (const p of ofPath("quark", "apply")) {
      expect(JSON.stringify(p.meta.result)).not.toContain("Promise");
    }
    quark.unregister();
  });

  it("inspect() snapshots vars, attributes, style props, listeners", async () => {
    installHook();
    const handler = () => {};
    const { root, quark, register } = createSheet(
      `<article><p bind-x></p></article>`,
      `article {
        $count: 3;
        $box: "open";
        $user: user;
        @on click (handle: handler);
        data-count: $count;
        --tone: "warm";
        p[bind-x] { content: $user.name; }
      }`,
      { handler, user: { name: "Ada" } },
    );
    register();
    await flush();

    const renderer = quarkRenderer()!;
    const article = root.querySelector("article")!;
    const p = root.querySelector("p")!;

    expect(renderer.isQuarkElement(article)).toBe(true);
    expect(renderer.inspect(document.createElement("div"))).toBeNull();

    const snap = renderer.inspect(article)!;
    expect(snap.tag).toBe("article");
    expect(snap.vars).toEqual({
      $count: 3,
      $box: "open",
      $user: { name: "Ada" },
    });
    expect(snap.attributes).toEqual({ "data-count": "3" });
    expect(snap.styleProperties).toEqual({ "--tone": "warm" });
    expect(snap.listeners).toEqual({
      "click (handle: handler)": [
        { $constructor: "Function", $expression: "handler" },
      ],
    });
    expect(snap.loop).toBeNull();
    expect(snap.sheets).toEqual([quark.hash]);

    const child = renderer.inspect(p)!;
    expect(child.vars).toEqual({});
    // content is tracked internally but is not an attribute
    expect(child.attributes).toEqual({});
    quark.unregister();
  });

  it("inspect() exposes iterate() row context", async () => {
    installHook();
    const { root, quark, register } = createSheet(
      `<ul><template><li></li></template></ul>`,
      `ul { $items: items; content: iterate($items, none, "id"); }`,
      { items: [{ id: "a" }, { id: "b" }] },
    );
    register();
    await flush();
    await flush();
    const rows = [...root.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    const snap = quarkRenderer()!.inspect(rows[1])!;
    expect(snap.loop).toEqual({ index: 1, key: "b" });
    quark.unregister();
  });

  it("inspect() reports partial loop context and unreadable vars", async () => {
    installHook();
    const { getQuarkInternal } = await import("../../src/quark-internal");
    const el = document.createElement("li");
    const internal = getQuarkInternal(el);
    internal.setLoopIndex(2);
    expect(quarkRenderer()!.inspect(el)!.loop).toEqual({ index: 2, key: null });
    internal.setLoopIndex(undefined);
    internal.setLoopKey("k");
    expect(quarkRenderer()!.inspect(el)!.loop).toEqual({ index: null, key: "k" });
    // a stored value whose read throws is reported, not propagated
    const broken: unknown[] = ["hash"];
    Object.defineProperty(broken, 1, {
      get() {
        throw new Error("boom");
      },
    });
    internal.vars.$broken = broken;
    const snap = quarkRenderer()!.inspect(el)!;
    expect(snap.vars).toEqual({ $broken: "[unreadable]" });
  });

  it("inspect() drops removed listeners, empty style values and unknown handler sources", async () => {
    installHook();
    const handler = () => {};
    const { root, quark, register } = createSheet(
      `<button bind-x></button>`,
      `[bind-x] { @on click (handle: handler); --tone: ""; }`,
      { handler },
    );
    register();
    await flush();
    const button = root.querySelector("button")!;
    const renderer = quarkRenderer()!;
    expect(renderer.inspect(button)!.styleProperties).toEqual({ "--tone": null });
    expect(renderer.inspect(button)!.listeners).toEqual({
      "click (handle: handler)": [
        { $constructor: "Function", $expression: "handler" },
      ],
    });
    // removing the slot empties the rule's array
    const { getQuarkInternal } = await import("../../src/quark-internal");
    const internal = getQuarkInternal(button);
    const ruleId = quark.rules[0].id;
    const slot = "@on click (handle: handler)";
    internal.removeAllListeners(quark.hash, ruleId, slot);
    expect(internal.getListeners(quark.hash, ruleId, slot)).toEqual([]);
    expect(renderer.inspect(button)!.listeners).toEqual({});
    // re-attach, then unregister: the rule can no longer be looked up
    internal.setOrderedListeners(quark.hash, ruleId, slot, [handler], {
      eventTypes: ["click"],
      target: button,
      options: {},
    });
    quark.unregister();
    expect(renderer.inspect(button)!.listeners).toEqual({
      "click (handle: handler)": [{ $constructor: "Function", $expression: null }],
    });
  });

  describe("agent tooling", () => {
    it("sheets() lists registered sheets with their rules and declarations", async () => {
      installHook();
      const { root, quark, register } = createSheet(
        `<p bind-x></p>`,
        `[bind-x] { $n: 1; content: "hi"; @on click (handle: log); [bind-y] { title: "t"; } }`,
        { log: () => {} },
      );
      register();
      await flush();
      const sheet = quarkRenderer()!
        .sheets()
        .find((s) => s.sheetId === quark.id)!;
      expect(sheet).toMatchObject({
        hash: quark.hash,
        host: root,
        isScoped: true,
        isRegistered: true,
        ruleCount: 2,
        src: quark.src,
      });
      expect(sheet.scopeId).toBe(quark.scopeId);
      expect(sheet.rules[0]).toMatchObject({
        sheetId: quark.id,
        ruleId: quark.rules[0].id,
        selector: "[bind-x]",
        isScoped: true,
        declarations: [
          { key: "$n", value: "1" },
          { key: "content", value: '"hi"' },
        ],
        listeners: [
          {
            key: "@on click (handle: log)",
            events: ["click"],
            handlers: "log",
            hasBlock: false,
          },
        ],
      });
      expect(sheet.rules[0].numberOfRuns).toBeGreaterThan(0);
      expect(sheet.rules[1].selector).toBe("[bind-x] [bind-y]");
      quark.unregister();
      expect(
        quarkRenderer()!
          .sheets()
          .find((s) => s.sheetId === quark.id),
      ).toBeUndefined();
    });

    it("sheets() reports block listeners and unregistered-but-alive sheets", async () => {
      installHook();
      const { quark, register } = createSheet(
        `<button bind-x></button>`,
        `[bind-x] { @on click { data-hit: "1"; } }`,
      );
      register();
      await flush();
      const sheet = quarkRenderer()!
        .sheets()
        .find((s) => s.sheetId === quark.id)!;
      expect(sheet.rules[0].listeners).toEqual([
        { key: "@on click", events: ["click"], handlers: "", hasBlock: true },
      ]);
      quark.unregister();
    });

    it("matchingRules() returns the rules matching an element, scope-aware, in order", async () => {
      installHook();
      const a = createSheet(
        `<p bind-x class="one"></p><p bind-x class="two"></p>`,
        `[bind-x] { content: "a"; } .two { content: "b"; } :scope { $root: 1; }`,
      );
      a.register();
      const b = createSheet(
        `<p bind-x class="three"></p>`,
        `[bind-x] { content: "c"; }`,
      );
      b.register();
      await flush();
      const renderer = quarkRenderer()!;
      const one = a.root.querySelector(".one")!;
      const two = a.root.querySelector(".two")!;
      const three = b.root.querySelector(".three")!;
      expect(renderer.matchingRules(one).map((r) => r.selector)).toEqual(["[bind-x]"]);
      expect(renderer.matchingRules(two).map((r) => [r.sheetId, r.selector])).toEqual([
        [a.quark.id, "[bind-x]"],
        [a.quark.id, ".two"],
      ]);
      // sheet b is host-scoped: its rule never reaches sheet a's elements
      expect(renderer.matchingRules(three).map((r) => r.sheetId)).toEqual([b.quark.id]);
      // `:scope` rules match the host itself
      expect(renderer.matchingRules(a.root).map((r) => r.selector)).toEqual([":scope"]);
      expect(renderer.matchingRules(document.body)).toEqual([]);
      a.quark.unregister();
      b.quark.unregister();
      expect(renderer.matchingRules(one)).toEqual([]);
    });

    it("evaluate() resolves bindings, attr(), prop() and @use modules on an element", async () => {
      installHook();
      const { root, quark, register } = createSheet(
        `<p bind-x data-n="3"></p>`,
        `[bind-x] { $n: 2; }`,
        { double: (n: number) => n * 2 },
      );
      register();
      await flush();
      const el = root.querySelector("p")!;
      (el as any).provision = { ok: true };
      const renderer = quarkRenderer()!;
      expect(renderer.evaluate(el, "$n + 1")).toBe(3);
      expect(renderer.evaluate(el, 'attr("data-n")')).toBe("3");
      expect(renderer.evaluate(el, 'prop("provision").ok')).toBe(true);
      expect(renderer.evaluate(el, "double($n)", quark.id)).toBe(4);
      expect(renderer.evaluate(el, '"n is #{$n}"')).toBe("n is 2");
      // an unknown sheet id still evaluates, without modules
      expect(() => renderer.evaluate(el, "double($n)", -1)).toThrow(/double/);
      expect(() => renderer.evaluate(el, "nope(")).toThrow();
      quark.unregister();
      // no sheets at all: bindings and attr() still work, modules do not
      expect(renderer.evaluate(el, 'attr("data-n")')).toBe("3");
    });
  });
});
