/**
 * Runaway orchestration loops are cut by the shared loop guard
 * (kit-utils): attr ↔ attr between rules, a self-feeding attr, a
 * sync `$binding` cycle across sheets, content that re-matches its own
 * paint, and a Quark ↔ Neutron cycle through an element's provision.
 * Legitimate chains and repeated external triggers never trip. Trips
 * reach DevTools as `quark/error`; write cycles between rules are
 * warned at build.
 */
import { Quark } from "../../index";
import { warnStaticCycles } from "../../src/cycle-check";
import { getQuarkInternal } from "../../src/quark-internal";
import { QuarkLogger } from "../../src/utils";
import {
  type DevtoolsHook,
  NUCLEUS_DEVTOOLS_HOOK_KEY,
  pathMatches,
  type PublicizeMeta,
  type PublicizePath,
} from "@excom/kit-devtools";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fixture,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import "@excom/provider-storage";
import { LoopGuard, type LoopGuardTrip } from "@excom/kit-utils";
import { flush, mount, unregisterAll } from "./helpers";

describe("Quark: loop guard", () => {
  let trips: LoopGuardTrip[];
  let off: () => void;

  beforeEach(() => {
    LoopGuard.reset();
    LoopGuard.configure({ limit: 8, log: () => {} });
    trips = [];
    off = LoopGuard.onTrip((trip) => trips.push(trip));
  });

  afterEach(() => {
    off();
    LoopGuard.reset();
    unregisterAll();
    document.body.innerHTML = "";
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** Flush until `done()` holds (a runaway loop needs many rounds). */
  const settle = async (done: () => boolean, rounds = 60) => {
    for (let i = 0; i < rounds && !done(); i++) await flush();
  };

  const ruleRuns = (quark: Quark) =>
    quark.rules.reduce((sum, rule) => sum + rule.numberOfRuns, 0);

  it("never re-runs a declaration on the attribute that triggered it (built-in)", async () => {
    // a rule writing its own gate cannot loop on its own: Quark skips the
    // property whose key is the mutation that woke the rule
    const { root, quark } = mount(
      `<p data-tick="a"></p>`,
      `p[data-tick="a"] { data-tick: "b"; }
       p[data-tick="b"] { data-tick: "a"; }`
    );
    const p = root.querySelector("p")!;
    await flush();
    await flush();
    expect(p.getAttribute("data-tick")).toBe("b");
    expect(ruleRuns(quark)).toBeLessThanOrEqual(4);
    expect(trips).toEqual([]);
  });

  it("cuts an attribute toggle cycling through two attributes", async () => {
    const { root, quark } = mount(
      `<p data-a="1"></p>`,
      `p[data-a="1"] { data-b: "1"; }
       p[data-b="1"] { data-a: "2"; }
       p[data-a="2"] { data-b: "2"; }
       p[data-b="2"] { data-a: "1"; }`
    );
    const p = root.querySelector("p")!;
    await settle(() => trips.length > 0);
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect(trips[0]).toMatchObject({ kind: "depth", target: p, limit: 8 });
    expect(["data-a", "data-b"]).toContain(trips[0].name);
    // the loop is dead: nothing changes any more
    const runs = ruleRuns(quark);
    const value = [p.getAttribute("data-a"), p.getAttribute("data-b")];
    await flush();
    await flush();
    expect([p.getAttribute("data-a"), p.getAttribute("data-b")]).toEqual(value);
    expect(ruleRuns(quark)).toBe(runs);
    expect(runs).toBeLessThanOrEqual((LoopGuard.limit + 2) * 4);
  });

  it("cuts two rules that toggle each other's class", async () => {
    // `class:` is exempt from the "not re-run by its own trigger" skip,
    // so this pair really cycles; map and string writes are guarded hops
    const { root, quark } = mount(
      `<p class="is-a"></p><i class="is-a"></i>`,
      `p.is-a { class: (is-a: false, is-b: true); }
       p.is-b { class: (is-b: false, is-a: true); }
       i.is-a { class: "is-b"; }
       i.is-b { class: "is-a"; }`
    );
    const p = root.querySelector("p")!;
    const i = root.querySelector("i")!;
    await settle(() => new Set(trips.map((trip) => trip.target)).size === 2);
    expect(trips.map((trip) => trip.name)).toContain("class");
    expect(new Set(trips.map((trip) => trip.target))).toEqual(new Set([p, i]));
    const runs = ruleRuns(quark);
    const value = [p.className, i.className];
    await flush();
    await flush();
    expect([p.className, i.className]).toEqual(value);
    expect(ruleRuns(quark)).toBe(runs);
  });

  it("cuts two rules that keep growing each other's attribute", async () => {
    const { root } = mount(
      `<p data-n=""></p>`,
      `p[data-n] { data-m: attr("data-n") + "x"; }
       p[data-m] { data-n: attr("data-m"); }`
    );
    const p = root.querySelector("p")!;
    await settle(() => trips.length > 0);
    expect(trips[0].kind).toBe("depth");
    expect(["data-n", "data-m"]).toContain(trips[0].name);
    expect(p.getAttribute("data-m")!.length).toBeLessThanOrEqual(
      LoopGuard.limit + 1
    );
  });

  it("does not trip a finite chain of dependent rules", async () => {
    const steps = 12;
    const src = Array.from(
      { length: steps },
      (_, i) => `p[data-s${i}] { data-s${i + 1}: "1"; }`
    ).join("\n");
    LoopGuard.configure({ limit: steps + 3 });
    const { root } = mount(`<p data-s0="1"></p>`, src);
    const p = root.querySelector("p")!;
    await settle(() => p.hasAttribute(`data-s${steps}`));
    expect(p.getAttribute(`data-s${steps}`)).toBe("1");
    expect(trips).toEqual([]);
  });

  it("starts a fresh chain for every external trigger", async () => {
    LoopGuard.configure({ limit: 3 });
    const { root } = mount(
      `<p data-n="0"></p>`,
      `p[data-n] { data-copy: attr("data-n"); }`
    );
    const p = root.querySelector("p")!;
    for (let i = 1; i <= 12; i++) {
      p.setAttribute("data-n", String(i));
      await flush();
    }
    expect(p.getAttribute("data-copy")).toBe("12");
    expect(trips).toEqual([]);
  });

  it("cuts a synchronous $binding cycle across two sheets", () => {
    const root = fixture<HTMLElement>(
      `<section><div id="s1"></div><div id="s2"></div></section>`
    );
    const sheet1 = new Quark({
      src: `:scope { $a: ($b or 0) + 1; }`,
      options: { isScoped: true },
    });
    const sheet2 = new Quark({
      src: `:scope { $b: ($a or 0) + 1; }`,
      options: { isScoped: true },
    });
    sheet1.register({ sheetElement: root.querySelector("#s1") as HTMLElement });
    // registering the second sheet starts the ping-pong synchronously:
    // without the guard this is a stack overflow
    expect(() =>
      sheet2.register({
        sheetElement: root.querySelector("#s2") as HTMLElement,
      })
    ).not.toThrow();
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect(trips[0].kind).toBe("depth");
    expect(["$a", "$b"]).toContain(trips[0].name);
    const vars = getQuarkInternal(root);
    expect(vars.getVar("$a") as number).toBeLessThanOrEqual(LoopGuard.limit + 2);
    expect(vars.getVar("$b") as number).toBeLessThanOrEqual(LoopGuard.limit + 2);
  });

  it("cuts content that re-matches its own paint", async () => {
    const { root } = mount(
      `<div id="d"></div>`,
      `div { content: dangerous-html("<div></div>"); }`
    );
    await settle(() => trips.length > 0);
    expect(trips[0]).toMatchObject({ kind: "depth", name: "content" });
    // nesting is bounded by the limit instead of growing forever
    let depth = 0;
    for (let el = root.querySelector("#d"); el; el = el.firstElementChild) {
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(LoopGuard.limit + 2);
  });

  it("cuts a Quark ↔ Neutron cycle through an element's provision", async () => {
    localStorage.setItem("ping", JSON.stringify({ next: "pong" }));
    localStorage.setItem("pong", JSON.stringify({ next: "ping" }));
    const { root } = mount(
      `<provider-storage key-name="ping"></provider-storage>`,
      `provider-storage { key-name: prop("provision").next; }`
    );
    const provider = root.querySelector("provider-storage") as any;
    await settle(() => trips.length > 0);
    expect(trips.length).toBeGreaterThanOrEqual(1);
    expect(trips[0].kind).toBe("depth");
    // the write was dropped, never half-applied: attribute and provision agree
    const key = provider.getAttribute("key-name");
    expect(["ping", "pong"]).toContain(key);
    expect(provider.provision).toEqual(JSON.parse(localStorage.getItem(key)!));
    const runsBefore = trips.length;
    await flush();
    await flush();
    expect(provider.getAttribute("key-name")).toBe(key);
    expect(trips.length).toBe(runsBefore);
  });

  it("publishes trips to DevTools as quark/error", () => {
    const publications: { path: PublicizePath; meta: PublicizeMeta }[] = [];
    const hook: DevtoolsHook = {
      version: 1,
      inject: () => {},
      publicize: (path, meta) => {
        publications.push({ path, meta });
      },
    };
    Quark.attachDevtools(hook);
    try {
      const el = fixture<HTMLElement>(`<p></p>`);
      LoopGuard.run(LoopGuard.limit, () =>
        LoopGuard.write(el, "data-x", () => el.setAttribute("data-x", "1"))
      );
      expect(el.hasAttribute("data-x")).toBe(false);
      const errors = publications.filter((p) =>
        pathMatches(p.path, ["quark", "error"])
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].meta).toMatchObject({
        tag: "p",
        key: "data-x",
        errorName: "LoopGuardDepth",
      });
      expect((errors[0].meta.weakElement as WeakRef<Element>).deref()).toBe(el);
      expect(String(errors[0].meta.errorMessage)).toContain("Loop guard");
    } finally {
      delete (globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY];
    }
  });

  describe("static write-cycle warning", () => {
    const build = (src: string) =>
      new Quark({ src, options: { isScoped: true } });

    it("warns once about rules that gate on each other's writes", () => {
      const warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
      const quark = build(
        `p[data-a="1"] { data-b: "1"; }
         p[data-b="1"] { data-a: "2"; }
         p[data-c] { data-d: "1"; }`
      );
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0].message);
      expect(message).toContain('`p[data-a="1"]` writes [data-b]');
      expect(message).toContain('`p[data-b="1"]` writes [data-a]');
      expect(message).not.toContain("data-c");
      const cycles = warnStaticCycles(quark);
      expect(cycles).toHaveLength(1);
      expect(cycles[0].map((rule) => rule.selector).sort()).toEqual([
        'p[data-a="1"]',
        'p[data-b="1"]',
      ]);
    });

    it("counts literal attr() reads as gates", () => {
      const warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
      build(
        `p { data-b: attr("data-a"); }
         p[data-b] { data-a: "1"; }`
      );
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("finds longer cycles", () => {
      const warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
      const quark = build(
        `p[data-a] { data-b: "1"; }
         p[data-b] { data-c: "1"; }
         p[data-c] { data-a: "1"; }`
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warnStaticCycles(quark)[0]).toHaveLength(3);
    });

    it("ignores self-edges, chains, non-attribute keys and @on blocks", () => {
      const warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
      const quark = build(
        `input[value] { value: "1"; }
         p[data-a] { data-b: "1"; }
         p[data-b] { data-c: "1"; }
         p[data-c] { content: "x"; --c: "1"; dataset: none; class: "z"; }
         p[data-e] { @on click { data-f: "1"; } }
         p[data-f] { data-e: "1"; }`
      );
      expect(warn).not.toHaveBeenCalled();
      expect(warnStaticCycles(quark)).toEqual([]);
    });
  });
});
