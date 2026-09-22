// e.g. hashObject({a: 1.1, b: "hello world", c: [{f: 2}], d: false, e: null}) => "31eh9pr0sbb82"
export function hashObject(value: unknown): string {
  // 64-bit FNV-1a
  let h1 = 0xcbf29ce4,
    h2 = 0x84222325; // offset basis (split hi/lo 32s)

  const seen = new Map<any, number>();
  let seenId = 0;

  const u8 = (n: number) => {
    // hash one byte
    h2 ^= n & 0xff;
    // multiply by FNV prime 0x100000001b3 (64-bit) using 32-bit pieces
    const a = (h2 >>> 0) * 0x1b3;
    const b = (h1 >>> 0) * 0x1b3 + a / 0x100000000;
    h2 = a >>> 0;
    h1 = b >>> 0;
  };

  const u32 = (n: number) => {
    u8(n);
    u8(n >>> 8);
    u8(n >>> 16);
    u8(n >>> 24);
  };
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      u8(c);
      u8(c >>> 8);
    }
    u8(0);
  };

  const num = (x: number) => {
    // canonicalize tricky numerics
    if (Number.isNaN(x)) {
      u8(0x4e);
      return;
    } // 'N'
    if (x === 0) {
      u8(0);
      u8(1 / x < 0 ? 1 : 0);
      return;
    } // distinguish -0
    if (!Number.isFinite(x)) {
      u8(0x49);
      u8(x < 0 ? 1 : 0);
      return;
    } // 'I'
    // hash IEEE754 bytes
    const f = new Float64Array(1);
    f[0] = x;
    const b = new Uint8Array(f.buffer);
    for (let i = 0; i < 8; i++) u8(b[i]);
  };

  const tag = (t: number) => u8(t);

  const walk = (v: any) => {
    const t = typeof v;

    if (v === null) {
      tag(0);
      return;
    }
    if (t === "undefined") {
      tag(1);
      return;
    }
    if (t === "boolean") {
      tag(2);
      u8(v ? 1 : 0);
      return;
    }
    if (t === "number") {
      tag(3);
      num(v);
      return;
    }
    if (t === "bigint") {
      tag(4);
      str(v.toString(10));
      return;
    }
    if (t === "string") {
      tag(5);
      str(v);
      return;
    }
    if (t === "symbol") {
      tag(6);
      str(String(v.description ?? ""));
      return;
    }
    if (t === "function") {
      tag(7);
      str(v.name || "");
      return;
    } // intentionally shallow for fns

    // objects
    const prev = seen.get(v);
    if (prev !== undefined) {
      tag(8);
      u32(prev);
      return;
    } // cycle ref
    seen.set(v, ++seenId);

    // special cases
    if (v instanceof Date) {
      tag(9);
      num(v.getTime());
      return;
    }
    if (v instanceof RegExp) {
      tag(10);
      str(v.source);
      str(v.flags);
      return;
    }

    if (ArrayBuffer.isView(v)) {
      tag(11);
      str(v.constructor?.name || "View");
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      u32(bytes.length);
      for (let i = 0; i < bytes.length; i++) u8(bytes[i]);
      return;
    }
    if (v instanceof ArrayBuffer) {
      tag(12);
      const bytes = new Uint8Array(v);
      u32(bytes.length);
      for (let i = 0; i < bytes.length; i++) u8(bytes[i]);
      return;
    }

    if (v instanceof Map) {
      tag(13);
      // stable: hash entries then sort by entry-hash
      const entries: { k: any; val: any; hk: string }[] = [];
      v.forEach((val, k) => {
        const hk = hashObject([k, val]); // small reuse for ordering
        entries.push({ k, val, hk });
      });
      entries.sort((a, b) => (a.hk < b.hk ? -1 : a.hk > b.hk ? 1 : 0));
      u32(entries.length);
      for (const e of entries) {
        walk(e.k);
        walk(e.val);
      }
      return;
    }

    if (v instanceof Set) {
      tag(14);
      const items: { v: any; hv: string }[] = [];
      v.forEach((x) => items.push({ v: x, hv: hashObject(x) }));
      items.sort((a, b) => (a.hv < b.hv ? -1 : a.hv > b.hv ? 1 : 0));
      u32(items.length);
      for (const it of items) walk(it.v);
      return;
    }

    if (Array.isArray(v)) {
      tag(15);
      u32(v.length);
      for (let i = 0; i < v.length; i++) walk(v[i]);
      return;
    }

    // plain-ish object: stable key ordering
    tag(16);
    const proto = Object.getPrototypeOf(v);
    str(proto && proto.constructor ? proto.constructor.name : "");
    const keys = Object.keys(v).sort();
    u32(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      str(k);
      walk(v[k]);
    }
  };

  walk(value);

  // base36 from 64-bit (hi/lo)
  const hi = h1 >>> 0,
    lo = h2 >>> 0;
  const asBig = (BigInt(hi) << 32n) | BigInt(lo);
  return asBig.toString(36);
}
