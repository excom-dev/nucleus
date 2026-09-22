import {
  attachDevtools,
  DEVTOOLS_SERIALIZERS,
  getDevtoolsHook,
  getRenderer,
  injectRenderersIfNeeded,
  NUCLEUS_DEVTOOLS_ATTACH_EVENT,
  NUCLEUS_DEVTOOLS_HOOK_KEY,
  NUCLEUS_DEVTOOLS_HOOK_VERSION,
  pathMatches,
  publicize,
  registerRenderer,
  toDevtoolsJson,
  type DevtoolsHook,
  type DevtoolsRenderer,
} from "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";

const uninstallHook = () => {
  delete (globalThis as Record<string, unknown>)[NUCLEUS_DEVTOOLS_HOOK_KEY];
};

const makeRenderer = (
  kind: DevtoolsRenderer["kind"],
  inspect: DevtoolsRenderer["inspect"] = () => null
): DevtoolsRenderer => ({
  version: NUCLEUS_DEVTOOLS_HOOK_VERSION,
  kind,
  inspect,
});

describe("hook basics", () => {
  afterEach(() => {
    uninstallHook();
    vi.restoreAllMocks();
  });

  it("exposes the global key and version", () => {
    expect(NUCLEUS_DEVTOOLS_HOOK_KEY).toBe("__NUCLEUS_DEVTOOLS_HOOK__");
    expect(NUCLEUS_DEVTOOLS_HOOK_VERSION).toBe(1);
  });

  it("getDevtoolsHook reads the global slot", () => {
    expect(getDevtoolsHook()).toBeUndefined();
    const hook: DevtoolsHook = { version: 1 };
    attachDevtools(hook);
    expect(getDevtoolsHook()).toBe(hook);
    expect(globalThis.__NUCLEUS_DEVTOOLS_HOOK__).toBe(hook);
  });
});

describe("pathMatches", () => {
  it("matches an exact path", () => {
    expect(pathMatches(["neutron", "constructed"], ["neutron", "constructed"])).toBe(true);
  });

  it("matches a prefix pattern", () => {
    expect(pathMatches(["neutron", "constructed"], ["neutron"])).toBe(true);
    expect(pathMatches(["neutron", "constructed"], [])).toBe(true);
  });

  it("treats * as a single-token wildcard", () => {
    expect(pathMatches(["quark", "apply"], ["*", "apply"])).toBe(true);
    expect(pathMatches(["quark", "apply"], ["quark", "*"])).toBe(true);
    expect(pathMatches(["quark", "apply"], ["*", "*", "*"])).toBe(false);
  });

  it("rejects mismatching tokens and longer patterns", () => {
    expect(pathMatches(["quark", "apply"], ["neutron"])).toBe(false);
    expect(pathMatches(["quark"], ["quark", "apply"])).toBe(false);
  });
});

describe("toDevtoolsJson / DEVTOOLS_SERIALIZERS", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("serializes functions", () => {
    expect(toDevtoolsJson({ fn: () => 1 })).toEqual({
      fn: { $constructor: "Function" },
    });
  });

  it("serializes symbols with and without a description", () => {
    expect(toDevtoolsJson({ s: Symbol("tag") })).toEqual({
      s: { $constructor: "Symbol", description: "tag" },
    });
    expect(DEVTOOLS_SERIALIZERS.symbol(Symbol())).toEqual({
      $constructor: "Symbol",
      description: null,
    });
  });

  it("serializes elements with id, without id, and plain nodes", () => {
    const withId = document.createElement("my-widget");
    withId.id = "one";
    const noId = document.createElement("section");
    const text = document.createTextNode("hi");
    expect(toDevtoolsJson({ withId, noId, text })).toEqual({
      withId: { $element: "my-widget", id: "one" },
      noId: { $element: "section", id: null },
      text: { $node: "#text" },
    });
  });

  it("derefs WeakRefs and nulls dead ones", () => {
    const el = document.createElement("p");
    el.id = "weak";
    expect(toDevtoolsJson({ ref: new WeakRef(el) })).toEqual({
      ref: { $element: "p", id: "weak" },
    });
    const dead = { deref: () => undefined } as unknown as WeakRef<object>;
    expect(DEVTOOLS_SERIALIZERS.WeakRef(dead)).toBeNull();
  });

  it("tags non-POJOs with their constructor name", () => {
    class Thing {}
    expect(toDevtoolsJson({ m: new Map(), p: Promise.resolve(), t: new Thing() })).toEqual({
      m: { $constructor: "Map" },
      p: { $constructor: "Promise" },
      t: { $constructor: "Thing" },
    });
  });

  it("falls back to Object.prototype.toString for nameless constructors", () => {
    const anon = Object.create({ constructor: { name: "" } });
    expect(DEVTOOLS_SERIALIZERS.UnknownObject(anon)).toEqual({
      $constructor: "[object Object]",
    });
    const noCtor = Object.create({});
    Object.defineProperty(noCtor, "constructor", { value: undefined });
    expect(DEVTOOLS_SERIALIZERS.UnknownObject(noCtor)).toEqual({
      $constructor: "[object Object]",
    });
  });

  it("marks circular references", () => {
    const obj: Record<string, unknown> = { name: "loop" };
    obj.self = obj;
    expect(toDevtoolsJson(obj)).toEqual({
      name: "loop",
      self: { $constructor: "Circular" },
    });
  });

  it("marks values that cannot be serialized", () => {
    const broken = {
      toJSON() {
        throw new Error("nope");
      },
    };
    expect(toDevtoolsJson(broken)).toEqual({ $unserializable: true });
    expect(DEVTOOLS_SERIALIZERS.Failed()).toEqual({ $unserializable: true });
    expect(DEVTOOLS_SERIALIZERS.Circular()).toEqual({ $constructor: "Circular" });
  });

  it("passes primitives, arrays and POJOs through", () => {
    expect(toDevtoolsJson({ a: [1, "two", null, { b: true }] })).toEqual({
      a: [1, "two", null, { b: true }],
    });
  });
});

describe("publicize", () => {
  afterEach(() => {
    uninstallHook();
    document.body.innerHTML = "";
  });

  it("is a no-op without a hook", () => {
    expect(() => publicize(["neutron", "constructed"], { tag: "x" })).not.toThrow();
  });

  it("is a no-op when the hook has no publicize", () => {
    attachDevtools({ version: 1 });
    expect(() => publicize(["neutron", "constructed"])).not.toThrow();
  });

  it("clones meta and forwards weakElement untouched", () => {
    const received: unknown[] = [];
    attachDevtools({
      version: 1,
      publicize: (path, meta) => received.push([path, meta]),
    });
    const el = document.createElement("my-el");
    const weakElement = new WeakRef(el);
    const effect = () => {};
    publicize(["neutron", "effect"], { weakElement, tag: "my-el", effect, el });
    expect(received).toHaveLength(1);
    const [path, meta] = received[0] as [string[], Record<string, unknown>];
    expect(path).toEqual(["neutron", "effect"]);
    expect(meta.weakElement).toBe(weakElement);
    expect(meta.tag).toBe("my-el");
    expect(meta.effect).toEqual({ $constructor: "Function" });
    expect(meta.el).toEqual({ $element: "my-el", id: null });
  });

  it("omits weakElement when not supplied and defaults meta to {}", () => {
    const spy = vi.fn();
    attachDevtools({ version: 1, publicize: spy });
    publicize(["quark", "apply"]);
    expect(spy).toHaveBeenCalledWith(["quark", "apply"], {});
    expect(spy.mock.calls[0][1]).not.toHaveProperty("weakElement");
  });
});

describe("renderer registry", () => {
  afterEach(() => {
    uninstallHook();
  });

  it("stores renderers without a hook and exposes them via getRenderer", () => {
    const neutron = makeRenderer("neutron", () => ({ kind: "n" }));
    registerRenderer(neutron);
    expect(getRenderer("neutron")).toBe(neutron);
    expect(getRenderer("neutron")!.inspect(document.body)).toEqual({ kind: "n" });
    // No hook installed: injecting is a silent no-op.
    expect(() => injectRenderersIfNeeded()).not.toThrow();
  });

  it("injects registered renderers when a hook is attached, once per hook", () => {
    const neutron = makeRenderer("neutron");
    const quark = makeRenderer("quark");
    registerRenderer(neutron);
    registerRenderer(quark);

    const inject = vi.fn();
    const hook: DevtoolsHook = { version: 1, inject };
    attachDevtools(hook);
    expect(inject).toHaveBeenCalledTimes(2);
    expect(inject.mock.calls.map((c) => c[0].kind).sort()).toEqual(["neutron", "quark"]);

    // Repeated injection requests are de-duplicated per hook object.
    injectRenderersIfNeeded();
    injectRenderersIfNeeded();
    expect(inject).toHaveBeenCalledTimes(2);
  });

  it("re-injects everything when attachDevtools is called again with the same hook", () => {
    registerRenderer(makeRenderer("neutron"));
    registerRenderer(makeRenderer("quark"));
    const inject = vi.fn();
    const hook: DevtoolsHook = { version: 1, inject };
    attachDevtools(hook);
    attachDevtools(hook);
    expect(inject).toHaveBeenCalledTimes(4);
  });

  it("injects into a different hook object independently", () => {
    registerRenderer(makeRenderer("neutron"));
    const first = vi.fn();
    const second = vi.fn();
    attachDevtools({ version: 1, inject: first });
    attachDevtools({ version: 1, inject: second });
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    expect(getDevtoolsHook()!.inject).toBe(second);
  });

  it("registering a renderer while a hook is installed injects it immediately", () => {
    const inject = vi.fn();
    attachDevtools({ version: 1, inject });
    const before = inject.mock.calls.length;
    const replacement = makeRenderer("quark", () => ({ replaced: true }));
    registerRenderer(replacement);
    expect(inject).toHaveBeenCalledTimes(before + 1);
    expect(inject).toHaveBeenLastCalledWith(replacement);
    expect(getRenderer("quark")).toBe(replacement);

    // Re-registering the same kind replaces and re-injects it.
    const again = makeRenderer("quark");
    registerRenderer(again);
    expect(inject).toHaveBeenLastCalledWith(again);
    expect(inject).toHaveBeenCalledTimes(before + 2);
  });

  it("does nothing when the hook has no inject", () => {
    const hook: DevtoolsHook = { version: 1 };
    registerRenderer(makeRenderer("neutron"));
    expect(() => attachDevtools(hook)).not.toThrow();
    expect(() => registerRenderer(makeRenderer("quark"))).not.toThrow();
  });

  it("injects into a hook installed by hand once the attach event fires", () => {
    registerRenderer(makeRenderer("neutron"));
    const inject = vi.fn();
    // an injected bundle sets the global itself, it has no attachDevtools
    (globalThis as Record<string, unknown>)[NUCLEUS_DEVTOOLS_HOOK_KEY] = {
      version: 1,
      inject,
    } satisfies DevtoolsHook;
    expect(inject).not.toHaveBeenCalled();
    globalThis.dispatchEvent(new Event(NUCLEUS_DEVTOOLS_ATTACH_EVENT));
    expect(inject).toHaveBeenCalledWith(getRenderer("neutron"));
    // idempotent per hook object
    const count = inject.mock.calls.length;
    globalThis.dispatchEvent(new Event(NUCLEUS_DEVTOOLS_ATTACH_EVENT));
    expect(inject).toHaveBeenCalledTimes(count);
  });
});
