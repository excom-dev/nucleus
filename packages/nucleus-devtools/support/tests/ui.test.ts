import type { LifecycleRecord } from "../../lib/protocol";
import {
  copyLabel,
  describeValue,
  neutronCurrent,
  neutronEffects,
  previewValue,
  quarkApplies,
  quarkCurrent,
  renderTree,
  renderValue,
  selectionLabel,
  isEmptyLabel,
  hasRows,
} from "../../lib/ui";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const html = (node: Node) => (node as HTMLElement).outerHTML;

const record = (
  path: string[],
  meta: Record<string, unknown>,
  seq = 1,
): LifecycleRecord => ({
  seq,
  path,
  elementId: "1",
  tag: "x-el",
  at: 0,
  meta,
});

describe("ui: value description & preview", () => {
  it("describes primitives, truncating long strings", () => {
    expect(describeValue(null)).toEqual({ kind: "null" });
    expect(describeValue(undefined)).toEqual({ kind: "undefined" });
    expect(describeValue(3)).toEqual({ kind: "number", text: "3" });
    expect(describeValue(true)).toEqual({ kind: "boolean", text: "true" });
    expect(describeValue("short")).toEqual({ kind: "string", text: '"short"' });
    expect(describeValue("a".repeat(25))).toEqual({
      kind: "string",
      text: `"${"a".repeat(20)}…"`,
    });
    expect(describeValue(() => {})).toEqual({ kind: "function" });
  });

  it("recognizes tagged constructors and nodes", () => {
    expect(describeValue({ $constructor: "Promise" })).toEqual({
      kind: "constructor",
      name: "Promise",
    });
    expect(describeValue({ $element: "div", id: "app" })).toEqual({
      kind: "node",
      text: "<div#app>",
    });
    expect(describeValue({ $element: "span", id: null })).toEqual({
      kind: "node",
      text: "<span>",
    });
  });

  it("previews nested structures with item and depth caps", () => {
    expect(previewValue([])).toBe("[]");
    expect(previewValue({})).toBe("{}");
    expect(previewValue([1, "two", true, 4])).toBe('[1, "two", true, …]');
    expect(previewValue({ a: 1, b: { c: [1, 2] } })).toBe("{ a: 1, b: { c: [2] } }");
    expect(previewValue({ a: 1, b: 2, c: 3, d: 4 })).toBe("{ a: 1, b: 2, c: 3, … }");
    expect(previewValue({ a: { b: { c: { d: 1 } } } })).toBe("{ a: { b: {…1} } }");
  });
});

describe("ui: tree rendering", () => {
  it("renders leaves as kind-tagged spans", () => {
    expect(html(renderValue("hi"))).toBe('<span data-kind="string">"hi"</span>');
    expect(html(renderValue(null))).toBe('<span data-kind="null">null</span>');
    expect(html(renderValue([]))).toBe('<span data-kind="array">[]</span>');
    expect(html(renderValue({ $constructor: "Function" }))).toBe(
      '<span data-kind="constructor">Function</span>',
    );
  });

  it("renders objects as details; nested objects carry their key inside the summary", () => {
    const node = renderValue({ a: 1, b: [true] });
    expect(html(node)).toMatchInlineSnapshot(
      `"<details data-kind="object"><summary><span data-role="preview">{ a: 1, b: [true] }</span></summary><div data-role="entries"><div data-role="entry"><span data-role="key">a</span><span data-kind="number">1</span></div><details data-role="entry" data-kind="array"><summary><span data-role="key">b</span><span data-role="preview">[true]</span></summary><div data-role="entries"><div data-role="entry"><span data-role="key">0</span><span data-kind="boolean">true</span></div></div></details></div></details>"`,
    );
    expect((node as HTMLDetailsElement).open).toBe(false);
    expect((renderValue({ a: 1 }, { open: true }) as HTMLDetailsElement).open).toBe(true);
  });

  it("puts a tagged function's declaration on the leaf's title", () => {
    const leaf = renderValue({ $constructor: "Function", $expression: "go($x)" }) as HTMLElement;
    expect(leaf.outerHTML).toBe(
      '<span data-kind="constructor" title="go($x)">Function</span>',
    );
    const tree = renderTree({
      click: [{ $constructor: "Function", $expression: "a($x)" }, { $constructor: "Promise" }],
    }) as HTMLElement;
    expect(
      [...tree.querySelectorAll("[data-kind='constructor']")].map(
        (el) => [(el as HTMLElement).textContent, (el as HTMLElement).title],
      ),
    ).toEqual([
      ["Function", "a($x)"],
      ["Promise", ""],
    ]);
  });

  it("renderTree renders a bare root, treats null as {}, and titles top-level keys", () => {
    expect(html(renderTree({ x: "y" }))).toBe(
      '<div data-kind="object" data-role="tree-root"><div data-role="entries"><div data-role="entry"><span data-role="key">x</span><span data-kind="string">"y"</span></div></div></div>',
    );
    expect(html(renderTree(null))).toBe('<span data-kind="object">{}</span>');
    expect(html(renderTree([1]))).toContain('data-kind="array" data-role="tree-root"');

    const titled = renderTree(
      { content: "hi", nested: { deep: 1 } },
      { content: "content: $x", nested: "nested: expr" },
    ) as HTMLElement;
    const keys = [...titled.querySelectorAll("[data-role='key']")] as HTMLElement[];
    expect(keys.map((k) => [k.textContent, k.title])).toEqual([
      ["content", "content: $x"],
      ["nested", "nested: expr"],
      ["deep", ""],
    ]);
  });
});

describe("ui: selection header", () => {
  it("reproduces the four selection labels", () => {
    expect(selectionLabel("empty", null, false)).toBe("Select an element");
    expect(selectionLabel("unavailable", null, false)).toBe(
      "Page API unavailable — reload the tab",
    );
    expect(selectionLabel("selected", "my-el", false)).toBe(
      "<my-el> — no publications yet",
    );
    expect(selectionLabel("selected", "my-el", null)).toBe(
      "<my-el> — no publications yet",
    );
    expect(selectionLabel("selected", "my-el", true)).toBe("<my-el>");
    // attribute form of a reflected boolean
    expect(selectionLabel("selected", "my-el", "")).toBe("<my-el>");
    expect(selectionLabel(null, null, null)).toBe("Select an element");
  });

  it("marks non-selected states as empty", () => {
    expect(isEmptyLabel("empty")).toBe(true);
    expect(isEmptyLabel("unavailable")).toBe(true);
    expect(isEmptyLabel(null)).toBe(true);
    expect(isEmptyLabel("selected")).toBe(false);
  });

  it("labels the Copy for AI button from the reflected did-copy attribute", () => {
    expect(copyLabel(null)).toBe("Copy for AI");
    expect(copyLabel(false)).toBe("Copy for AI");
    expect(copyLabel("")).toBe("Copied");
    expect(copyLabel(true)).toBe("Copied");
  });
});

describe("ui: log rows", () => {
  it("maps neutron effect records only, with signature fallback and lock depth", () => {
    const rows = neutronEffects([
      record(["neutron", "constructed"], {}, 1),
      record(
        ["neutron", "effect"],
        { signature: 'onPropSet("x")', effect: { a: 1 }, lockDepth: 1 },
        2,
      ),
      record(["neutron", "effect"], { effect: { b: 2 }, lockDepth: 3 }, 3),
      record(["quark", "apply"], { key: "content" }, 4),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      key: 2,
      signature: 'onPropSet("x")',
      effect: { a: 1 },
      titles: {},
      depth: 0,
      status: "",
    });
    expect(rows[1]).toMatchObject({
      key: 3,
      signature: "(anonymous effector)",
      depth: 2,
    });
    expect(typeof rows[0].time).toBe("string");
    expect(neutronEffects(null)).toEqual([]);
    expect(hasRows(rows)).toBe(true);
    expect(hasRows([])).toBe(false);
    expect(hasRows(null)).toBe(false);
  });

  it("groups one rule run into a row, titles keys with their declaration, keeps errors separate", () => {
    const run = (seq: number, key: string, expression: string, extra: Record<string, unknown> = {}) =>
      record(
        ["quark", "apply"],
        {
          selector: "article p",
          sheetId: 1,
          ruleId: 4,
          runId: "run-a",
          key,
          expression,
          isNoop: false,
          isWipe: false,
          ...extra,
        },
        seq,
      );
    const rows = quarkApplies([
      record(["quark", "sheet", "registered"], {}, 1),
      run(2, "content", "$greeting", { result: "hi" }),
      run(3, "data-kind", '"greeting"', { result: "greeting" }),
      // same rule, different run → new row
      record(
        ["quark", "apply"],
        { selector: "article p", sheetId: 1, ruleId: 4, runId: "run-b", key: "data-a", expression: "preserve", isNoop: true },
        4,
      ),
      record(
        ["quark", "apply"],
        { selector: "p", sheetId: 1, ruleId: 5, runId: "run-b", key: "data-b", expression: "none", result: null, isWipe: true },
        5,
      ),
      record(
        ["quark", "error"],
        {
          selector: "p",
          key: "content",
          expression: '"x".splice(0)',
          errorMessage: "not allowed",
          errorName: "Error",
        },
        6,
      ),
      record(["neutron", "effect"], {}, 7),
    ]);
    expect(rows.map((r) => r.key)).toEqual([2, 4, 5, 6]);
    expect(rows[0]).toMatchObject({
      signature: "article p",
      effect: { content: "hi", "data-kind": "greeting" },
      titles: { content: "content: $greeting", "data-kind": 'data-kind: "greeting"' },
      depth: 0,
      status: "",
    });
    expect(rows[1]).toMatchObject({
      effect: { "data-a": "(no-op)" },
      titles: { "data-a": "data-a: preserve" },
      status: "no-op",
    });
    expect(rows[2]).toMatchObject({ effect: { "data-b": null }, status: "wipe" });
    expect(rows[3]).toMatchObject({
      status: "error",
      effect: { content: { error: "Error", message: "not allowed" } },
      titles: { content: 'content: "x".splice(0)' },
    });
  });

  it("tags listener results with the declaration so the Function leaf gets a hover title", () => {
    const rows = quarkApplies([
      record(
        ["quark", "apply"],
        {
          selector: "span",
          kind: "listener",
          key: "on-click",
          expression: "setOutputFromDetail",
          result: [{ $constructor: "Function" }],
          sheetId: 1,
          ruleId: 1,
          runId: "r",
        },
        1,
      ),
    ]);
    expect(rows[0].effect).toEqual({
      "on-click": [
        { $constructor: "Function", $expression: "setOutputFromDetail" },
      ],
    });
  });

  it("groups a late-settling content into its rule run's row (order-independent)", () => {
    const rec = (seq: number, ruleId: number, key: string, result: unknown) =>
      record(
        ["quark", "apply"],
        { selector: "ul", sheetId: 1, ruleId, runId: "r", key, expression: "x", result },
        seq,
      );
    const rows = quarkApplies([
      rec(1, 1, "$items", ["a"]),
      rec(2, 2, "data-x", "1"),
      rec(3, 1, "content", [{ $element: "li", id: null }]),
    ]);
    expect(rows.map((r) => [r.key, Object.keys(r.effect)])).toEqual([
      [1, ["$items", "content"]],
      [2, ["data-x"]],
    ]);
  });

  it("renders $node refs (fragments, text) as node leaves", () => {
    expect(describeValue({ $node: "#document-fragment" })).toEqual({
      kind: "node",
      text: "<#document-fragment>",
    });
  });

  it("does not merge a repeated key into the same row (a second application starts a new row)", () => {
    const apply = (seq: number, key: string) =>
      record(["quark", "apply"], { selector: "p", sheetId: 1, ruleId: 1, runId: "r", key, expression: "1", result: 1 }, seq);
    const rows = quarkApplies([apply(1, "content"), apply(2, "content")]);
    expect(rows.map((r) => r.key)).toEqual([1, 2]);
  });
});

describe("ui: current blocks", () => {
  it("neutronCurrent returns props or null", () => {
    expect(neutronCurrent(null)).toBeNull();
    expect(neutronCurrent({ neutron: null, quark: null })).toBeNull();
    expect(
      neutronCurrent({ neutron: { props: { label: "x" } }, quark: null }),
    ).toEqual({ label: "x" });
    expect(neutronCurrent({ neutron: { tag: "x" }, quark: null })).toEqual({});
  });

  it("quarkCurrent groups non-empty sections", () => {
    expect(quarkCurrent(null)).toBeNull();
    expect(quarkCurrent({ neutron: null, quark: null })).toBeNull();
    expect(
      quarkCurrent({
        neutron: null,
        quark: {
          vars: {},
          attributes: {},
          styleProperties: {},
          listeners: {},
          loop: null,
        },
      }),
    ).toBeNull();
    expect(
      quarkCurrent({
        neutron: null,
        quark: {
          vars: { $count: 3, $box: "open" },
          attributes: { "data-count": "3" },
          styleProperties: {},
          listeners: { click: [{ $constructor: "Function", $expression: "handler" }] },
          loop: { index: 1, key: "b" },
        },
      }),
    ).toEqual({
      variables: { $count: 3, $box: "open" },
      attributes: { "data-count": "3" },
      listeners: { click: [{ $constructor: "Function", $expression: "handler" }] },
      loop: { index: 1, key: "b" },
    });
  });
});

describe("ui: remaining value kinds and fallbacks", () => {
  it("describes exotic primitives as `unknown` and previews undefined / functions as leaves", () => {
    expect(describeValue(10n)).toEqual({ kind: "unknown", text: "10" });
    expect(describeValue(Symbol("s"))).toEqual({ kind: "unknown", text: "Symbol(s)" });
    expect(previewValue(undefined)).toBe("undefined");
    expect(previewValue(() => {})).toBe("Function");
    expect(previewValue({ fn: () => {}, u: undefined })).toBe("{ fn: Function, u: undefined }");
  });

  it("renders a raw function as a constructor-kind leaf", () => {
    expect(html(renderValue(() => {}))).toBe('<span data-kind="constructor">Function</span>');
    expect(html(renderTree({ cb: () => {} }))).toBe(
      '<div data-kind="object" data-role="tree-root"><div data-role="entries"><div data-role="entry"><span data-role="key">cb</span><span data-kind="constructor">Function</span></div></div></div>',
    );
  });

  it("defaults a neutron effect row when lockDepth and effect are missing", () => {
    const [row] = neutronEffects([record(["neutron", "effect"], { signature: "s", effect: "not-an-object" })]);
    expect(row).toMatchObject({ signature: "s", depth: 0, effect: {}, status: "" });
    expect(neutronEffects(null)).toEqual([]);
  });

  it("treats a null record list as empty and leaves mixed-status rule runs unstatused", () => {
    expect(quarkApplies(null)).toEqual([]);
    const base = { selector: "p", sheetId: 1, ruleId: 1, runId: "r", expression: "x" };
    const rows = quarkApplies([
      record(["quark", "apply"], { ...base, key: "a", result: 1, isNoop: true }, 1),
      record(["quark", "apply"], { ...base, key: "b", result: 2 }, 2),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("");
    expect(rows[0].effect).toEqual({ a: "(no-op)", b: 2 });
  });

  it("tags only function refs among listener results, for single and array results", () => {
    const base = { selector: "p", sheetId: 1, ruleId: 1, expression: "h($e)", kind: "listener" };
    const [single] = quarkApplies([
      record(["quark", "apply"], { ...base, runId: "1", key: "@click", result: { $constructor: "Function" } }, 1),
    ]);
    expect(single.effect).toEqual({ "@click": { $constructor: "Function", $expression: "h($e)" } });
    const [mixed] = quarkApplies([
      record(["quark", "apply"], { ...base, runId: "2", key: "@input", result: [{ $constructor: "Function" }, "plain", null] }, 2),
    ]);
    expect(mixed.effect).toEqual({
      "@input": [{ $constructor: "Function", $expression: "h($e)" }, "plain", null],
    });
    const [plain] = quarkApplies([
      record(["quark", "apply"], { ...base, runId: "3", key: "@x", result: "text" }, 3),
    ]);
    expect(plain.effect).toEqual({ "@x": "text" });
  });

  it("quarkCurrent tolerates a snapshot without vars", () => {
    expect(quarkCurrent({ neutron: null, quark: { attributes: { "data-a": "1" } } })).toEqual({
      attributes: { "data-a": "1" },
    });
    expect(quarkCurrent({ neutron: null, quark: {} })).toBeNull();
  });
});
