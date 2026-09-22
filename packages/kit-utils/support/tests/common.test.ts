import * as utils from "../../common";
import {
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

describe("common", () => {
  it("toArray", () => {
    expect(utils.toArray(1)).to.deep.equal([1]);
    expect(utils.toArray([1, 2, 3])).to.deep.equal([1, 2, 3]);
  });
  it("isPojo", () => {
    expect(utils.isPojo({})).to.be.true;
    expect(utils.isPojo([])).to.be.false;
    expect(utils.isPojo(null)).to.be.false;
    expect(utils.isPojo(undefined)).to.be.false;
    expect(utils.isPojo(1)).to.be.false;
  });
  it("pathJoin", () => {
    expect(utils.pathJoin(["a", "b", "c"])).to.equal("a/b/c");
    expect(utils.pathJoin(["a", "b", "c"], "-")).to.equal("a-b-c");
  });
  it("wrapInPromise", async () => {
    await expect(utils.wrapInPromise(1)).resolves.to.equal(1);
    const pending = Promise.resolve("ok");
    expect(utils.wrapInPromise(pending)).to.equal(pending);
    await expect(utils.wrapInPromise(pending)).resolves.to.equal("ok");
  });
  it("isNumber", () => {
    expect(utils.isNumber(1)).to.be.true;
    expect(utils.isNumber(1.1)).to.be.true;
    expect(utils.isNumber("1")).to.be.false;
    expect(utils.isNumber(null)).to.be.false;
    expect(utils.isNumber(undefined)).to.be.false;
  });
  it("deepClone", () => {
    expect(utils.deepClone({ a: 1 })).to.deep.equal({ a: 1 });
    expect(utils.deepClone([1, 2, 3])).to.deep.equal([1, 2, 3]);
  });
  it("tc", () => {
    expect(utils.tc(() => 1)).to.equal(1);
    expect(
      utils.tc(() => {
        throw new Error();
      })
    ).to.be.undefined;
  });
  it("isPojo", () => {
    expect(utils.isPojo({})).to.be.true;
    expect(utils.isPojo([])).to.be.false;
    expect(utils.isPojo(null)).to.be.false;
    expect(utils.isPojo(undefined)).to.be.false;
    expect(utils.isPojo(1)).to.be.false;
    expect(utils.isPojo("")).to.be.false;
    expect(utils.isPojo(true)).to.be.false;
    expect(utils.isPojo(() => {})).to.be.false;
  });
  it("deepMerge", () => {
    expect(utils.deepMerge({ a: 1 }, { b: 2 })).to.deep.equal({ a: 1, b: 2 });
    expect(utils.deepMerge({ a: 1 }, { a: 2 })).to.deep.equal({ a: 2 });
    expect(utils.deepMerge({ a: 1 }, { a: { b: 2 } })).to.deep.equal({
      a: { b: 2 },
    });
    expect(
      utils.deepMerge({ a: 1 }, { b: 2 }, { c: 3 }),
    ).to.deep.equal({ a: 1, b: 2, c: 3 });
    expect(
      utils.deepMerge({ a: 1 }, { a: 2 }, { a: 3 }),
    ).to.deep.equal({ a: 3 });
    expect(
      utils.deepMerge(
        { a: { x: 1 } },
        { a: { y: 2 } },
        { a: { z: 3 } },
      ),
    ).to.deep.equal({ a: { x: 1, y: 2, z: 3 } });
    expect(
      utils.deepMerge(
        { a: { x: 1 }, b: "keep" },
        { a: { y: 2 }, c: true },
        { a: { x: 10 } },
      ),
    ).to.deep.equal({ a: { x: 10, y: 2 }, b: "keep", c: true });
    expect(
      utils.deepMerge({ a: 1 }, null, { b: 2 }),
    ).to.deep.equal({ a: 1, b: 2 });
    expect(
      utils.deepMerge(undefined, { a: 1 }, false, { b: 2 }, 0, "", { c: 3 }),
    ).to.deep.equal({ a: 1, b: 2, c: 3 });
  });
  it("deleteUndefined", () => {
    expect(utils.deleteUndefined({ a: 1, b: undefined, c: "ok" })).to.deep.equal({
      a: 1,
      c: "ok",
    });
    expect(utils.deleteUndefined({ x: undefined, y: undefined })).to.deep.equal({});
    expect(utils.deleteUndefined({ a: 0, b: null, c: false, d: "" })).to.deep.equal({
      a: 0,
      b: null,
      c: false,
      d: "",
    });
    expect(
      utils.deleteUndefined({ a: 1, b: { x: undefined, y: 2 } }),
    ).to.deep.equal({ a: 1, b: { x: undefined, y: 2 } });
    expect(
      utils.deleteUndefined({ a: 1, b: { x: undefined, y: 2 } }, { nested: true }),
    ).to.deep.equal({ a: 1, b: { y: 2 } });
    expect(
      utils.deleteUndefined(
        { a: { b: { c: undefined, d: 3 }, e: undefined } },
        { nested: true },
      ),
    ).to.deep.equal({ a: { b: { d: 3 } } });
  });

  it("toJsonSafe: defaults for primitives, functions, and POJOs", () => {
    expect(utils.toJsonSafe(null)).to.equal(null);
    expect(utils.toJsonSafe(1)).to.equal(1);
    expect(utils.toJsonSafe("hi")).to.equal("hi");
    expect(utils.toJsonSafe(true)).to.equal(true);
    expect(utils.toJsonSafe(1n)).to.equal("1");
    expect(utils.toJsonSafe(Symbol("s"))).to.equal("Symbol(s)");
    expect(utils.toJsonSafe(() => {})).to.equal("<Function>");
    expect(utils.toJsonSafe({ a: 1, b: { c: 2 } })).to.deep.equal({
      a: 1,
      b: { c: 2 },
    });
    expect(utils.toJsonSafe([1, { a: 2 }])).to.deep.equal([1, { a: 2 }]);
  });

  it("toJsonSafe: defaults for DOM, WeakRef, and non-POJOs", () => {
    const el = document.createElement("div");
    el.id = "x";
    expect(utils.toJsonSafe(el)).to.equal("<HTMLDivElement>");
    expect(utils.toJsonSafe(document.createTextNode("t"))).to.equal("<Text>");
    expect(utils.toJsonSafe(new WeakRef(el))).to.equal("<WeakRef>");
    expect(utils.toJsonSafe(Promise.resolve(1))).to.match(/^</);
    expect(utils.toJsonSafe(new Map())).to.match(/^</);
  });

  it("toJsonSafe: circular refs and null-prototype objects", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(utils.toJsonSafe(circular)).to.deep.equal({
      a: 1,
      self: "<Circular>",
    });
    expect(utils.toJsonSafe(Object.assign(Object.create(null), { a: 1 }))).to.deep.equal({
      a: 1,
    });
  });

  it("deepCompare: primitives and identity", () => {
    expect(utils.deepCompare(1, 1)).to.be.true;
    expect(utils.deepCompare("a", "a")).to.be.true;
    expect(utils.deepCompare(true, true)).to.be.true;
    expect(utils.deepCompare(null, null)).to.be.true;
    expect(utils.deepCompare(undefined, undefined)).to.be.true;
    expect(utils.deepCompare(NaN, NaN)).to.be.true;
    expect(utils.deepCompare(1, 2)).to.be.false;
    expect(utils.deepCompare("a", "b")).to.be.false;
    expect(utils.deepCompare(null, undefined)).to.be.false;
    expect(utils.deepCompare(1, "1")).to.be.false;
    expect(utils.deepCompare(0, false)).to.be.false;
    const ref = {};
    expect(utils.deepCompare(ref, ref)).to.be.true;
  });

  it("deepCompare: nested POJOs and arrays", () => {
    expect(utils.deepCompare({ a: 1 }, { a: 1 })).to.be.true;
    expect(utils.deepCompare({ a: 1 }, { a: 2 })).to.be.false;
    expect(utils.deepCompare({ a: 1 }, { a: 1, b: 2 })).to.be.false;
    expect(utils.deepCompare({ a: 1, b: 2 }, { b: 2, a: 1 })).to.be.true;
    expect(
      utils.deepCompare(
        { a: { b: [1, { c: 2 }] } },
        { a: { b: [1, { c: 2 }] } },
      ),
    ).to.be.true;
    expect(
      utils.deepCompare(
        { a: { b: [1, { c: 2 }] } },
        { a: { b: [1, { c: 3 }] } },
      ),
    ).to.be.false;
    expect(utils.deepCompare([1, 2, 3], [1, 2, 3])).to.be.true;
    expect(utils.deepCompare([1, 2, 3], [1, 2])).to.be.false;
    expect(utils.deepCompare([1, [2, 3]], [1, [2, 3]])).to.be.true;
    expect(utils.deepCompare([], [])).to.be.true;
    expect(utils.deepCompare({}, {})).to.be.true;
    expect(utils.deepCompare([], {})).to.be.false;
    expect(utils.deepCompare({ 0: 1 }, [1])).to.be.false;
    expect(
      utils.deepCompare(Object.assign(Object.create(null), { a: 1 }), { a: 1 }),
    ).to.be.true;
  });

  it("deepCompare: unknown constructors use ===", () => {
    class MyUser {
      constructor(public name: string) {}
    }
    const user = new MyUser("ada");
    expect(utils.deepCompare(user, user)).to.be.true;
    expect(utils.deepCompare(user, new MyUser("ada"))).to.be.false;
    expect(utils.deepCompare({ user }, { user })).to.be.true;
    expect(utils.deepCompare({ user }, { user: new MyUser("ada") })).to.be.false;
    expect(utils.deepCompare([user], [user])).to.be.true;
    expect(utils.deepCompare([user], [new MyUser("ada")])).to.be.false;
    expect(utils.deepCompare(new Date(0), new Date(0))).to.be.false;
    expect(utils.deepCompare(/a/, /a/)).to.be.false;
    const el = document.createElement("div");
    expect(utils.deepCompare(el, el)).to.be.true;
    expect(utils.deepCompare(el, document.createElement("div"))).to.be.false;
  });

  it("toJsonSafe: custom serializers override defaults (devtools shape)", () => {
    // Mirrors packages/neutron/src/devtools-hook.ts serializers.
    const serializers = {
      function: () => ({ $constructor: "Function" }),
      WeakRef: (value: WeakRef<WeakKey>) => {
        const deref = value.deref();
        return deref === undefined ? null : deref;
      },
      Node: (value: Node) => ({
        $node: value.nodeName,
      }),
      Element: (value: Element) => ({
        $element: value.localName ?? value.nodeName,
        id: value.id || null,
      }),
      UnknownObject: (value: unknown) => ({
        $constructor:
          (value as object).constructor?.name ||
          Object.prototype.toString.call(value),
      }),
    };

    const el = document.createElement("span");
    el.id = "probe";
    const text = document.createTextNode("hi");

    expect(utils.toJsonSafe(() => {}, serializers)).to.deep.equal({
      $constructor: "Function",
    });
    expect(utils.toJsonSafe(el, serializers)).to.deep.equal({
      $element: "span",
      id: "probe",
    });
    expect(utils.toJsonSafe(text, serializers)).to.deep.equal({
      $node: "#text",
    });
    expect(utils.toJsonSafe(new WeakRef(el), serializers)).to.deep.equal({
      $element: "span",
      id: "probe",
    });
    expect(utils.toJsonSafe(new WeakRef({ a: 1 }), serializers)).to.deep.equal({
      a: 1,
    });
    expect(utils.toJsonSafe(Promise.resolve(), serializers)).to.deep.equal({
      $constructor: "Promise",
    });
    expect(
      utils.toJsonSafe({ fn: () => {}, nested: { el } }, serializers),
    ).to.deep.equal({
      fn: { $constructor: "Function" },
      nested: { el: { $element: "span", id: "probe" } },
    });
  });

  it("wait: resolves true after the delay", async () => {
    await expect(utils.wait(1)).resolves.to.equal(true);
    await expect(utils.wait()).resolves.to.equal(true);
  });

  it("execWhenReady: runs the callback synchronously for plain values", () => {
    const cb = (v: number) => v * 2;
    expect(utils.execWhenReady(2, cb)).to.equal(4);
  });

  it("execWhenReady: waits for a promise before running the callback", async () => {
    const cb = (v: number) => v * 2;
    const result = utils.execWhenReady(Promise.resolve(3), cb);
    expect(result).to.be.instanceOf(Promise);
    await expect(result).resolves.to.equal(6);
  });

  it("unique: keeps the first occurrence of each value", () => {
    expect(utils.unique([1, 2, 1, 3, 2])).to.deep.equal([1, 2, 3]);
    const a = {};
    const b = {};
    expect(utils.unique([a, b, a])).to.deep.equal([a, b]);
    expect(utils.unique([])).to.deep.equal([]);
  });

  it("deepClone: leaves primitives and null alone, clones nested arrays", () => {
    expect(utils.deepClone(null)).to.equal(null);
    expect(utils.deepClone("s")).to.equal("s");
    const src = { a: [1, { b: 2 }], c: { d: [3] } };
    const copy = utils.deepClone(src);
    expect(copy).to.deep.equal(src);
    expect(copy.a).to.not.equal(src.a);
    expect(copy.a[1]).to.not.equal(src.a[1]);
    expect(copy.c.d).to.not.equal(src.c.d);
  });

  it("di.apply: calls back with dereferenced values when all are alive", () => {
    const a = { name: "a" };
    const b = { name: "b" };
    const result = utils.di.apply(
      [new WeakRef(a), new WeakRef(b)],
      (x, y) => `${x.name}${y.name}`,
    );
    expect(result).to.equal("ab");
  });

  it("di.apply: skips the callback when a ref is gone or missing", () => {
    const a = { name: "a" };
    const dead = { deref: () => undefined } as unknown as WeakRef<object>;
    const cb = vi.fn(() => "ran");
    expect(utils.di.apply([new WeakRef(a), dead], cb)).to.equal(undefined);
    expect(utils.di.apply([null as unknown as WeakRef<object>], cb)).to.equal(
      undefined,
    );
    expect(cb).not.toHaveBeenCalled();
  });

  it("di.apply: optional refs pass undefined through", () => {
    const dead = { deref: () => undefined } as unknown as WeakRef<object>;
    const cb = vi.fn((x: unknown, y: unknown) => [x, y]);
    const live = { ok: true };
    expect(
      utils.di.apply([dead, new WeakRef(live)], cb, { optional: true }),
    ).to.deep.equal([undefined, live]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("di.bind: defers the call and re-checks liveness when invoked", () => {
    let current: { n: number } | undefined = { n: 1 };
    const ref = { deref: () => current } as unknown as WeakRef<{ n: number }>;
    const cb = vi.fn((x: { n: number }) => x.n);
    const bound = utils.di.bind([ref], cb)!;
    expect(bound).to.be.a("function");
    expect(cb).not.toHaveBeenCalled();
    expect(bound()).to.equal(1);
    current = undefined;
    expect(bound()).to.equal(undefined);
    expect(cb).toHaveBeenCalledTimes(1);
    const optional = utils.di.bind([ref], cb, { optional: true })!;
    expect(() => optional()).to.throw();
  });

  it("toJsonSafe: reports <Failed> when serialization throws", () => {
    const bomb = {
      toJSON() {
        throw new Error("nope");
      },
    };
    expect(utils.toJsonSafe(bomb)).to.equal("<Failed>");
    expect(utils.toJsonSafe({ nested: bomb })).to.equal("<Failed>");
    expect(
      utils.toJsonSafe(bomb, { Failed: () => ({ failed: true }) }),
    ).to.deep.equal({ failed: true });
  });

  it("toJsonSafe: node and element labels fall back to nodeType / nodeName", () => {
    const text = document.createTextNode("t");
    Object.defineProperty(text, "constructor", { value: {} });
    expect(utils.toJsonSafe(text)).to.equal(`<${Node.TEXT_NODE}>`);
    const el = document.createElement("div");
    Object.defineProperty(el, "constructor", { value: {} });
    expect(utils.toJsonSafe(el)).to.equal("<DIV>");
  });
});
