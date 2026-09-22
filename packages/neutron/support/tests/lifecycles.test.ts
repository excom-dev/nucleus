import { Neutron } from "../../src/neutron";
import { NeutronError } from "../../src/neutron-error";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { KitLogger } from "@excom/kit-logger";
import { TokenList } from "@excom/kit-utils";

const mountTag = async <T = any>(html: string): Promise<T> => {
  const el = fixture<T>(html);
  await wait(0);
  return el;
};

describe("Lifecycles: onEffect", () => {
  const effectFn = vi.fn();
  Neutron({
    tag: "effect-host",
    props: { aValue: String, bValue: String, cValue: String },
  })
    .onEffect(["aValue", "bValue"], effectFn)
    .define();

  afterEach(() => {
    document.body.innerHTML = "";
    effectFn.mockClear();
  });

  it("runs once per batch with the previous values, only after mount", async () => {
    const el = document.createElement("effect-host") as any;
    // before mount: kept and flushed on first connect
    el.aValue = "pre";
    expect(effectFn).not.toHaveBeenCalled();
    document.body.append(el);
    expect(effectFn).toHaveBeenCalledTimes(1);
    expect(effectFn.mock.calls[0][0]).toBe(el);
    expect(effectFn.mock.calls[0][1]).toMatchObject({ aValue: null });
    expect("bValue" in effectFn.mock.calls[0][1]).toBe(false);

    effectFn.mockClear();
    el.cValue = "unwatched";
    expect(effectFn).not.toHaveBeenCalled();
    el.bValue = "y";
    expect(effectFn).toHaveBeenCalledTimes(1);
    expect(effectFn.mock.calls[0][1]).toEqual({ bValue: null });

    effectFn.mockClear();
    el._n_.batch(() => {
      el.aValue = "a2";
      el.bValue = "b2";
    });
    expect(effectFn).toHaveBeenCalledTimes(1);
    expect(effectFn.mock.calls[0][1]).toEqual({ aValue: "pre", bValue: "y" });

    // mounting without any watched change does not run the handler
    effectFn.mockClear();
    await mountTag(`<effect-host c-value="only"></effect-host>`);
    expect(effectFn).not.toHaveBeenCalled();

    // reactions keep running on a detached element that was mounted before
    el.remove();
    await wait(0);
    el.aValue = "after";
    expect(effectFn).toHaveBeenCalledTimes(1);
    expect(effectFn.mock.calls[0][1]).toEqual({ aValue: "a2" });
  });
});

describe("Lifecycles: prop reactions guard their own prop", () => {
  Neutron({
    tag: "guard-host",
    props: {
      sourceText: String,
      mirrorText: String,
      loopText: String,
      loopSet: String,
      flagText: String,
      resetText: String,
      childEl: { type: HTMLElement, store: "weak" },
    },
  })
    .onPropChanged("sourceText", ({ sourceText }) => ({
      mirrorText: sourceText,
    }))
    .onPropChanged("loopText", () => ({ loopText: "loop" }))
    .onPropChanged("childEl", () => ({
      childEl: { title: "from-child-effect" },
    }))
    .onPropSet("loopSet", () => ({ loopSet: "again" }))
    .onPropUnset("flagText", () => ({ flagText: null }))
    .onPropUnset("resetText", () => ({ resetText: "restored" }))
    .define();

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("allows effects on other props and child effects; throws on the reacted prop", async () => {
    const el = await mountTag(`<guard-host></guard-host>`);
    el.sourceText = "s";
    expect(el.mirrorText).toBe("s");
    // onPropChanged also fires on unset
    el.sourceText = null;
    expect(el.mirrorText).toBe(null);

    expect(() => {
      el.loopText = "x";
    }).toThrow(NeutronError);
    expect(() => {
      el.loopText = "y";
    }).toThrow("Cannot change prop loopText in its own onPropChanged handler.");
    expect(() => {
      el.loopSet = "x";
    }).toThrow("Cannot set prop loopSet in its own onPropSet handler.");

    el.flagText = "on";
    expect(() => {
      el.flagText = null;
    }).toThrow("Cannot unset prop flagText in its own onPropUnset handler.");

    // an unset handler may set its prop back to a truthy value
    el.resetText = "on";
    el.resetText = null;
    expect(el.resetText).toBe("restored");

    const child = document.createElement("span");
    el.childEl = child;
    expect(child.title).toBe("from-child-effect");

    // reactions still run on a disconnected element that was mounted before
    el.remove();
    await wait(0);
    el.resetText = null;
    expect(el.resetText).toBe("restored");
  });
});

describe("Lifecycles: onError", () => {
  const errorFn = vi.fn();
  Neutron({
    tag: "error-host",
    props: { isBroken: Boolean, errorText: String },
  })
    .onPropSet("isBroken", () => {
      throw new Error("broken");
    })
    .onError(errorFn)
    .define();

  afterEach(() => {
    document.body.innerHTML = "";
    errorFn.mockReset();
  });

  it("routes handler errors to onError and applies its effect", async () => {
    const el = await mountTag(`<error-host></error-host>`);
    errorFn.mockImplementation((_el, error) => ({ errorText: error.message }));
    expect(() => {
      el.isBroken = true;
    }).not.toThrow();
    expect(errorFn).toHaveBeenCalledTimes(1);
    expect(errorFn.mock.calls[0][0]).toBe(el);
    expect(errorFn.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(el.errorText).toBe("broken");
  });
});

describe("Lifecycles: adoption and moves", () => {
  const adoptedFn = vi.fn();
  const connectedFn = vi.fn();
  const disconnectedFn = vi.fn();
  Neutron({ tag: "move-host", props: {} })
    .onAdopted(adoptedFn)
    .onConnected((el) => {
      connectedFn(el.isMoving);
    })
    .onDisconnected((el) => {
      disconnectedFn(el.isMoving);
    })
    .define();

  afterEach(() => {
    document.body.innerHTML = "";
    adoptedFn.mockClear();
    connectedFn.mockClear();
    disconnectedFn.mockClear();
  });

  it("adoptedCallback flags isAdopted until the next disconnect", async () => {
    const el = await mountTag(`<move-host></move-host>`);
    expect(el.isAdopted).toBe(false);
    el.adoptedCallback();
    expect(el.isAdopted).toBe(true);
    expect(adoptedFn).toHaveBeenCalledTimes(1);
    expect(adoptedFn.mock.calls[0][0]).toBe(el);
    el.remove();
    await wait(0);
    expect(el.isAdopted).toBe(false);
    expect(adoptedFn).toHaveBeenCalledTimes(1);
  });

  it("a synchronous remove + append is a move: both lifecycles run with isMoving", async () => {
    const el = await mountTag(`<move-host></move-host>`);
    expect(connectedFn).toHaveBeenCalledWith(false);
    connectedFn.mockClear();

    el.remove();
    document.body.append(el);
    expect(disconnectedFn).toHaveBeenCalledTimes(1);
    expect(disconnectedFn).toHaveBeenCalledWith(true);
    expect(connectedFn).toHaveBeenCalledTimes(1);
    expect(connectedFn).toHaveBeenCalledWith(true);
    expect(el.isMoving).toBe(false);
    expect(el.isMounted).toBe(true);
    expect(el.wasMounted).toBe(true);
    // the queued microtask disconnect was consumed by the move
    await wait(0);
    expect(disconnectedFn).toHaveBeenCalledTimes(1);

    // connectedMoveCallback delegates to the same disconnect + connect pair
    el.connectedMoveCallback();
    expect(disconnectedFn).toHaveBeenCalledTimes(2);
    expect(disconnectedFn.mock.calls[1][0]).toBe(true);
    expect(connectedFn).toHaveBeenCalledTimes(2);
    expect(connectedFn.mock.calls[1][0]).toBe(true);
    expect(el.isMounted).toBe(true);
  });
});

describe("Lifecycles: registry", () => {
  it("unregisters every lifecycle by handler identity, trimming names from shared entries", () => {
    const B = Neutron({
      tag: "off-host",
      props: { aValue: String, bValue: String, loadPromise: Promise },
    });
    const f = vi.fn();
    const g = vi.fn();
    const L = () => B.builtConfig.lifecycles;

    B.onConstructed(f).onConstructed(g).offConstructed(f);
    expect(L().constructed).toEqual([[[], g]]);
    B.onAdopted(f).offAdopted(f);
    expect(L().adopted).toEqual([]);
    B.onError(f).offError(f);
    expect(L().error).toEqual([]);
    B.onDisconnected(f).offDisconnected(f);
    expect(L().disconnected).toEqual([]);

    B.onEffect(["aValue", "bValue"], f).offEffect("aValue", f);
    expect(L().effect).toEqual([[["bValue"], f]]);
    B.offEffect("bValue", f);
    expect(L().effect).toEqual([]);

    B.onPropUnset("aValue", f).offPropUnset("aValue", f);
    expect(L().propUnset).toEqual([]);
    B.onPropChanged("aValue", f).offPropChanged(["aValue"], f);
    expect(L().propChanged).toEqual([]);
    B.onPromiseResolved("loadPromise", f).offPromiseResolved("loadPromise", f);
    expect(L().promiseResolved).toEqual([]);
    B.onPromiseRejected("loadPromise", f).offPromiseRejected("loadPromise", f);
    expect(L().promiseRejected).toEqual([]);
    B.onBroadcast("hum", f).offBroadcast("hum", f);
    expect(L().broadcast).toEqual([]);

    // a different handler leaves the entry untouched
    B.onEvent("off-host-hit", f).offEvent("off-host-hit", g);
    expect(L().event).toEqual([[["off-host-hit"], f]]);
    B.offEvent("off-host-hit", f);
    expect(L().event).toEqual([]);
    B.onEventDefault("off-host-hit", f).offEventDefault("off-host-hit", f);
    expect(L().eventDefault).toEqual([]);

    // names are de-duplicated on registration and mirrored in the debug signature
    B.onPropSet(["aValue", "aValue", "bValue"], f);
    expect(L().propSet).toEqual([[["aValue", "bValue"], f]]);
    expect((f as any)._logSignature).toBe('onPropSet(["aValue", "bValue"])');
    B.onPropSet("aValue", g);
    expect((g as any)._logSignature).toBe('onPropSet("aValue")');
  });

  it("defineMethods rejects protected names and non-functions", () => {
    const B = Neutron({ tag: "methods-host", props: {} });
    expect(() => B.defineMethods({ emit: () => ({}) })).toThrow(NeutronError);
    expect(() => B.defineMethods({ emit: () => ({}) })).toThrow(
      'Cannot use protected name: "emit"'
    );
    expect(() => B.defineMethods({ connectedCallback: () => ({}) })).toThrow(
      NeutronError
    );
    expect(() => B.defineMethods({ notCallable: {} as any })).toThrow(
      "Method notCallable is not a function"
    );
    expect(B.builtConfig.methods).toEqual([]);
  });

  it("define() warns for an already-registered tag and forwards definition options", () => {
    const warn = vi.spyOn(KitLogger, "warn").mockImplementation(() => {});
    const B = Neutron({ tag: "define-host", props: {} });
    B.define();
    B.define();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      '"define-host", but it\'s already defined'
    );

    const defineSpy = vi.spyOn(customElements, "define");
    const definitionOpts = {};
    Neutron({ tag: "define-host-opts", props: {}, definitionOpts }).define();
    expect(defineSpy).toHaveBeenLastCalledWith(
      "define-host-opts",
      expect.any(Function),
      definitionOpts
    );
    vi.restoreAllMocks();
  });
});

describe("Lifecycles: promise props", () => {
  const resolvedA = vi.fn();
  const resolvedB = vi.fn();
  const rejected = vi.fn();
  Neutron({
    tag: "promise-host",
    props: { loadPromise: Promise, resultText: String },
  })
    .onPromiseResolved("loadPromise", resolvedA)
    .onPromiseResolved("loadPromise", resolvedB)
    .onPromiseRejected("loadPromise", rejected)
    .define();

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("notifies every handler with { prop: value } and drops stale settlements", async () => {
    const el = await mountTag(`<promise-host></promise-host>`);
    resolvedA.mockImplementation((_el, result) => ({
      resultText: result.loadPromise,
    }));

    let resolveStale!: (v: string) => void;
    const stale = new Promise<string>((r) => {
      resolveStale = r;
    });
    let resolveFresh!: (v: string) => void;
    const fresh = new Promise<string>((r) => {
      resolveFresh = r;
    });
    el.loadPromise = stale;
    // replacing a pending promise cancels it
    el.loadPromise = fresh;
    resolveStale("stale");
    await wait(0);
    expect(resolvedA).not.toHaveBeenCalled();

    resolveFresh("fresh");
    await wait(0);
    expect(resolvedA).toHaveBeenCalledTimes(1);
    expect(resolvedB).toHaveBeenCalledTimes(1);
    expect(resolvedA.mock.calls[0][0]).toBe(el);
    expect(resolvedA.mock.calls[0][1]).toEqual({ loadPromise: "fresh" });
    expect(el.resultText).toBe("fresh");

    el.loadPromise = Promise.reject(new Error("nope"));
    await wait(0);
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(rejected.mock.calls[0][1].loadPromise).toBeInstanceOf(Error);

    // clearing resets the queue without settling anything
    el.loadPromise = null;
    await wait(0);
    expect(resolvedA).toHaveBeenCalledTimes(1);
    expect(rejected).toHaveBeenCalledTimes(1);
  });
});

describe("Lifecycles: compose", () => {
  it("merges config maps (later wins) and concatenates methods / lifecycles", () => {
    const fa = vi.fn();
    const fb = vi.fn();
    const fc = vi.fn();
    const A = Neutron({
      tag: "compose-a",
      props: { aValue: String, sharedText: String },
      events: { ping: { prefixWithTag: true } },
      broadcasts: { hum: {} },
    })
      .onConstructed(fa)
      .onConnected(fa)
      .onPropSet("aValue", fa)
      .defineMethods({ fromA: fa });
    const isValid = (v: unknown) => v !== "bad";
    const B = Neutron({
      tag: "compose-b",
      props: { bValue: Number, sharedText: { type: String, isValid } },
      events: { pong: {} },
      broadcasts: { buzz: { prefixWithTag: true } },
    })
      .onConstructed(fb)
      .onDisconnected(fb)
      .onPropUnset("bValue", fb)
      .onEvent("pong", fb)
      .defineMethods({ fromB: fb });
    const C = Neutron({ tag: "compose-c", props: {} })
      .onConstructed(fc)
      .onEffect("aValue", fc);

    const conf = Neutron.compose([A, B, C]).builtConfig;
    expect(conf.tag).toBe("compose-c");
    expect(Object.keys(conf.props)).toEqual(["aValue", "sharedText", "bValue"]);
    expect(conf.props.sharedText.isValid).toBe(isValid);
    expect(conf.events).toEqual({ ping: { prefixWithTag: true }, pong: {} });
    expect(conf.broadcasts).toEqual({ hum: {}, buzz: { prefixWithTag: true } });
    expect(conf.methods).toEqual([
      ["fromA", fa],
      ["fromB", fb],
    ]);
    expect(conf.lifecycles.constructed).toEqual([
      [[], fa],
      [[], fb],
      [[], fc],
    ]);
    expect(conf.lifecycles.connected).toEqual([[[], fa]]);
    expect(conf.lifecycles.disconnected).toEqual([[[], fb]]);
    expect(conf.lifecycles.propSet).toEqual([[["aValue"], fa]]);
    expect(conf.lifecycles.propUnset).toEqual([[["bValue"], fb]]);
    expect(conf.lifecycles.event).toEqual([[["pong"], fb]]);
    expect(conf.lifecycles.effect).toEqual([[["aValue"], fc]]);
    // sources are deep-cloned, never mutated
    expect(A.builtConfig.props.bValue).toBeUndefined();
    expect(conf.props.aValue).not.toBe(A.builtConfig.props.aValue);
    expect(conf.props.aValue).toEqual(A.builtConfig.props.aValue);
  });
});

describe("Lifecycles: attribute changes and default-prop reflection", () => {
  const changedFn = vi.fn();
  Neutron({
    tag: "attr-host",
    props: { tagNames: TokenList, countValue: Number },
  })
    .onPropChanged(["tagNames", "countValue"], changedFn)
    .define();
  Neutron({
    tag: "reflect-host",
    props: {},
    reflectDefaultProps: ["isMounted", "wasMounted"],
  })
    .onConnected(vi.fn())
    .define();

  afterEach(() => {
    document.body.innerHTML = "";
    changedFn.mockClear();
  });

  it("ignores unknown attributes and attribute rewrites that parse to the same value", async () => {
    const el = await mountTag(`<attr-host tag-names="a b"></attr-host>`);
    changedFn.mockClear();
    el.attributeChangedCallback("unknown-attr", null, "x");
    el.setAttribute("tag-names", "a  b ");
    expect(changedFn).not.toHaveBeenCalled();
    el.setAttribute("tag-names", "a b c");
    expect(changedFn).toHaveBeenCalledTimes(1);
    expect(el.tagNames).toEqual(["a", "b", "c"]);
    el.setAttribute("count-value", "12");
    expect(el.countValue).toBe(12);
    el.setAttribute("count-value", "12.0");
    expect(changedFn).toHaveBeenCalledTimes(2);
  });

  it("reflects the chosen default props as attributes", async () => {
    const el = await mountTag(`<reflect-host></reflect-host>`);
    expect(el.hasAttribute("is-mounted")).toBe(true);
    expect(el.hasAttribute("was-mounted")).toBe(false);
    el.remove();
    await wait(0);
    expect(el.hasAttribute("is-mounted")).toBe(false);
    expect(el.hasAttribute("was-mounted")).toBe(true);
    expect(el.isMounted).toBe(false);
    expect(el.wasMounted).toBe(true);
  });
});
