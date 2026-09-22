import { hashObject } from "../../index";
import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";

describe("hashObject", () => {
  it("returns deterministic hashes", () => {
    const first = hashObject({ a: 1, b: "two" });
    const second = hashObject({ a: 1, b: "two" });
    const different = hashObject({ a: 2, b: "two" });
    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });

  it("returns hashes for complex objects", () => {
    const obj1 = { a: 1, b: "two", c: [{ d: 3 }, { e: 4 }] };
    const hash1 = hashObject(obj1);
    const obj2 = { a: 1, b: "two", c: [{ d: 3 }, { e: 4 }] };
    const hash2 = hashObject(obj2);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(
      hashObject({ a: 1, b: "two", c: [{ d: 3 }, { e: 5 }] }),
    );
  });

  it("handles cycles without throwing", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = hashObject(obj);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("hashes primitive types distinctly", () => {
    const results = new Set([
      hashObject(null),
      hashObject(undefined),
      hashObject(true),
      hashObject(false),
      hashObject(0),
      hashObject(1),
      hashObject(""),
      hashObject("a"),
    ]);
    expect(results.size).toBe(8);
  });

  it("distinguishes -0 from 0", () => {
    expect(hashObject(-0)).not.toBe(hashObject(0));
  });

  it("handles NaN and Infinity", () => {
    const nan = hashObject(NaN);
    const posInf = hashObject(Infinity);
    const negInf = hashObject(-Infinity);
    expect(nan).not.toBe(posInf);
    expect(posInf).not.toBe(negInf);
    expect(hashObject(NaN)).toBe(nan);
  });

  it("hashes bigint values", () => {
    const a = hashObject(1n);
    const b = hashObject(2n);
    expect(a).not.toBe(b);
    expect(hashObject(1n)).toBe(a);
  });

  it("hashes symbols by description", () => {
    const a = hashObject(Symbol("foo"));
    const b = hashObject(Symbol("bar"));
    const c = hashObject(Symbol("foo"));
    expect(a).toBe(c);
    expect(a).not.toBe(b);
  });

  it("hashes functions by name", () => {
    function myFunc() {}
    const hash = hashObject(myFunc);
    expect(typeof hash).toBe("string");
    expect(hash).toBe(hashObject(myFunc));
  });

  it("hashes Date objects by timestamp", () => {
    const d1 = new Date(1700000000000);
    const d2 = new Date(1700000000000);
    const d3 = new Date(0);
    expect(hashObject(d1)).toBe(hashObject(d2));
    expect(hashObject(d1)).not.toBe(hashObject(d3));
  });

  it("hashes RegExp by source and flags", () => {
    expect(hashObject(/abc/g)).toBe(hashObject(/abc/g));
    expect(hashObject(/abc/g)).not.toBe(hashObject(/abc/i));
    expect(hashObject(/abc/)).not.toBe(hashObject(/def/));
  });

  it("hashes Map in stable key order", () => {
    const m1 = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const m2 = new Map([
      ["b", 2],
      ["a", 1],
    ]);
    expect(hashObject(m1)).toBe(hashObject(m2));
  });

  it("hashes Set in stable order", () => {
    const s1 = new Set([1, 2, 3]);
    const s2 = new Set([3, 1, 2]);
    expect(hashObject(s1)).toBe(hashObject(s2));
  });

  it("hashes ArrayBuffer", () => {
    const buf1 = new Uint8Array([1, 2, 3]).buffer;
    const buf2 = new Uint8Array([1, 2, 3]).buffer;
    const buf3 = new Uint8Array([4, 5, 6]).buffer;
    expect(hashObject(buf1)).toBe(hashObject(buf2));
    expect(hashObject(buf1)).not.toBe(hashObject(buf3));
  });

  it("hashes typed arrays", () => {
    const a = new Uint8Array([10, 20]);
    const b = new Uint8Array([10, 20]);
    const c = new Float32Array([10, 20]);
    expect(hashObject(a)).toBe(hashObject(b));
    expect(hashObject(a)).not.toBe(hashObject(c));
  });

  it("produces stable hashes regardless of key order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(hashObject(a)).toBe(hashObject(b));
  });

  it("distinguishes arrays from objects", () => {
    expect(hashObject([1, 2])).not.toBe(hashObject({ 0: 1, 1: 2 }));
  });

  it("distinguishes empty containers", () => {
    const results = new Set([
      hashObject([]),
      hashObject({}),
      hashObject(new Map()),
      hashObject(new Set()),
      hashObject(""),
      hashObject(null),
    ]);
    expect(results.size).toBe(6);
  });
});

describe("hashObject (fallback branches)", () => {
  it("hashes a symbol without a description", () => {
    const anonymous = hashObject(Symbol());
    expect(anonymous).toBe(hashObject(Symbol()));
    expect(anonymous).toBe(hashObject(Symbol("")));
    expect(anonymous).not.toBe(hashObject(Symbol("named")));
  });

  it("hashes an anonymous function like an empty name", () => {
    const anonymous = hashObject([() => {}][0]);
    expect(anonymous).toBe(hashObject([function () {}][0]));
    expect(anonymous).not.toBe(hashObject(function named() {}));
  });

  it("hashes a typed array whose constructor is unavailable", () => {
    const view = new Uint8Array([1, 2, 3]);
    Object.defineProperty(view, "constructor", { value: undefined });
    const hash = hashObject(view);
    expect(typeof hash).toBe("string");
    expect(hash).not.toBe(hashObject(new Uint8Array([1, 2, 3])));
    // same bytes, same missing constructor -> same hash
    const twin = new Uint8Array([1, 2, 3]);
    Object.defineProperty(twin, "constructor", { value: undefined });
    expect(hash).toBe(hashObject(twin));
  });

  it("orders equal-hashing Map entries and Set items stably", () => {
    const mapA = new Map<object, number>([
      [{ k: 1 }, 1],
      [{ k: 1 }, 1],
    ]);
    const mapB = new Map<object, number>([
      [{ k: 1 }, 1],
      [{ k: 1 }, 1],
    ]);
    expect(hashObject(mapA)).toBe(hashObject(mapB));
    expect(hashObject(mapA)).not.toBe(hashObject(new Map([[{ k: 1 }, 1]])));

    const setA = new Set([{ k: 1 }, { k: 1 }]);
    const setB = new Set([{ k: 1 }, { k: 1 }]);
    expect(hashObject(setA)).toBe(hashObject(setB));
    expect(hashObject(setA)).not.toBe(hashObject(new Set([{ k: 1 }])));
  });

  it("hashes null-prototype objects with an empty constructor name", () => {
    const bare = Object.assign(Object.create(null), { a: 1 });
    const plain = { a: 1 };
    expect(hashObject(bare)).toBe(
      hashObject(Object.assign(Object.create(null), { a: 1 })),
    );
    expect(hashObject(bare)).not.toBe(hashObject(plain));
  });
});
