import { createPageHook } from "../../lib/page-hook-core";
import {
  MAX_DIAGNOSTICS,
  MAX_RECENT_RECORDS,
  MAX_RECORDS_PER_ELEMENT_PER_KIND,
  type LifecycleRecord,
  type PageRenderer,
} from "../../lib/protocol";
import type { Heatmap } from "../../lib/heatmap";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const fakeHeatmap = (): Heatmap & { recorded: Element[]; enabled: boolean[] } => {
  const recorded: Element[] = [];
  const enabled: boolean[] = [];
  return {
    recorded,
    enabled,
    record: (el) => {
      recorded.push(el);
    },
    setEnabled: (value) => {
      enabled.push(value);
    },
    isEnabled: () => enabled.at(-1) ?? false,
    render: () => {},
    destroy: () => {},
    top: () => [],
  };
};

const setup = (extra: { heatmap?: Heatmap; warn?: (m: string) => void } = {}) => {
  const posted: LifecycleRecord[] = [];
  let clock = 1000;
  const { api, hook, setHeatmapEnabled } = createPageHook({
    post: (json) => posted.push(JSON.parse(json)),
    now: () => clock++,
    ...extra,
  });
  return { api, hook, posted, setHeatmapEnabled };
};

describe("page hook core", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("assigns stable element ids lazily", () => {
    const { api } = setup();
    const a = document.createElement("div");
    const b = document.createElement("div");
    expect(api.getElementId(null)).toBeNull();
    expect(api.getElementId(a)).toBe("1");
    expect(api.getElementId(a)).toBe("1");
    expect(api.getElementId(b)).toBe("2");
  });

  it("publicizes JSON records with seq / path / elementId / tag / at / meta and strips weakElement", () => {
    const { api, hook, posted } = setup();
    const el = document.createElement("x-el");
    hook.publicize(["neutron", "effect"], {
      weakElement: new WeakRef(el),
      signature: "onPropSet(\"x\")",
      effect: { textContent: "hi" },
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      seq: 1,
      path: ["neutron", "effect"],
      elementId: "1",
      tag: "x-el",
      at: 1000,
      meta: { signature: "onPropSet(\"x\")", effect: { textContent: "hi" } },
    });
    expect(api.getLifecycles(el)).toEqual(posted);
    expect(api.getLifecycles(document.createElement("div"))).toEqual([]);
    expect(api.getLifecycles(null)).toEqual([]);
  });

  it("prefers meta.tag, and records without an element still post", () => {
    const { hook, posted } = setup();
    hook.publicize(["quark", "sheet", "registered"], { tag: "section" });
    expect(posted[0].elementId).toBeNull();
    expect(posted[0].tag).toBe("section");
    const el = document.createElement("div");
    hook.publicize(["neutron", "constructed"], {
      weakElement: new WeakRef(el),
      tag: "custom-tag",
    });
    expect(posted[1].tag).toBe("custom-tag");
  });

  it("increments seq across elements and kinds", () => {
    const { hook, posted } = setup();
    const el = document.createElement("div");
    hook.publicize(["neutron", "effect"], { weakElement: new WeakRef(el) });
    hook.publicize(["quark", "apply"], { weakElement: new WeakRef(el) });
    hook.publicize(["quark", "apply"], {});
    expect(posted.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("caps history per element per producer kind", () => {
    const { api, hook } = setup();
    const el = document.createElement("div");
    for (let i = 0; i < MAX_RECORDS_PER_ELEMENT_PER_KIND + 5; i++) {
      hook.publicize(["neutron", "effect"], { weakElement: new WeakRef(el), i });
    }
    for (let i = 0; i < 3; i++) {
      hook.publicize(["quark", "apply"], { weakElement: new WeakRef(el), i });
    }
    const history = api.getLifecycles(el);
    const neutron = history.filter((r) => r.path[0] === "neutron");
    const quark = history.filter((r) => r.path[0] === "quark");
    expect(neutron).toHaveLength(MAX_RECORDS_PER_ELEMENT_PER_KIND);
    // oldest neutron records dropped, quark untouched
    expect(neutron[0].meta.i).toBe(5);
    expect(quark).toHaveLength(3);
  });

  it("feeds real quark/apply paints to the heatmap and skips no-ops / element-less records", () => {
    const heatmap = fakeHeatmap();
    const { hook, posted, setHeatmapEnabled } = setup({ heatmap });
    const el = document.createElement("div");
    const other = document.createElement("span");
    hook.publicize(["quark", "apply"], { weakElement: new WeakRef(el), key: "content", isNoop: false });
    hook.publicize(["quark", "apply"], { weakElement: new WeakRef(el), key: "data-x", isNoop: true });
    hook.publicize(["quark", "apply"], { weakElement: new WeakRef(other), key: "data-y" });
    hook.publicize(["quark", "apply"], { key: "orphan" });
    hook.publicize(["quark", "error"], { weakElement: new WeakRef(el) });
    hook.publicize(["neutron", "effect"], { weakElement: new WeakRef(el) });
    expect(heatmap.recorded).toEqual([el, other]);
    // every record still reaches the bridge
    expect(posted).toHaveLength(6);

    setHeatmapEnabled(true);
    setHeatmapEnabled(false);
    expect(heatmap.enabled).toEqual([true, false]);
  });

  it("works without a heatmap", () => {
    const { hook, posted, setHeatmapEnabled } = setup();
    hook.publicize(["quark", "apply"], { weakElement: new WeakRef(document.createElement("b")) });
    expect(posted).toHaveLength(1);
    expect(() => setHeatmapEnabled(true)).not.toThrow();
  });

  it("audits neutron/defined records into the page console and still posts them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { hook, posted } = setup();
    hook.publicize(["neutron", "defined"], {
      tag: "audit-host",
      props: [
        { prop: "labelText", attr: "label-text" },
        { prop: "source", attr: "source" },
        { prop: "dataFoo", attr: "data-foo" },
        { prop: "title", attr: "data-title" },
      ],
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ path: ["neutron", "defined"], elementId: null, tag: "audit-host" });
    const messages = warn.mock.calls.map(([m]) => m as string);
    expect(messages).toHaveLength(3);
    for (const m of messages) expect(m).toMatch(/^\[nucleus-devtools\] /);
    expect(messages[0]).toContain("[source]");
    expect(messages[1]).toContain("[data-foo]");
    expect(messages[2]).toContain('"title"');

    warn.mockClear();
    hook.publicize(["neutron", "defined"], {
      tag: "clean-host",
      props: [{ prop: "labelText", attr: "label-text" }],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("never lets an audit / heatmap failure reach the producer", () => {
    const broken: Heatmap = {
      ...fakeHeatmap(),
      record: () => {
        throw new Error("boom");
      },
    };
    const warn = vi.fn(() => {
      throw new Error("console gone");
    });
    const { hook, posted } = setup({ heatmap: broken, warn });
    expect(() =>
      hook.publicize(["quark", "apply"], { weakElement: new WeakRef(document.createElement("i")) }),
    ).not.toThrow();
    expect(() =>
      hook.publicize(["neutron", "defined"], { tag: "x", props: [{ prop: "source", attr: "source" }] }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(2);
  });

  it("dispatches inspect() to injected renderers by kind and tolerates failures", () => {
    const { api, hook } = setup();
    const el = document.createElement("div");
    expect(api.inspect(el)).toEqual({ neutron: null, quark: null });
    expect(api.inspect(null)).toEqual({ neutron: null, quark: null });

    const neutron: PageRenderer = {
      version: 1,
      kind: "neutron",
      inspect: (target) => (target === el ? { props: { a: 1 } } : null),
    };
    const quark: PageRenderer = {
      version: 1,
      kind: "quark",
      inspect: () => {
        throw new Error("boom");
      },
    };
    hook.inject(neutron);
    hook.inject(quark);
    expect(api.inspect(el)).toEqual({ neutron: { props: { a: 1 } }, quark: null });
    expect(api.inspect(document.createElement("span"))).toEqual({
      neutron: null,
      quark: null,
    });
  });

  describe("page log (agent tools)", () => {
    const setupLog = (extra: { warn?: (m: string) => void } = {}) => {
      let clock = 1000;
      const probe = createPageHook({ post: () => {}, now: () => clock++, ...extra });
      return probe;
    };

    it("keeps a page-wide ring of the newest records", () => {
      const { hook, log } = setupLog();
      for (let i = 0; i < MAX_RECENT_RECORDS + 5; i++) hook.publicize(["quark", "apply"], { i });
      const recent = log.recent();
      expect(recent).toHaveLength(MAX_RECENT_RECORDS);
      expect(recent[0].seq).toBe(6);
      expect(recent.at(-1)!.seq).toBe(MAX_RECENT_RECORDS + 5);
      // copies: mutating the result does not touch the ring
      recent.length = 0;
      expect(log.recent()).toHaveLength(MAX_RECENT_RECORDS);
    });

    it("collects errors from both producers and audit warnings, capped", () => {
      const warn = vi.fn();
      const { hook, log } = setupLog({ warn });
      const el = document.createElement("x-el");
      hook.publicize(["quark", "error"], {
        weakElement: new WeakRef(el),
        errorMessage: "bad expr",
        errorName: "QuarkEvalError",
      });
      hook.publicize(["neutron", "error"], { weakElement: new WeakRef(el), errorMessage: "bad effect" });
      hook.publicize(["neutron", "effect"], { weakElement: new WeakRef(el), effect: {} });
      hook.publicize(["neutron", "defined"], {
        tag: "x-el",
        props: [{ prop: "tone", attr: "tone" }, { prop: "hidden", attr: "is-hidden" }, null, { attr: "x" }],
      });
      const diagnostics = log.diagnostics();
      expect(diagnostics.map((d) => [d.source, d.level, d.message])).toEqual([
        ["quark", "error", "bad expr"],
        ["neutron", "error", "bad effect"],
        ["audit", "warning", expect.stringContaining("[tone]")],
        ["audit", "warning", expect.stringContaining('"hidden"')],
      ]);
      expect(diagnostics[0]).toMatchObject({ seq: 1, at: 1000, tag: "x-el", elementId: "1", meta: { errorName: "QuarkEvalError" } });
      expect(diagnostics[2]).toMatchObject({ tag: "x-el", elementId: null });
      expect("meta" in diagnostics[2]).toBe(false);
      expect(warn).toHaveBeenCalledTimes(2);

      expect(log.definitions()).toEqual([
        {
          tag: "x-el",
          at: 1003,
          props: [
            { prop: "tone", attr: "tone" },
            { prop: "hidden", attr: "is-hidden" },
          ],
          audits: diagnostics.slice(2).map((d) => d.message),
        },
      ]);
      // a re-definition replaces the entry; one without a tag is ignored
      hook.publicize(["neutron", "defined"], { tag: "x-el", props: "nope" });
      hook.publicize(["neutron", "defined"], { props: [] });
      expect(log.definitions()).toEqual([{ tag: "x-el", at: 1004, props: [], audits: [] }]);

      for (let i = 0; i < MAX_DIAGNOSTICS + 3; i++) hook.publicize(["quark", "error"], { errorMessage: `e${i}` });
      const capped = log.diagnostics();
      expect(capped).toHaveLength(MAX_DIAGNOSTICS);
      expect(capped.at(-1)!.message).toBe(`e${MAX_DIAGNOSTICS + 2}`);
    });

    it("resolves record element ids back to live elements only", () => {
      const { api, log } = setupLog();
      let el: Element | null = document.createElement("div");
      const id = api.getElementId(el)!;
      expect(log.elementById(id)).toBe(el);
      expect(log.elementById("999")).toBeNull();
      expect(log.elementById(null)).toBeNull();
      expect(log.elementById(undefined)).toBeNull();
      el = null;
    });

    it("sweeps dead element refs once the id map grows large", () => {
      const { api, log } = setupLog();
      const keep = document.createElement("div");
      const keepId = api.getElementId(keep)!;
      // 4096+ ids: most elements are unreferenced afterwards; the sweep must
      // not throw and must keep live ones addressable
      for (let i = 0; i < 4100; i++) api.getElementId(document.createElement("span"));
      expect(log.elementById(keepId)).toBe(keep);
    });
  });
});
