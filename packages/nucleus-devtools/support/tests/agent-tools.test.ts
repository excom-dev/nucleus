/**
 * Agent tools against the real producers: the probe is installed on the
 * page global, a `<quark-sheet>` and a Neutron element publish through it,
 * and every tool is exercised through `__NUCLEUS_DEVTOOLS__.tools`.
 * Fake-renderer cases cover degraded pages (no Quark, old runtime).
 */
import "@excom/nucleus-kit";
import { AGENT_TOOL_GROUP, compact, createAgentTools, cssPath, toJson } from "../../lib/agent-tools";
import type { Heatmap } from "../../lib/heatmap";
import { installPageProbe } from "../../lib/install";
import { createPageHook } from "../../lib/page-hook-core";
import {
  HOOK_KEY,
  PAGE_API_KEY,
  type PageDevtoolsApi,
  type PageRenderer,
  type RendererKind,
} from "../../lib/protocol";
import { Neutron } from "@excom/neutron";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const g = globalThis as Record<string, unknown>;

const settle = async () => {
  for (let i = 0; i < 8; i++) await wait(0);
};

type Tools = Record<string, (input?: Record<string, unknown>) => unknown>;

const api = () => g[PAGE_API_KEY] as PageDevtoolsApi;
const tools = () => api().tools as Tools;

let defined = false;
const defineElement = () => {
  if (defined) return;
  defined = true;
  Neutron({
    tag: "x-agent",
    props: {
      isOn: Boolean,
      // non-dashed attribute on purpose: the definition audit flags it
      tone: String,
      provision: Object,
    },
  })
    .onPropChanged("isOn", ({ isOn }) => ({ tone: isOn ? "loud" : "quiet" }))
    .define();
};

const mount = async () => {
  const host = document.createElement("div");
  host.id = "app";
  host.innerHTML = `
    <quark-sheet>
      :scope { $count: 2; }
      [bind-x] { data-n: "#{$count}"; content: "hello #{$count}"; }
      [data-role="never"] { is-open: ""; data-n: "9"; }
      [bind-bad] { content: explode(); }
    </quark-sheet>
    <p bind-x></p>
    <x-agent id="agent"></x-agent>
    <section><span>a</span><span>b</span><script>1</script></section>
    <p bind-bad></p>
  `;
  document.body.append(host);
  await settle();
  return host;
};

describe("agent tools (integration)", () => {
  let probe: NonNullable<ReturnType<typeof installPageProbe>>;
  let host: HTMLElement;

  // one probe for the whole suite: `neutron/defined` publishes once per define()
  beforeAll(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete g[HOOK_KEY];
    delete g[PAGE_API_KEY];
    probe = installPageProbe({ announce: true })!;
    defineElement();
  });

  afterAll(() => {
    probe.unregister();
    delete g[HOOK_KEY];
    delete g[PAGE_API_KEY];
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    host = await mount();
  });

  afterEach(() => {
    host.remove();
  });

  it("installs once: the API lists every tool and a second install is a no-op", () => {
    expect(installPageProbe()).toBeNull();
    const names = api().listTools!().map((t) => t.name);
    expect(names).toEqual([
      "diagnostics",
      "state_snapshot",
      "inspect_element",
      "explain_attribute",
      "list_sheets",
      "matching_rules",
      "evaluate_expression",
      "trace",
      "list_definitions",
      "heatmap_top",
      "dump",
    ]);
    for (const tool of api().listTools!()) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
    expect(probe.renderers.get("quark")).toBeDefined();
    expect(probe.renderers.get("neutron")).toBeDefined();
  });

  it("state_snapshot serializes attributes, vars, provision and text; skips scripts", () => {
    const agent = host.querySelector<HTMLElement & { provision: unknown }>("#agent")!;
    agent.provision = { items: [1, 2, 3], nested: { deep: true } };
    const result = tools().state_snapshot({ selector: "#app" }) as {
      nodes: number;
      truncated: boolean;
      root: { children: Array<Record<string, unknown>> };
    };
    expect(result.truncated).toBe(false);
    const p = result.root.children.find((c) => c.tag === "p")!;
    expect(p).toMatchObject({
      selector: "#app > p:nth-of-type(1)",
      attributes: { "bind-x": "", "data-n": "2" },
      text: "hello 2",
    });
    expect(p.vars).toBeUndefined();
    const agentNode = result.root.children.find((c) => c.tag === "x-agent")!;
    expect(agentNode).toMatchObject({
      selector: "#agent",
      provision: { items: [1, 2, 3], nested: { deep: true } },
    });
    const sheet = result.root.children.find((c) => c.tag === "quark-sheet")!;
    expect(sheet.text).toBeUndefined();
    const section = result.root.children.find((c) => c.tag === "section")!;
    expect((section.children as unknown[]).length).toBe(2);
    // the host holds the sheet's `$count`
    expect(result.root).toMatchObject({ vars: { $count: 2 } });
  });

  it("state_snapshot honours depth, node budget and includeText", () => {
    const shallow = tools().state_snapshot({ selector: "#app", depth: 0, includeText: false }) as {
      root: Record<string, unknown>;
    };
    expect(shallow.root.children).toBeUndefined();
    expect(shallow.root.omittedChildren).toBeGreaterThan(0);
    const tiny = tools().state_snapshot({ selector: "#app", maxNodes: 2 }) as {
      nodes: number;
      truncated: boolean;
      root: { children: unknown[]; omittedChildren?: number };
    };
    expect(tiny.nodes).toBe(2);
    expect(tiny.truncated).toBe(true);
    expect(tiny.root.children).toHaveLength(1);
    expect(tiny.root.omittedChildren).toBeGreaterThan(0);
    const body = tools().state_snapshot({}) as { root: { tag: string } };
    expect(body.root.tag).toBe("body");
  });

  it("inspect_element merges attributes, producer snapshots, matching rules and history", async () => {
    const agent = host.querySelector<HTMLElement & { isOn: boolean }>("#agent")!;
    agent.isOn = true;
    await settle();
    const result = tools().inspect_element({ selector: "#agent" }) as Record<string, any>;
    expect(result).toMatchObject({
      selector: "#agent",
      tag: "x-agent",
      attributes: { "is-on": "", tone: "loud" },
      neutron: { tag: "x-agent", props: { isOn: true, tone: "loud" } },
      quark: null,
      matchingRules: [],
    });
    expect(result.elementId).toEqual(expect.any(String));
    expect(result.history.map((h: { path: string }) => h.path)).toEqual(
      expect.arrayContaining(["neutron/constructed", "neutron/connected", "neutron/effect"]),
    );

    const p = tools().inspect_element({ selector: "[bind-x]", historyLimit: 1 }) as Record<string, any>;
    expect(p.quark).toMatchObject({ attributes: { "data-n": "2" }, listeners: {} });
    expect(p.matchingRules.map((r: { selector: string }) => r.selector)).toEqual(["[bind-x]"]);
    expect(p.history).toHaveLength(1);
  });

  it("explain_attribute reports Quark writes, matching / non-matching rules and no-write cases", async () => {
    const result = tools().explain_attribute({ selector: "[bind-x]", name: "data-n" }) as Record<string, any>;
    expect(result).toMatchObject({
      selector: "#app > p:nth-of-type(1)",
      name: "data-n",
      current: "2",
      reflectsProp: null,
    });
    expect(result.writes.at(-1)).toMatchObject({
      by: "quark/apply",
      ruleSelector: "[bind-x]",
      expression: '"#{$count}"',
      result: "2",
      isNoop: false,
      isWipe: false,
    });
    expect(result.rulesMatchingNow.map((r: { selector: string }) => r.selector)).toEqual(["[bind-x]"]);
    expect(result.rulesNotMatching).toEqual([
      expect.objectContaining({ selector: '[data-role="never"]' }),
    ]);
    expect(result.note).toMatch(/do not revert/);

    const none = tools().explain_attribute({ selector: "#app", name: "id" }) as Record<string, any>;
    expect(none.writes).toEqual([]);
    expect(none.note).toMatch(/No recorded write/);
  });

  it("explain_attribute finds Neutron effect writes through the reflected prop", async () => {
    const agent = host.querySelector<HTMLElement & { isOn: boolean }>("#agent")!;
    agent.isOn = true;
    await settle();
    const result = tools().explain_attribute({ selector: "#agent", name: "tone" }) as Record<string, any>;
    expect(result.reflectsProp).toBe("tone");
    expect(result.current).toBe("loud");
    expect(result.writes.at(-1)).toMatchObject({ by: "neutron/effect", value: "loud" });
    expect(result.writes.at(-1).signature).toEqual(expect.any(String));
  });

  it("list_sheets / matching_rules / evaluate_expression go through the quark renderer", async () => {
    const sheets = tools().list_sheets({}) as Array<Record<string, any>>;
    const sheet = sheets.find((s) => s.host === "#app")!;
    expect(sheet).toMatchObject({ hostTag: "div", isScoped: true, isRegistered: true, ruleCount: 4 });
    expect(sheet.src).toBeUndefined();
    expect(sheet.rules).toBeUndefined();
    expect(sheet.srcLength).toBeGreaterThan(10);

    const full = (tools().list_sheets({ includeSource: true, includeRules: true }) as Array<Record<string, any>>).find(
      (s) => s.host === "#app",
    )!;
    expect(full.src).toContain("[bind-x]");
    expect(full.rules.map((r: { selector: string }) => r.selector)).toEqual([
      ":scope",
      "[bind-x]",
      '[data-role="never"]',
      "[bind-bad]",
    ]);

    const matching = tools().matching_rules({ selector: "[bind-x]" }) as { rules: Array<{ declarations: unknown[] }> };
    expect(matching.rules[0].declarations).toEqual([
      { key: "data-n", value: '"#{$count}"' },
      { key: "content", value: '"hello #{$count}"' },
    ]);

    await expect(tools().evaluate_expression({ selector: "[bind-x]", expression: "$count * 10" })).resolves.toMatchObject(
      { value: 20 },
    );
    await expect(
      tools().evaluate_expression({ selector: "[bind-x]", expression: 'attr("data-n")', sheetId: sheet.sheetId }),
    ).resolves.toMatchObject({ value: "2" });
    await expect(tools().evaluate_expression({ selector: "[bind-x]", expression: "nope(" })).rejects.toThrow(
      /could not evaluate/,
    );
  });

  it("trace filters by path, element and sinceSeq; diagnostics keeps errors and audits", () => {
    const all = tools().trace({ limit: 500 }) as { count: number; lastSeq: number; records: Array<Record<string, any>> };
    expect(all.count).toBeGreaterThan(5);
    expect(all.lastSeq).toBe(all.records.at(-1)!.seq);
    const applies = tools().trace({ path: "quark/apply", limit: 500 }) as { records: Array<Record<string, any>> };
    expect(applies.records.every((r) => r.path === "quark/apply")).toBe(true);
    expect(applies.records.find((r) => r.selector === "#app > p:nth-of-type(1)")).toBeDefined();
    const mine = tools().trace({ selector: "#agent", limit: 500 }) as { records: Array<Record<string, any>> };
    expect(mine.records.length).toBeGreaterThan(0);
    expect(mine.records.every((r) => r.tag === "x-agent")).toBe(true);
    const later = tools().trace({ sinceSeq: all.lastSeq }) as { count: number };
    expect(later.count).toBe(0);

    const diag = tools().diagnostics({}) as { total: number; items: Array<Record<string, any>> };
    const error = diag.items.find((d) => d.source === "quark" && d.level === "error")!;
    expect(error).toMatchObject({ selector: "#app > p:nth-of-type(2)", tag: "p" });
    expect(error.message).toMatch(/explode/);
    const audit = diag.items.find((d) => d.source === "audit")!;
    expect(audit).toMatchObject({ level: "warning", tag: "x-agent", selector: null });
    expect(audit.message).toMatch(/\[tone\]/);
    const onlyErrors = tools().diagnostics({ level: "error", limit: 1 }) as { items: Array<{ level: string }> };
    expect(onlyErrors.items).toHaveLength(1);
    expect(onlyErrors.items[0].level).toBe("error");
  });

  it("list_definitions reports the Neutron definition with its props and audits", () => {
    const defs = tools().list_definitions() as Array<Record<string, any>>;
    const def = defs.find((d) => d.tag === "x-agent")!;
    expect(def.props).toEqual(
      expect.arrayContaining([
        { prop: "isOn", attr: "is-on" },
        { prop: "tone", attr: "tone" },
      ]),
    );
    expect(def.audits.length).toBeGreaterThan(0);
  });

  it("heatmap_top ranks painted elements and dump bundles everything", () => {
    const top = tools().heatmap_top({ n: 5 }) as { items: Array<{ selector: string; count: number }> };
    expect(top.items[0]).toMatchObject({ selector: expect.any(String), count: expect.any(Number) });
    expect(top.items.some((i) => i.selector === "#app > p:nth-of-type(1)")).toBe(true);

    const dump = tools().dump({ selector: "#app" }) as Record<string, any>;
    expect(dump).toMatchObject({ tool: "nucleus-devtools", hookVersion: 1, readme: AGENT_TOOL_GROUP.description });
    expect(dump.state.root.selector).toBe("#app");
    expect(dump.sheets[0].src).toBeDefined();
    expect(dump.sheets[0].rules.length).toBe(4);
    expect(dump.definitions.length).toBeGreaterThan(0);
    expect(dump.diagnostics.length).toBeGreaterThan(0);
    expect(dump.trace.length).toBeGreaterThan(0);
    expect(dump.heatmap.length).toBeGreaterThan(0);
    // JSON-safe end to end
    expect(() => JSON.stringify(dump)).not.toThrow();
  });

  it("rejects bad selectors and missing arguments with clear errors", () => {
    expect(() => tools().inspect_element({})).toThrow(/"selector" must be a non-empty string/);
    expect(() => tools().inspect_element({ selector: "#nope" })).toThrow(/No element matches "#nope"/);
    expect(() => tools().inspect_element({ selector: "[[" })).toThrow(/not a valid CSS selector/);
    expect(() => tools().explain_attribute({ selector: "#app" })).toThrow(/"name" must be/);
    expect(() => tools().trace({ selector: "#nope" })).toThrow(/No element matches/);
  });
});

describe("agent tools (degraded pages)", () => {
  const fakeHeatmap = (): Heatmap => ({
    record: () => {},
    setEnabled: () => {},
    isEnabled: () => false,
    render: () => {},
    destroy: () => {},
    top: () => [{ element: document.body, count: 3 }],
  });

  const setup = (renderers: Partial<Record<RendererKind, PageRenderer>> = {}, heatmap?: Heatmap) => {
    const probe = createPageHook({ post: () => {}, now: () => 1 });
    for (const [kind, renderer] of Object.entries(renderers)) probe.renderers.set(kind as RendererKind, renderer!);
    return createAgentTools({ api: probe.api, renderers: probe.renderers, log: probe.log, heatmap, now: () => 42 });
  };

  it("explains that Quark has not registered, or that the runtime is too old", () => {
    const none = setup().tools;
    expect(() => none.list_sheets()).toThrow(/Quark has not registered/);
    expect(() => none.matching_rules({ selector: "body" })).toThrow(/Quark has not registered/);
    const old = setup({ quark: { version: 1, kind: "quark", inspect: () => null } }).tools;
    expect(() => old.list_sheets()).toThrow(/does not expose "sheets"/);
    // tools that only enrich with Quark keep working
    expect(old.inspect_element({ selector: "body" })).toMatchObject({ matchingRules: null, quark: null });
    expect(old.explain_attribute({ selector: "body", name: "x" })).toMatchObject({
      rulesMatchingNow: [],
      rulesNotMatching: [],
    });
    expect((none.dump() as { sheets: unknown[] }).sheets).toEqual([]);
  });

  it("evaluate_expression awaits thenables and reports evaluator errors", async () => {
    const quark: PageRenderer & { evaluate: (el: Element, expr: string) => unknown } = {
      version: 1,
      kind: "quark",
      inspect: () => null,
      evaluate: (_el, expr) => {
        if (expr === "boom") throw new Error("nope");
        return Promise.resolve({ ok: expr });
      },
    };
    const { tools } = setup({ quark });
    await expect(tools.evaluate_expression({ selector: "body", expression: "x" })).resolves.toMatchObject({
      value: { ok: "x" },
    });
    await expect(tools.evaluate_expression({ selector: "body", expression: "boom" })).rejects.toThrow(
      /could not evaluate "boom": nope/,
    );
  });

  it("heatmap_top is empty without a heatmap and dump / diagnostics work on a silent page", () => {
    const { tools } = setup();
    expect(tools.heatmap_top()).toEqual({ items: [] });
    expect(tools.diagnostics()).toEqual({ total: 0, items: [] });
    expect(tools.list_definitions()).toEqual([]);
    expect(tools.trace()).toEqual({ count: 0, lastSeq: 0, records: [] });
    const { tools: withHeat } = setup({}, fakeHeatmap());
    expect(withHeat.heatmap_top({ n: 1 })).toEqual({ items: [{ selector: "html > body", tag: "body", count: 3 }] });
    expect((withHeat.dump() as { at: number }).at).toBe(42);
  });

  it("neutron errors and quark loop-guard trips land in diagnostics with their selector", () => {
    const probe = createPageHook({ post: () => {}, now: () => 5 });
    const { tools } = createAgentTools({ api: probe.api, renderers: probe.renderers, log: probe.log });
    const el = document.createElement("div");
    el.id = "trip";
    document.body.append(el);
    probe.hook.publicize(["neutron", "error"], { weakElement: new WeakRef(el), errorMessage: "bad effect" });
    probe.hook.publicize(["quark", "error"], {
      weakElement: new WeakRef(el),
      key: "is-open",
      errorMessage: "Loop guard: …",
      errorName: "LoopGuardDepth",
    });
    probe.hook.publicize(["quark", "error"], { errorMessage: 42 });
    const { items } = tools.diagnostics() as { items: Array<Record<string, unknown>> };
    expect(items).toMatchObject([
      { source: "neutron", level: "error", message: "bad effect", selector: "#trip", tag: "div" },
      { source: "quark", level: "error", message: "Loop guard: …", selector: "#trip", meta: { errorName: "LoopGuardDepth" } },
      { source: "quark", level: "error", message: "Unknown error", selector: null },
    ]);
    el.remove();
  });
});

describe("helpers", () => {
  it("cssPath prefers unique ids and disambiguates siblings by type", () => {
    const root = document.createElement("div");
    root.innerHTML = `<ul id="list"><li></li><li><em></em></li></ul><p id="dup"></p><p id="dup"></p>`;
    document.body.append(root);
    const em = root.querySelector("em")!;
    expect(cssPath(em)).toBe("#list > li:nth-of-type(2) > em");
    expect(document.querySelector(cssPath(em))).toBe(em);
    const [dup1, dup2] = Array.from(root.querySelectorAll("p"));
    // a duplicated id is not a unique anchor
    expect(cssPath(dup2)).toMatch(/^html > body > div(:nth-of-type\(\d+\))? > p:nth-of-type\(2\)$/);
    expect(document.querySelector(cssPath(dup1))).toBe(dup1);
    expect(cssPath(document.documentElement)).toBe("html");
    root.remove();
  });

  it("compact bounds strings, depth, keys and arrays", () => {
    expect(compact("x".repeat(10), { string: 4 })).toBe("xxxx… [+6]");
    expect(compact({ a: { b: { c: 1 } } }, { depth: 2 })).toEqual({ a: { b: "[object]" } });
    expect(compact({ a: [[1]] }, { depth: 2 })).toEqual({ a: ["[array 1]"] });
    expect(compact([1, 2, 3], { items: 2 })).toEqual([1, 2, "… [+1 more]"]);
    expect(compact({ a: 1, b: 2, c: 3 }, { keys: 2 })).toEqual({ a: 1, b: 2, "…": "+1 more keys" });
    expect(compact(null)).toBeNull();
    expect(compact(7)).toBe(7);
  });

  it("toJson tags functions, symbols, bigints, nodes, maps, sets, class instances and cycles", () => {
    const el = document.createElement("span");
    el.id = "s";
    document.body.append(el);
    class Thing {
      x = 1;
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(toJson(undefined)).toBeNull();
    expect(toJson(() => 1)).toEqual({ $constructor: "Function" });
    expect(toJson(Symbol("s"))).toEqual({ $constructor: "Symbol", description: "s" });
    expect(toJson(10n)).toBe("10");
    expect(toJson(el)).toEqual({ $element: "span", selector: "#s" });
    expect(toJson(document.createTextNode("t"))).toEqual({ $node: "#text" });
    expect(
      toJson({
        fn: () => 1,
        big: 2n,
        el,
        text: document.createTextNode("t"),
        map: new Map([["k", 1]]),
        set: new Set([1]),
        thing: new Thing(),
        date: new Date(0),
        cyclic,
      }),
    ).toEqual({
      fn: { $constructor: "Function" },
      big: "2",
      el: { $element: "span", selector: "#s" },
      text: { $node: "#text" },
      map: { $constructor: "Map", entries: [["k", 1]] },
      set: { $constructor: "Set", values: [1] },
      thing: { $constructor: "Thing", x: 1 },
      date: "1970-01-01T00:00:00.000Z",
      cyclic: { self: { $constructor: "Circular" } },
    });
    const throwing = {
      toJSON() {
        throw new Error("no");
      },
    };
    expect(toJson(throwing)).toEqual({ $unserializable: true });
    el.remove();
  });
});
